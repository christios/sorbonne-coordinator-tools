from __future__ import annotations

from copy import deepcopy
from datetime import UTC, date, datetime
import json
import re
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from sorbonne.services.engine import engine_for


class TeacherNotFound(Exception):
    pass


class RequisitionNotFound(Exception):
    pass


class RevisionConflict(Exception):
    pass


class CommentNotFound(Exception):
    """No such line on anybody's thread."""


class NotTheAuthor(Exception):
    """A line is its author's to take back, and nobody else's."""


class FolderNotFound(Exception):
    pass


class FolderNameConflict(Exception):
    pass


class FolderNotEmpty(Exception):
    pass


class TimeSheetNotFound(Exception):
    pass


class InvalidTimeSheetLink(Exception):
    """The link is not a web address this profile is willing to put behind a button."""


class InvalidPeriod(Exception):
    """A pay period is named by the day it starts, as a plain date."""


#: The day of the month the department's pay periods have always opened on.
#:
#: A semester nobody has said anything about is paid from the 15th, which is what every
#: time sheet filed so far assumes. Saying otherwise is a decision somebody takes about
#: one semester; not saying anything changes nothing.
DEFAULT_PERIOD_OPENS_ON = 15

#: The last day a period may open on. Later than this and some months would have no
#: period at all, February first among them.
LAST_DAY_A_PERIOD_MAY_OPEN_ON = 28


