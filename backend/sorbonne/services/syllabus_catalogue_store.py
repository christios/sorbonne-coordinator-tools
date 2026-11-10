"""Persistent shared catalogue records for template-aware syllabi."""
# ruff: noqa: PLR0913

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime
import json
from typing import Any
from uuid import uuid4

from sqlalchemy import Engine, text
from sqlalchemy.engine import RowMapping

from sorbonne.services.syllabus_content import graded_activities
from sorbonne.services.engine import engine_for


CATALOGUE_CATEGORIES = frozenset(
    {
        "people",
        "programmes",
        "plos",
        "competencies",
        "graduate-competencies",
        "ai-policies",
        "curriculum-mapping",
        "teaching-presets",
        "assessment-types",
        "bibliography-types",
        # The ranks a person's "Academic rank / status" is chosen from (Christian, 10 Nov 2026).
        "academic-ranks",
    }
)


class CatalogueNotFound(Exception):
    pass


class CatalogueRevisionConflict(Exception):
    pass


class SyllabusCatalogueStore:
    """PostgreSQL-backed catalogue records. Retiring is deliberately non-destructive."""

    def __init__(self, database_url: str) -> None:
        self.engine: Engine = engine_for(database_url)

    def list(
        self,
        category: str,
        *,
        query: str = "",
        include_retired: bool = False,
        parent_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:  # noqa: PLR0913
        self._category(category)
        clauses = ["category = :category"]
        params: dict[str, Any] = {"category": category, "limit": min(max(limit, 1), 200), "offset": max(offset, 0)}
        if not include_retired:
            clauses.append("is_retired = FALSE")
        if parent_id is not None:
            clauses.append("parent_id = :parent_id")
            params["parent_id"] = parent_id
        if query.strip():
            clauses.append("label ILIKE :query")
            params["query"] = f"%{query.strip()}%"
        where = " AND ".join(clauses)
        with self.engine.connect() as connection:
            rows = (
                connection.execute(
                    text(
                        f"""SELECT *, payload::text AS payload_json
                        FROM syllabus_catalogue_items
                        WHERE {where}
                        ORDER BY sort_order, label, id
                        LIMIT :limit OFFSET :offset"""
                    ),
                    params,
                )
                .mappings()
                .all()
            )
        return [_item(row) for row in rows]

    def get(self, category: str, item_id: str) -> dict[str, Any]:
        self._category(category)
        with self.engine.connect() as connection:
            row = (
                connection.execute(
                    text(
                        """SELECT *, payload::text AS payload_json
                        FROM syllabus_catalogue_items
                        WHERE category = :category AND id = :id"""
                    ),
                    {"category": category, "id": item_id},
                )
                .mappings()
                .first()
            )
        if row is None:
            raise CatalogueNotFound
        return _item(row)

    def create(
        self, category: str, *, label: str, payload: dict[str, Any], parent_id: str | None = None, sort_order: int = 0
    ) -> dict[str, Any]:
        self._category(category)
        now = _timestamp()
        item = {
            "id": str(uuid4()),
            "category": category,
            "parentId": parent_id,
            "label": label.strip(),
            "payload": payload,
            "sortOrder": sort_order,
            "isRetired": False,
            "retiredAt": None,
            "revision": 1,
            "createdAt": now,
            "updatedAt": now,
        }
        with self.engine.begin() as connection:
            connection.execute(
                text(
                    """INSERT INTO syllabus_catalogue_items (
                        id, category, parent_id, label, payload, sort_order,
                        is_retired, retired_at, revision, created_at, updated_at
                    ) VALUES (
                        :id, :category, :parent_id, :label, CAST(:payload AS JSONB), :sort_order,
                        FALSE, NULL, :revision, :created_at, :updated_at
                    )"""
                ),
                {
                    "id": item["id"],
                    "category": category,
                    "parent_id": parent_id,
                    "label": item["label"],
                    "payload": json.dumps(payload),
                    "sort_order": sort_order,
                    "revision": 1,
                    "created_at": now,
                    "updated_at": now,
                },
            )
        return item

    def update(
        self,
        category: str,
        item_id: str,
        *,
        expected_revision: int,
        label: str,
        payload: dict[str, Any],
        parent_id: str | None = None,
        sort_order: int = 0,
    ) -> dict[str, Any]:  # noqa: PLR0913
        current = self.get(category, item_id)
        if current["revision"] != expected_revision:
            raise CatalogueRevisionConflict
        updated_at = _timestamp()
        revision = expected_revision + 1
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """UPDATE syllabus_catalogue_items
                    SET label = :label, payload = CAST(:payload AS JSONB), parent_id = :parent_id,
                        sort_order = :sort_order, revision = :revision, updated_at = :updated_at
                    WHERE id = :id AND category = :category AND revision = :expected_revision"""
                ),
                {
                    "id": item_id,
                    "category": category,
                    "expected_revision": expected_revision,
                    "label": label.strip(),
                    "payload": json.dumps(payload),
                    "parent_id": parent_id,
                    "sort_order": sort_order,
                    "revision": revision,
                    "updated_at": updated_at,
                },
            )
        if result.rowcount != 1:
            raise CatalogueRevisionConflict
        return {
            **current,
            "label": label.strip(),
            "payload": payload,
            "parentId": parent_id,
            "sortOrder": sort_order,
            "revision": revision,
            "updatedAt": updated_at,
        }

    def retire(self, category: str, item_id: str, *, expected_revision: int) -> dict[str, Any]:
        current = self.get(category, item_id)
        if current["revision"] != expected_revision:
            raise CatalogueRevisionConflict
        now = _timestamp()
        with self.engine.begin() as connection:
            result = connection.execute(
                text(
                    """UPDATE syllabus_catalogue_items
                    SET is_retired = TRUE, retired_at = :retired_at, revision = :revision,
                        updated_at = :updated_at
                    WHERE id = :id AND category = :category AND revision = :expected_revision"""
                ),
                {
                    "id": item_id,
                    "category": category,
                    "expected_revision": expected_revision,
                    "retired_at": now,
                    "revision": expected_revision + 1,
                    "updated_at": now,
                },
            )
        if result.rowcount != 1:
            raise CatalogueRevisionConflict
        return {**current, "isRetired": True, "retiredAt": now, "revision": expected_revision + 1, "updatedAt": now}

    def resolve_people(self, content: dict[str, Any]) -> dict[str, Any]:
        """Return a display/export copy with linked People data applied, never mutating stored JSON."""
        resolved = deepcopy(content)
        contacts = _record(resolved.get("contacts"))
        instructor = _record(contacts.get("instructor"))
        instructor_id = _text(instructor.get("personId"))
        if instructor_id:
            contacts["instructor"] = {**instructor, **_scen_instructor(self._person(instructor_id))}
            resolved["contacts"] = contacts
        coordinator = _record(contacts.get("administrativeContact"))
        coordinator_id = _text(coordinator.get("personId"))
        if coordinator_id:
            person = self._person(coordinator_id)
            contacts["administrativeContact"] = {
                **coordinator,
                "name": person["label"],
                "contactDetails": _contact_details(person),
            }
            resolved["contacts"] = contacts
        faculty = _record(resolved.get("facultyDetails"))
        faculty_id = _text(faculty.get("personId"))
        if faculty_id:
            person = self._person(faculty_id)
            payload = person["payload"]
            rank = _text(payload.get("academicRank"))
            affiliations = _affiliations(payload)
            faculty.update(
                {
                    "staffText": " · ".join(part for part in (person["label"], rank) if part),
                    "staff": [
                        {
                            "nameAndStatus": " · ".join(part for part in (person["label"], rank) if part),
                            "email": _text(payload.get("email")),
                        }
                    ],
                    "institution": affiliations,
                    "officeHours": _office_hours(payload),
                    "email": _text(payload.get("email")),
                }
            )
            resolved["facultyDetails"] = faculty
        return resolved

    def resolve_plos(self, content: dict[str, Any]) -> dict[str, Any]:
        """Return an export copy whose PLOs come from the programme's catalogue.

        Programme learning outcomes are owned by the catalogue, not by the syllabus, so
        a syllabus linked to a programme carries no PLO text of its own. Without this the
        exported document printed the PLO table's labels against empty cells.
        """
        resolved = deepcopy(content)
        identification = _record(resolved.get("identification"))
        programme_id = _text(identification.get("cataloguePloProgrammeId")) or _text(
            identification.get("catalogueProgrammeId")
        )
        if not programme_id:
            return resolved
        entries = self.list("plos", parent_id=programme_id)
        if not entries:
            return resolved
        outcomes = _record(resolved.get("learningOutcomes"))
        outcomes["plos"] = [
            {
                "id": entry["id"],
                "code": _text(_record(entry.get("payload")).get("code")) or _text(entry.get("label")),
                "outcome": _text(_record(entry.get("payload")).get("outcome")),
            }
            for entry in entries
        ]
        resolved["learningOutcomes"] = outcomes
        return resolved

    def resolve_outcomes(
        self, content: dict[str, Any], *, course_code: str, mode: str, programme_title: str = ""
    ) -> dict[str, Any]:
        """When the Head of Department writes the outcomes, the course's come from the catalogue.

        November 2026 review: in that mode a course's CLOs, their aligned PLOs and their SCEN
        competencies are written once in the curriculum mapping and every syllabus of the
        course shows them; the graded activities assess them by the ids they picked
        (`catalogueCloIds`). The CLOs a teacher wrote stay stored, untouched, for the day the
        department switches back. In teacher mode nothing changes.
        """
        if mode != "hod":
            return content
        resolved = deepcopy(content)
        identification = _record(resolved.get("identification"))
        programme_id = _text(identification.get("cataloguePloProgrammeId")) or _text(
            identification.get("catalogueProgrammeId")
        )
        if not programme_id and programme_title:
            # A Foundation Year syllabus names no programme: its courses are mapped under the
            # catalogue programme of that name, which has no PLOs.
            wanted_title = " ".join(programme_title.split()).casefold()
            programme_id = next(
                (
                    item["id"]
                    for item in self.list("programmes")
                    if " ".join(_text(item.get("label")).split()).casefold() == wanted_title
                ),
                "",
            )
        wanted = _course_key(course_code)
        entry = next(
            (
                item
                for item in (self.list("curriculum-mapping", parent_id=programme_id) if programme_id else [])
                if wanted and _course_key(item.get("label")) == wanted
            ),
            None,
        )
        written = _record(entry.get("payload")).get("clos") if entry else None
        plos = (
            {item["id"]: item for item in self.list("plos", parent_id=programme_id, include_retired=True)}
            if programme_id
            else {}
        )
        competencies = {item["id"]: item for item in self.list("competencies", include_retired=True)} if written else {}
        rows = []
        for item in written if isinstance(written, list) else []:
            clo = _record(item)
            plo_ids = [str(plo_id) for plo_id in clo.get("ploIds") or [] if str(plo_id) in plos]
            skill_ids = [str(skill_id) for skill_id in clo.get("skillIds") or [] if str(skill_id) in competencies]
            rows.append(
                {
                    "id": _text(clo.get("id")),
                    "clo": _text(clo.get("clo")),
                    # The Foundation Year form reads a course outcome as "outcome".
                    "outcome": _text(clo.get("clo")),
                    "plo": "\n".join(_coded(plos[plo_id]) for plo_id in plo_ids),
                    "ploIds": "\n".join(plo_ids),
                    "skills": "\n".join(_coded(competencies[skill_id]) for skill_id in skill_ids),
                    "skillIds": "\n".join(skill_ids),
                }
            )
        outcomes = _record(resolved.get("learningOutcomes"))
        outcomes["clos"] = rows
        resolved["learningOutcomes"] = outcomes
        for activity in graded_activities(resolved):
            picked = activity.get("catalogueCloIds")
            activity["cloIds"] = [str(item) for item in picked] if isinstance(picked, list) else []
            activity["clos"] = ""
        return resolved

    def programme_has_plos(self, content: dict[str, Any]) -> bool:
        """Whether the syllabus's programme gives a CLO anything to align to.

        A programme typed in by hand, or the Foundation Year's, has no catalogue PLOs; the
        editor then offers none, so a CLO cannot be asked to name one.
        """
        identification = _record(content.get("identification"))
        programme_id = _text(identification.get("cataloguePloProgrammeId")) or _text(
            identification.get("catalogueProgrammeId")
        )
        return bool(programme_id and self.list("plos", parent_id=programme_id, limit=1))

    def expected_plos(self, content: dict[str, Any], *, course_code: str) -> dict[str, str]:
        """The current PLOs the curriculum mapping expects of the course: id to code, in its order.

        The same list the editor offers a CLO (outcomes.ts, alignablePlos); empty when the
        syllabus names no catalogue programme or the mapping does not list the course.
        """
        identification = _record(content.get("identification"))
        programme_id = _text(identification.get("cataloguePloProgrammeId")) or _text(
            identification.get("catalogueProgrammeId")
        )
        wanted = _course_key(course_code)
        if not (programme_id and wanted):
            return {}
        entry = next(
            (
                item
                for item in self.list("curriculum-mapping", parent_id=programme_id)
                if _course_key(item.get("label")) == wanted
            ),
            None,
        )
        expected = _record(entry.get("payload")).get("ploIds") if entry else None
        if not isinstance(expected, list):
            return {}
        current = {item["id"]: item for item in self.list("plos", parent_id=programme_id)}
        return {
            str(plo_id): _text(_record(current[str(plo_id)].get("payload")).get("code"))
            or _text(current[str(plo_id)].get("label"))
            for plo_id in expected
            if str(plo_id) in current
        }

    def resolve_competencies(self, content: dict[str, Any]) -> dict[str, Any]:
        """Fill each outcome's SUAD competencies from the SCEN ones it develops.

        The professor picks SCEN competencies; which SUAD graduate competencies those
        develop is the catalogue's mapping, not a second thing to type.
        """
        resolved = deepcopy(content)
        outcomes = _record(resolved.get("learningOutcomes"))
        clos = [item for item in outcomes.get("clos") or [] if isinstance(item, dict)]
        if not clos:
            return resolved
        graduate = {item["id"]: item for item in self.list("graduate-competencies", include_retired=True)}
        scen = {item["id"]: item for item in self.list("competencies", include_retired=True)}
        updated = []
        for clo in clos:
            labels: list[str] = []
            for competency_id in _text(clo.get("skillIds")).split("\n"):
                competency = scen.get(competency_id.strip())
                if competency is None:
                    continue
                for graduate_id in _record(competency.get("payload")).get("graduateCompetencyIds") or []:
                    entry = graduate.get(str(graduate_id))
                    if entry is not None and entry["label"] not in labels:
                        labels.append(entry["label"])
            updated.append({**clo, "suadSkills": "\n".join(labels)} if labels else clo)
        outcomes["clos"] = updated
        resolved["learningOutcomes"] = outcomes
        return resolved

    def resolve_teaching_approach(self, content: dict[str, Any]) -> dict[str, Any]:
        """Compose section 8 from the approved presets the course selected.

        Each subsection names the kind of session it describes, so a course taught as
        lectures and tutorials reads as two labelled blocks rather than one run-on
        paragraph in which neither can be told from the other.
        """
        resolved = deepcopy(content)
        approach = _record(resolved.get("teachingApproach"))
        preset_ids = [item for item in approach.get("teachingPresetIds") or [] if isinstance(item, str)]
        if not preset_ids:
            return resolved
        presets = {item["id"]: item for item in self.list("teaching-presets", include_retired=True)}
        chosen = [presets[item] for item in preset_ids if item in presets]
        if not chosen:
            return resolved
        for key in ("methods", "engagement", "feedback"):
            blocks = [
                f"{preset['label']}: {_text(_record(preset.get('payload')).get(key))}"
                for preset in chosen
                if _text(_record(preset.get("payload")).get(key))
            ]
            if blocks:
                approach[key] = "\n\n".join(blocks)
        resolved["teachingApproach"] = approach
        return resolved

    def resolve_rubrics(self, content: dict[str, Any]) -> dict[str, Any]:
        """The rubrics the syllabus prints: exactly one per kind of graded activity it has.

        A course does not write its own rubrics: an activity of a catalogue assessment type
        brings that type's approved rubric. Older syllabi named the type in their own words
        and wrote a rubric by hand; such a rubric is kept only while an activity of that
        kind still exists (November 2026 review: the preview must be faithful to the
        graded activities), and with no activities there is no rubric at all.
        """
        resolved = deepcopy(content)
        if "assessment" not in resolved:
            return resolved
        assessment = _record(resolved.get("assessment"))
        used: list[str] = []
        typed: list[str] = []
        for item in graded_activities(resolved):
            type_id = _text(_record(item).get("assessmentTypeId"))
            if type_id:
                if type_id not in used:
                    used.append(type_id)
                continue
            kind = _normalised_kind(_record(item).get("type"))
            if kind and kind not in typed:
                typed.append(kind)
        types = {item["id"]: item for item in self.list("assessment-types", include_retired=True)} if used else {}
        rubrics = []
        for type_id in used:
            preset = types.get(type_id)
            if preset is None:
                continue
            criteria = _record(preset.get("payload")).get("criteria")
            rubrics.append(
                {
                    "id": preset["id"],
                    "assignment": preset["label"],
                    "criteria": [
                        {
                            "criterion": _text(_record(item).get("name")),
                            "inadequate": _text(_record(item).get("inadequate")),
                            "meets": _text(_record(item).get("meets")),
                            "exceeds": _text(_record(item).get("exceeds")),
                        }
                        for item in (criteria if isinstance(criteria, list) else [])
                    ],
                }
            )
        written = {
            _normalised_kind(_record(rubric).get("assignment")): rubric for rubric in assessment.get("rubrics") or []
        }
        rubrics.extend(written[kind] for kind in typed if kind in written)
        assessment["rubrics"] = rubrics
        resolved["assessment"] = assessment
        return resolved

    def _person(self, item_id: str) -> dict[str, Any]:
        try:
            return self.get("people", item_id)
        except CatalogueNotFound:
            return {"id": item_id, "label": "Retired contact", "payload": {}}

    @staticmethod
    def _category(category: str) -> None:
        if category not in CATALOGUE_CATEGORIES:
            raise CatalogueNotFound