class TeacherStore:
    """PostgreSQL persistence for part-time teacher profiles and their requisitions."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def pay_cycles(self) -> dict[str, int]:
        """Which day of the month each semester's pay periods open on.

        Only the semesters somebody has decided about are here. Everything else is paid
        from `DEFAULT_PERIOD_OPENS_ON`, and the reader applies that rather than this
        table carrying a row per semester saying "as usual".
        """
        with self.engine.connect() as connection:
            rows = connection.execute(text("SELECT term_id, opens_on FROM term_pay_cycles")).all()
        return {str(row[0]): int(row[1]) for row in rows}

    def set_pay_cycle(self, term_id: str, opens_on: int, *, actor: str = "") -> int:
        """Say which day this semester's periods open on. 1-28, so every month has one."""
        term = str(term_id or "").strip()
        if not term:
            raise ValueError("A pay cycle belongs to a semester.")
        if not 1 <= int(opens_on) <= LAST_DAY_A_PERIOD_MAY_OPEN_ON:
            raise ValueError("A period opens on a day between the 1st and the 28th, which every month has.")
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO term_pay_cycles (term_id, opens_on, updated_at, updated_by)
                        VALUES (:term, :day, :now, :actor)
                        ON CONFLICT (term_id) DO UPDATE
                        SET opens_on = :day, updated_at = :now, updated_by = :actor"""),
                {"term": term, "day": int(opens_on), "now": datetime.now(UTC), "actor": str(actor or "").strip()},
            )
        return int(opens_on)

    def create_teacher(
        self,
        *,
        full_name: str,
        email: str | None = None,
        phone: str | None = None,
        notes: str = "",
        task_template_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        now = _timestamp()
        teacher = {
            "id": str(uuid4()),
            "folderId": None,
            "fullName": full_name,
            "email": email or "",
            "phone": phone or "",
            "notes": notes,
            "archivedAt": None,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO part_time_teachers (
                        id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                    ) VALUES (
                        :id, :folder_id, :full_name, :email, :phone, :notes, :archived_at, :created_at, :updated_at
                    )
                    """
                ),
                _teacher_params(teacher),
            )
            self._create_template_tasks(connection, teacher["id"], task_template_ids or [], now)
        return teacher

    @staticmethod
    def _create_template_tasks(connection: Any, teacher_id: str, template_ids: list[str], now: str) -> None:
        if not template_ids:
            return
        distinct_ids = list(dict.fromkeys(template_ids))
        rows = (
            connection.execute(
                text("""SELECT items.id, items.template_id, items.title FROM task_template_items AS items
                     JOIN task_templates AS templates ON templates.id = items.template_id
                     WHERE templates.resource_type = 'teacher' AND items.template_id = ANY(:template_ids)
                     ORDER BY items.template_id, items.position"""),
                {"template_ids": distinct_ids},
            )
            .mappings()
            .all()
        )
        if not rows or len({row["template_id"] for row in rows}) < len(distinct_ids):
            raise ValueError("One or more selected task templates are not available for teachers.")
        for item in rows:
            connection.execute(
                text("""INSERT INTO tasks (
                             id, resource_type, resource_id, template_item_id, title, due_date,
                             status, completed_at, revision, created_at, updated_at
                         ) VALUES (
                             :id, 'teacher', :resource_id, :template_item_id, :title, NULL,
                             'NOT_STARTED', NULL, 1, :now, :now
                         )"""),
                {
                    "id": str(uuid4()),
                    "resource_id": teacher_id,
                    "template_item_id": item["id"],
                    "title": item["title"],
                    "now": now,
                },
            )

    def list_teachers(self, *, include_archived: bool = False) -> list[dict[str, Any]]:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                        SELECT id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                        FROM part_time_teachers {where}
                        ORDER BY full_name ASC, updated_at DESC
                        """
                    )
                )
                .mappings()
                .all()
            )  # noqa: S608
        return [_teacher_from_row(row) for row in rows]

    def get_teacher(self, teacher_id: str | None) -> dict[str, Any]:
        if not teacher_id:
            raise TeacherNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        """
                        SELECT id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                        FROM part_time_teachers WHERE id = :id
                        """
                    ),
                    {"id": teacher_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise TeacherNotFound
        return _teacher_from_row(row)

    def find_active_teachers_by_email(self, email: str) -> list[dict[str, Any]]:
        """Return exact, case-insensitive active profile matches for document intake."""
        normalized_email = email.strip().casefold()
        if not normalized_email:
            return []
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                    SELECT id, folder_id, full_name, email, phone, notes, archived_at, created_at, updated_at
                    FROM part_time_teachers
                    WHERE archived_at IS NULL AND LOWER(email) = :email
                    ORDER BY created_at ASC
                    """
                    ),
                    {"email": normalized_email},
                )
                .mappings()
                .all()
            )
        return [_teacher_from_row(row) for row in rows]

    def update_teacher(self, teacher_id: str, *, full_name: str, email: str, phone: str, notes: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {
            **current,
            "fullName": full_name,
            "email": email,
            "phone": phone,
            "notes": notes,
            "updatedAt": _timestamp(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE part_time_teachers
                    SET full_name = :full_name, email = :email, phone = :phone, notes = :notes, updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                _teacher_params(updated),
            )
        return updated

    def archive_teacher(self, teacher_id: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {**current, "archivedAt": _timestamp(), "updatedAt": _timestamp()}
        self._save_archive_state(updated)
        return updated

    def restore_teacher(self, teacher_id: str) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        updated = {**current, "archivedAt": None, "updatedAt": _timestamp()}
        self._save_archive_state(updated)
        return updated

    def _save_archive_state(self, teacher: dict[str, Any]) -> None:
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE part_time_teachers SET archived_at = :archived_at, updated_at = :updated_at WHERE id = :id"
                ),
                _teacher_params(teacher),
            )

    def list_folders(self) -> list[dict[str, Any]]:
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("SELECT id, name, parent_id, created_at, updated_at FROM teacher_folders ORDER BY name ASC")
                )
                .mappings()
                .all()
            )
        return [_folder_from_row(row) for row in rows]

    def create_folder(self, name: str, parent_id: str | None = None) -> dict[str, Any]:
        if parent_id and not self._folder_exists(parent_id):
            raise FolderNotFound
        now = _timestamp()
        folder = {"id": str(uuid4()), "name": name.strip(), "parentId": parent_id, "createdAt": now, "updatedAt": now}
        try:
            with self.engine.begin() as connection:
                connection.execute(
                    text(
                        """
                        INSERT INTO teacher_folders (id, name, parent_id, created_at, updated_at)
                        VALUES (:id, :name, :parent_id, :created_at, :updated_at)
                        """
                    ),
                    {
                        "id": folder["id"],
                        "name": folder["name"],
                        "parent_id": folder["parentId"],
                        "created_at": folder["createdAt"],
                        "updated_at": folder["updatedAt"],
                    },
                )
        except IntegrityError as exc:
            raise FolderNameConflict from exc
        return folder

    def delete_folder(self, folder_id: str) -> None:
        if not self._folder_exists(folder_id):
            raise FolderNotFound
        with self.engine.begin() as connection:
            has_teachers = connection.execute(
                text("SELECT 1 FROM part_time_teachers WHERE folder_id = :folder_id LIMIT 1"), {"folder_id": folder_id}
            ).first()
            has_children = connection.execute(
                text("SELECT 1 FROM teacher_folders WHERE parent_id = :folder_id LIMIT 1"), {"folder_id": folder_id}
            ).first()
            if has_teachers is not None or has_children is not None:
                raise FolderNotEmpty
            connection.execute(text("DELETE FROM teacher_folders WHERE id = :id"), {"id": folder_id})

    def move_teacher_to_folder(self, teacher_id: str, folder_id: str | None) -> dict[str, Any]:
        current = self.get_teacher(teacher_id)
        if folder_id and not self._folder_exists(folder_id):
            raise FolderNotFound
        updated = {**current, "folderId": folder_id, "updatedAt": _timestamp()}
        with self.engine.begin() as connection:
            connection.execute(
                text("UPDATE part_time_teachers SET folder_id = :folder_id, updated_at = :updated_at WHERE id = :id"),
                _teacher_params(updated),
            )
        return updated

    def list_requisitions(self, teacher_id: str) -> list[dict[str, Any]]:
        self.get_teacher(teacher_id)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                        SELECT id, teacher_id, label, academic_year, revision, created_at, updated_at
                        FROM teacher_requisitions WHERE teacher_id = :teacher_id
                        ORDER BY academic_year DESC, updated_at DESC
                        """
                    ),
                    {"teacher_id": teacher_id},
                )
                .mappings()
                .all()
            )
        return [_requisition_summary_from_row(row) for row in rows]

    def create_requisition(
        self, teacher_id: str, *, label: str, academic_year: str, source_requisition_id: str | None = None
    ) -> dict[str, Any]:
        self.get_teacher(teacher_id)
        source = self.get_requisition(source_requisition_id) if source_requisition_id else None
        if source and source["teacherId"] != teacher_id:
            raise RequisitionNotFound
        now = _timestamp()
        record = {
            "id": str(uuid4()),
            "teacherId": teacher_id,
            "label": label,
            "academicYear": academic_year,
            "content": deepcopy(source["content"]) if source else default_content(),
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO teacher_requisitions (
                        id, teacher_id, label, academic_year, content_json, revision, created_at, updated_at
                    ) VALUES (
                        :id, :teacher_id, :label, :academic_year, CAST(:content_json AS JSONB), :revision,
                        :created_at, :updated_at
                    )
                    """
                ),
                _requisition_params(record),
            )
        return record

    def get_requisition(self, requisition_id: str | None) -> dict[str, Any]:
        if not requisition_id:
            raise RequisitionNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text("SELECT *, content_json::text AS content_json_text FROM teacher_requisitions WHERE id = :id"),
                    {"id": requisition_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise RequisitionNotFound
        return {**_requisition_summary_from_row(row), "content": json.loads(row["content_json_text"])}

    def update_requisition(
        self, requisition_id: str, *, expected_revision: int, label: str, academic_year: str, content: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.get_requisition(requisition_id)
        if current["revision"] != expected_revision:
            raise RevisionConflict
        updated = {
            **current,
            "label": label,
            "academicYear": academic_year,
            "content": content,
            "revision": current["revision"] + 1,
            "updatedAt": _timestamp(),
        }
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """
                    UPDATE teacher_requisitions
                    SET label = :label, academic_year = :academic_year, content_json = CAST(:content_json AS JSONB),
                        revision = :revision, updated_at = :updated_at
                    WHERE id = :id AND revision = :expected_revision
                    """
                ),
                {**_requisition_params(updated), "expected_revision": expected_revision},
            )
        if result.rowcount != 1:
            raise RevisionConflict
        return updated

    def delete_requisition(self, requisition_id: str) -> None:
        self.get_requisition(requisition_id)
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM teacher_requisitions WHERE id = :id"), {"id": requisition_id})

    # ------------------------------------------------------------- time sheets

    def list_time_sheets(self, teacher_id: str) -> list[dict[str, Any]]:
        """One teacher's links to their time sheets, newest academic year first."""
        self.get_teacher(teacher_id)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        """
                        SELECT id, teacher_id, label, academic_year, url, period_start,
                               created_at, updated_at
                        FROM teacher_time_sheets WHERE teacher_id = :teacher_id
                        ORDER BY period_start DESC, academic_year DESC, label
                        """
                    ),
                    {"teacher_id": teacher_id},
                )
                .mappings()
                .all()
            )
        return [_time_sheet_from_row(row) for row in rows]

    def create_time_sheet(
        self, teacher_id: str, *, label: str, academic_year: str, url: str, period_start: str = ""
    ) -> dict[str, Any]:
        self.get_teacher(teacher_id)
        now = _timestamp()
        record = {
            "id": str(uuid4()),
            "teacherId": teacher_id,
            "label": label.strip(),
            "academicYear": academic_year.strip(),
            "url": _web_link(url),
            "periodStart": _period(period_start),
            "createdAt": now,
            "updatedAt": now,
        }
        if not record["label"]:
            raise ValueError("A time sheet link needs a label.")
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    INSERT INTO teacher_time_sheets (
                        id, teacher_id, label, academic_year, url, period_start, created_at, updated_at
                    ) VALUES (
                        :id, :teacher_id, :label, :academic_year, :url, :period_start, :created_at, :updated_at
                    )
                    """
                ),
                _time_sheet_params(record),
            )
        return record

    def get_time_sheet(self, time_sheet_id: str | None) -> dict[str, Any]:
        if not time_sheet_id:
            raise TimeSheetNotFound
        with self.engine.connect() as connection:
            row = (
                connection.execute(text("SELECT * FROM teacher_time_sheets WHERE id = :id"), {"id": time_sheet_id})
                .mappings()
                .first()
            )
        if row is None:
            raise TimeSheetNotFound
        return _time_sheet_from_row(row)

    def update_time_sheet(
        self, time_sheet_id: str, *, label: str, academic_year: str, url: str, period_start: str = ""
    ) -> dict[str, Any]:
        """A pasted link is got wrong often enough that correcting one must not mean
        deleting it and typing the label again."""
        current = self.get_time_sheet(time_sheet_id)
        updated = {
            **current,
            "label": label.strip(),
            "academicYear": academic_year.strip(),
            "url": _web_link(url),
            "periodStart": _period(period_start),
            "updatedAt": _timestamp(),
        }
        if not updated["label"]:
            raise ValueError("A time sheet link needs a label.")
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """
                    UPDATE teacher_time_sheets
                    SET label = :label, academic_year = :academic_year, url = :url,
                        period_start = :period_start, updated_at = :updated_at
                    WHERE id = :id
                    """
                ),
                _time_sheet_params(updated),
            )
        return updated

    # --------------------------------------------------------------- comments

    def comments_of(self, teacher_id: str) -> list[dict[str, Any]]:
        """Everything said about one teacher, oldest first — a thread reads down."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT id, teacher_id, body, author_email, author_name, created_at
                            FROM teacher_comments WHERE teacher_id = :teacher
                            ORDER BY created_at, id"""),
                    {"teacher": str(teacher_id or "").strip()},
                )
                .mappings()
                .all()
            )
        return [_teacher_comment(row) for row in rows]

    def add_comment(self, *, teacher_id: str, body: str, author_email: str, author_name: str) -> dict[str, Any]:
        """One line on the teacher's thread, signed by whoever is signed in and dated now.

        The body keeps its line breaks: a comment is prose, not a field.
        """
        row = {
            "id": str(uuid4()),
            "teacher_id": str(teacher_id or "").strip(),
            "body": str(body or "").strip(),
            "author_email": str(author_email or "").strip(),
            "author_name": str(author_name or "").strip(),
            "created_at": _timestamp(),
        }
        with self.engine.begin() as connection:
            connection.execute(
                text("""INSERT INTO teacher_comments (id, teacher_id, body, author_email, author_name, created_at)
                        VALUES (:id, :teacher_id, :body, :author_email, :author_name, :created_at)"""),
                row,
            )
        return _teacher_comment(row)

    def remove_comment(self, comment_id: str, *, author_email: str) -> None:
        """A line is its author's to take back, and nobody else's."""
        with self.engine.begin() as connection:
            held = connection.execute(
                text("SELECT author_email FROM teacher_comments WHERE id = :id"), {"id": comment_id}
            ).scalar()
            if held is None:
                raise CommentNotFound(comment_id)
            if str(held).casefold() != str(author_email or "").strip().casefold():
                raise NotTheAuthor(comment_id)
            connection.execute(text("DELETE FROM teacher_comments WHERE id = :id"), {"id": comment_id})

    def comment_counts(self) -> dict[str, dict[str, Any]]:
        """How many lines each teacher carries, and when the last was written — for the rows."""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text("""SELECT teacher_id, COUNT(*) AS lines, MAX(created_at) AS last_at
                            FROM teacher_comments GROUP BY teacher_id""")
                )
                .mappings()
                .all()
            )
        return {row["teacher_id"]: {"count": int(row["lines"]), "lastAt": row["last_at"]} for row in rows}

    # ------------------------------------------------------- what a row shows

    def library_summary(self) -> dict[str, dict[str, Any]]:
        """Per teacher, what the list needs to show: one pass, not one request per row.

        The list is two dozen people and every fact on a row lives in a different table.
        Asked profile by profile that is fifty round trips to draw one page, so it is
        asked once here and the page reads what it needs out of the answer.
        """
        with self.engine.connect() as connection:
            requisitions = (
                connection.execute(
                    text("SELECT teacher_id, content_json::text AS content FROM teacher_requisitions")
                )
                .mappings()
                .all()
            )
            sheets = (
                connection.execute(
                    text("""SELECT id, teacher_id, label, academic_year, url, period_start,
                                   created_at, updated_at
                            FROM teacher_time_sheets
                            ORDER BY period_start DESC, updated_at DESC""")
                )
                .mappings()
                .all()
            )
            with_documents = {
                row[0] for row in connection.execute(text("SELECT teacher_id FROM teacher_document_folders"))
            }

        found: dict[str, dict[str, Any]] = {}

        def entry(teacher_id: str) -> dict[str, Any]:
            return found.setdefault(
                teacher_id,
                {
                    "requisitions": 0,
                    "contractedHours": 0.0,
                    "timeSheets": 0,
                    "newestTimeSheet": None,
                    "hasDocuments": teacher_id in with_documents,
                },
            )

        for row in requisitions:
            mine = entry(row["teacher_id"])
            mine["requisitions"] += 1
            mine["contractedHours"] += _contracted_hours(row["content"])
        for row in sheets:
            mine = entry(row["teacher_id"])
            mine["timeSheets"] += 1
            # Ordered newest period first, so the first one seen for a teacher is theirs.
            if mine["newestTimeSheet"] is None:
                mine["newestTimeSheet"] = _time_sheet_from_row(row)
        for teacher_id in with_documents:
            entry(teacher_id)
        for mine in found.values():
            mine["contractedHours"] = round(mine["contractedHours"] + 0.0, 3)
        return found

    def delete_time_sheet(self, time_sheet_id: str) -> None:
        self.get_time_sheet(time_sheet_id)
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM teacher_time_sheets WHERE id = :id"), {"id": time_sheet_id})

    def import_course_catalogue(self, rows: list[dict[str, str]]) -> dict[str, int]:
        """Replace the active catalogue snapshot while retaining prior course versions.

        CRN is the source-system identity. A changed record with the same CRN is
        retained as an obsolete version, rather than updated in place, so older
        requisitions can continue to describe the course they originally used.
        """
        catalogue_rows = [_catalogue_row(row) for row in rows]
        crns = [row["crn"] for row in catalogue_rows]
        if not catalogue_rows:
            raise ValueError("The workbook does not contain any courses with a CRN, course code, and course title.")
        if len(set(crns)) != len(crns):
            raise ValueError("The workbook contains more than one row with the same CRN.")

        now = _timestamp()
        imported = retained = obsoleted = 0
        with self.engine.begin() as connection:
            active_rows = (
                connection.execute(
                    text(
                        """
                    SELECT id, crn, term, course_code, course_title, sequence, credit,
                           department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                    FROM course_catalogue_entries
                    WHERE is_obsolete = FALSE
                    """
                    )
                )
                .mappings()
                .all()
            )
            active_by_crn = {row["crn"]: row for row in active_rows}

            for record in catalogue_rows:
                current = active_by_crn.get(record["crn"])
                if current is not None and _catalogue_matches(current, record):
                    retained += 1
                    connection.execute(
                        text("UPDATE course_catalogue_entries SET imported_at = :imported_at WHERE id = :id"),
                        {"id": current["id"], "imported_at": now},
                    )
                    continue

                if current is not None:
                    connection.execute(
                        text(
                            """
                            UPDATE course_catalogue_entries
                            SET is_obsolete = TRUE, obsolete_at = :obsolete_at
                            WHERE id = :id
                            """
                        ),
                        {"id": current["id"], "obsolete_at": now},
                    )
                    obsoleted += 1

                entry = {"id": str(uuid4()), **record, "importedAt": now, "obsoleteAt": None}
                connection.execute(
                    text(
                        """
                        INSERT INTO course_catalogue_entries (
                            id, crn, term, course_code, course_title, sequence, credit,
                            department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                        ) VALUES (
                            :id, :crn, :term, :course_code, :course_title, :sequence, :credit,
                            :department, :level, :college, :contact_hours, FALSE, :imported_at, :obsolete_at
                        )
                        """
                    ),
                    _catalogue_params(entry),
                )
                imported += 1

            for current in active_rows:
                if current["crn"] in crns:
                    continue
                connection.execute(
                    text(
                        """
                        UPDATE course_catalogue_entries
                        SET is_obsolete = TRUE, obsolete_at = :obsolete_at
                        WHERE id = :id
                        """
                    ),
                    {"id": current["id"], "obsolete_at": now},
                )
                obsoleted += 1

            total_active = connection.execute(
                text("SELECT COUNT(*) FROM course_catalogue_entries WHERE is_obsolete = FALSE")
            ).scalar_one()
        return {"imported": imported, "retained": retained, "obsoleted": obsoleted, "totalActive": total_active}

    def list_academic_years(self) -> list[str]:
        """The academic years the imported courses belong to.

        The portal names a term by a code whose first four digits are the two years it
        spans: 262710 is the 2026-2027 year. Nothing else the portal gives us says the
        year in words, so it is read back out of the code.
        """
        with self.engine.connect() as connection:
            codes = connection.execute(
                text("SELECT DISTINCT term FROM course_catalogue_entries WHERE term <> ''")
            ).scalars()
        years = {year for year in (_academic_year(code) for code in codes) if year}
        return sorted(years, reverse=True)

    def list_courses_by_code(self, *, query: str = "") -> list[dict[str, Any]]:
        """The courses a syllabus may be written for: one entry per course, not per section.

        The portal numbers a course's rows in sequence. The lowest is the course itself
        and carries its official name; the rest are its sections, whose names pick up
        the kind of session or the group ("-CM", "TD Gr1"). Where several rows share the
        lowest number the shortest name is the course's, the longer ones being sections
        that were never numbered apart.
        """
        filters = ["is_obsolete = FALSE"]
        params: dict[str, str] = {}
        if query.strip():
            filters.append("(course_code ILIKE :query OR course_title ILIKE :query)")
            params["query"] = f"%{query.strip()}%"
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                    SELECT course_code, course_title, sequence, credit, department,
                           college, contact_hours, term, crn
                    FROM course_catalogue_entries
                    WHERE {" AND ".join(filters)}
                    """
                    ),
                    params,
                )
                .mappings()
                .all()
            )

        grouped: dict[str, dict[str, Any]] = {}
        for row in rows:
            course = grouped.setdefault(
                row["course_code"],
                {
                    "courseCode": row["course_code"],
                    "courseTitle": "",
                    "credit": "",
                    "level": "",
                    "department": row["department"] or "",
                    "college": row["college"] or "",
                    "contactHours": "",
                    "terms": set(),
                    "crns": set(),
                    "_rank": None,
                },
            )
            rank = _sequence_rank(row["sequence"], row["course_title"])
            if course["_rank"] is None or rank < course["_rank"]:
                course["_rank"] = rank
                course["courseTitle"] = (row["course_title"] or "").strip()
            course["credit"] = course["credit"] or (row["credit"] or "")
            course["contactHours"] = course["contactHours"] or (row["contact_hours"] or "")
            if row["term"]:
                course["terms"].add(row["term"])
            if row["crn"]:
                course["crns"].add(row["crn"])

        courses = []
        for course in grouped.values():
            course.pop("_rank")
            course["terms"] = sorted(course["terms"])
            course["crns"] = sorted(course["crns"])
            courses.append(course)
        return sorted(courses, key=lambda item: (item["courseTitle"].casefold(), item["courseCode"]))

    def list_course_catalogue(self, *, query: str = "", include_obsolete: bool = False) -> list[dict[str, Any]]:
        filters = [] if include_obsolete else ["is_obsolete = FALSE"]
        params: dict[str, str] = {}
        if query.strip():
            filters.append("(crn ILIKE :query OR course_code ILIKE :query OR course_title ILIKE :query)")
            params["query"] = f"%{query.strip()}%"
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""
                    SELECT id, crn, term, course_code, course_title, sequence, credit,
                           department, level, college, contact_hours, is_obsolete, imported_at, obsolete_at
                    FROM course_catalogue_entries
                    {where}
                    ORDER BY is_obsolete ASC, course_title ASC, course_code ASC, crn ASC
                    """
                    ),
                    params,
                )
                .mappings()
                .all()
            )  # noqa: S608
        return [_catalogue_from_row(row) for row in rows]

    def _folder_exists(self, folder_id: str) -> bool:
        with self.engine.connect() as connection:
            return (
                connection.execute(text("SELECT 1 FROM teacher_folders WHERE id = :id"), {"id": folder_id}).first()
                is not None
            )


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def default_content() -> dict[str, Any]:
    return {
        "department": "Department of Sciences and Engineering",
        "program": "",
        "jobTitle": "Part Time Lecturer",
        "classType": "TD",
        "employeeType": "PT",
        "contractFrom": "",
        "contractTo": "",
        "courses": [],
    }


def _teacher_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "folderId": row["folder_id"],
        "fullName": row["full_name"],
        "email": row["email"],
        "phone": row["phone"],
        "notes": row["notes"],
        "archivedAt": row["archived_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _teacher_params(teacher: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": teacher["id"],
        "folder_id": teacher["folderId"],
        "full_name": teacher["fullName"],
        "email": teacher["email"],
        "phone": teacher["phone"],
        "notes": teacher["notes"],
        "archived_at": teacher["archivedAt"],
        "created_at": teacher["createdAt"],
        "updated_at": teacher["updatedAt"],
    }


def _folder_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "parentId": row["parent_id"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _web_link(url: str) -> str:
    """A link this profile will put behind a button, or nothing.

    Only `http` and `https` with a host. The check is not about tidiness: a stored
    `javascript:` address would run as script the moment a coordinator clicked the
    teacher's name for it, so the scheme is decided here rather than trusted from
    whatever was pasted. OneDrive's own share links are long and query-heavy, and pass.
    """
    cleaned = " ".join(str(url or "").split())
    parsed = urlparse(cleaned)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise InvalidTimeSheetLink
    return cleaned


_HOURS = re.compile(r"\d+(?:[.,]\d+)?")


def _contracted_hours(content_json: str) -> float:
    """What one requisition's courses come to, read the way the editor adds them up.

    The hours are typed by a person, so "21", "21 h" and "21,5" all occur; the first
    number in the cell is the figure, which is what `totalTeachingHours` in the browser
    has always taken. A requisition whose content cannot be read at all contributes
    nothing rather than breaking the page it is counted for.
    """
    try:
        courses = json.loads(content_json or "{}").get("courses") or []
    except (TypeError, ValueError):
        return 0.0
    total = 0.0
    for course in courses:
        found = _HOURS.search(str(course.get("hours", "")))
        if found:
            total += float(found.group(0).replace(",", "."))
    return total


def _period(value: str) -> str:
    """The day a pay period starts, as a plain date, or nothing.

    Which day that is belongs to the department, not to this table: the cycle runs the
    15th to the 14th today and the column would outlive a decision to change it. So the
    date is checked for being a date and stored as written, and the screens that offer
    the choice are the ones that know the cycle.
    """
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    try:
        return date.fromisoformat(cleaned).isoformat()
    except ValueError as exc:
        raise InvalidPeriod from exc


def _time_sheet_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "teacherId": row["teacher_id"],
        "label": row["label"],
        "academicYear": row["academic_year"],
        "url": row["url"],
        "periodStart": row["period_start"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _time_sheet_params(sheet: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": sheet["id"],
        "teacher_id": sheet["teacherId"],
        "label": sheet["label"],
        "academic_year": sheet["academicYear"],
        "url": sheet["url"],
        "period_start": sheet["periodStart"],
        "created_at": sheet["createdAt"],
        "updated_at": sheet["updatedAt"],
    }


def _requisition_summary_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "teacherId": row["teacher_id"],
        "label": row["label"],
        "academicYear": row["academic_year"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _requisition_params(requisition: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": requisition["id"],
        "teacher_id": requisition["teacherId"],
        "label": requisition["label"],
        "academic_year": requisition["academicYear"],
        "content_json": json.dumps(requisition["content"]),
        "revision": requisition["revision"],
        "created_at": requisition["createdAt"],
        "updated_at": requisition["updatedAt"],
    }


_CATALOGUE_FIELDS = (
    "crn",
    "term",
    "courseCode",
    "courseTitle",
    "sequence",
    "credit",
    "department",
    "level",
    "college",
    "contactHours",
)


def _catalogue_row(row: dict[str, str]) -> dict[str, str]:
    normalized = {field: str(row.get(field, "") or "").strip() for field in _CATALOGUE_FIELDS}
    if not normalized["crn"] or not normalized["courseCode"] or not normalized["courseTitle"]:
        raise ValueError("Every imported course must have a CRN, course code, and course title.")
    return normalized


def _catalogue_matches(current: Any, candidate: dict[str, str]) -> bool:
    return all(current[_snake_case(field)] == candidate[field] for field in _CATALOGUE_FIELDS)


def _catalogue_from_row(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "crn": row["crn"],
        "term": row["term"],
        "courseCode": row["course_code"],
        "courseTitle": row["course_title"],
        "sequence": row["sequence"],
        "credit": row["credit"],
        "department": row["department"],
        "level": row["level"],
        "college": row["college"],
        "contactHours": row["contact_hours"],
        "isObsolete": row["is_obsolete"],
        "importedAt": row["imported_at"],
        "obsoleteAt": row["obsolete_at"],
    }


def _catalogue_params(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entry["id"],
        "crn": entry["crn"],
        "term": entry["term"],
        "course_code": entry["courseCode"],
        "course_title": entry["courseTitle"],
        "sequence": entry["sequence"],
        "credit": entry["credit"],
        "department": entry["department"],
        "level": entry["level"],
        "college": entry["college"],
        "contact_hours": entry["contactHours"],
        "imported_at": entry["importedAt"],
        "obsolete_at": entry["obsoleteAt"],
    }


def _snake_case(field: str) -> str:
    return {
        "courseCode": "course_code",
        "courseTitle": "course_title",
        "contactHours": "contact_hours",
    }.get(field, field)


def _academic_year(term_code: str) -> str:
    """262710 -> "2026-2027". Anything that is not a term code reads as nothing."""
    digits = "".join(character for character in str(term_code or "") if character.isdigit())
    if len(digits) < ACADEMIC_YEAR_DIGITS:
        return ""
    start, end = digits[:2], digits[2:4]
    if not start.isdigit() or not end.isdigit():
        return ""
    return f"20{start}-20{end}"


ACADEMIC_YEAR_DIGITS = 4

# Words that stay lowercase inside a title, unless they open it.
_TITLE_MINOR_WORDS = frozenset(
    {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"}
)


def course_title_case(title: str) -> str:
    """Capitalise a title's own words without touching anything already capitalised.

    The registrar's export is inconsistent — "Geometric optics" beside "Mechanics-Physics
    1" — and a syllabus now takes its title from here, so the inconsistency shows. Only
    words that are entirely lowercase are raised, which leaves AI, CAO-DAO and ADGM M2
    exactly as the registrar wrote them.
    """
    words = title.split(" ")
    result = []
    for index, word in enumerate(words):
        if not word or not word.islower():
            result.append(word)
            continue
        if index and word in _TITLE_MINOR_WORDS:
            result.append(word)
            continue
        result.append(word[0].upper() + word[1:])
    return " ".join(result)


_UNNUMBERED = 9999


def _sequence_rank(sequence: str, title: str) -> tuple[int, int, str]:
    """Order a course's rows so the lowest is the course itself."""
    try:
        number = int(str(sequence).strip())
    except (TypeError, ValueError):
        number = _UNNUMBERED
    name = (title or "").strip()
    return (number, len(name), name)


def _teacher_comment(row: Any) -> dict[str, Any]:
    return {
        "id": row["id"],
        "teacherId": row["teacher_id"],
        "body": row["body"],
        "authorEmail": row["author_email"],
        "authorName": row["author_name"],
        "createdAt": row["created_at"],
    }