def _item(row: RowMapping) -> dict[str, Any]:
    return {
        "id": row["id"],
        "category": row["category"],
        "parentId": row["parent_id"],
        "label": row["label"],
        "payload": json.loads(row["payload_json"]),
        "sortOrder": row["sort_order"],
        "isRetired": row["is_retired"],
        "retiredAt": row["retired_at"],
        "revision": row["revision"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _scen_instructor(person: dict[str, Any]) -> dict[str, Any]:
    payload = person["payload"]
    affiliations = _affiliations(payload)
    return {
        "Name": person["label"],
        "Academic rank / status": _text(payload.get("academicRank")),
        "Affiliation(s)": affiliations,
        "affiliations": [
            {"id": f"linked-{index}", "name": value}
            for index, value in enumerate(affiliations.split("\n"), start=1)
            if value
        ],
        "Office hours and location": _office_hours(payload),
        "Email": _text(payload.get("email")),
    }


def _contact_details(person: dict[str, Any]) -> str:
    payload = person["payload"]
    return " · ".join(
        part for part in (_text(payload.get("email")), _text(payload.get("phone")), _office_hours(payload)) if part
    )


def _affiliations(payload: dict[str, Any]) -> str:
    values = payload.get("affiliations", [])
    if isinstance(values, list):
        return "\n".join(str(value).strip() for value in values if str(value).strip())
    return _text(values)


def _office_hours(payload: dict[str, Any]) -> str:
    values = payload.get("officeHours", [])
    if isinstance(values, list):
        return "\n".join(str(value).strip() for value in values if str(value).strip())
    return _text(values)


def _record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _text(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _normalised_kind(value: Any) -> str:
    """How an activity's kind is matched with a hand-written rubric: case and spacing aside."""
    return " ".join(_text(value).split()).casefold()


def _course_key(value: Any) -> str:
    """A course code as the curriculum mapping is matched on: letters and digits, upper case."""
    return "".join(character for character in _text(value) if character.isalnum()).upper()


def _coded(entry: dict[str, Any]) -> str:
    """A PLO or competency the way a syllabus quotes it: "CODE: outcome"."""
    payload = _record(entry.get("payload"))
    code = _text(payload.get("code")) or _text(entry.get("label"))
    outcome = _text(payload.get("outcome"))
    return f"{code}: {outcome}" if outcome else code
