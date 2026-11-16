"""Hour reductions ("décharges"): the teaching a full-timer is let off, year by year.

A full-time teacher owes 192 hours of teaching a year, and research and responsibilities buy
some of it back. The department kept the reductions in a table by hand, a column per kind, and
the kinds fall in two:

- **research, through SAFIR** — PhD students, master's interns, a project, an HDR, an IRG
  project, internships. The teacher declares these; the Head of Department checks them with
  SAFIR and marks them validated. (When SAFIR sends its own data, the declaring will stop.)
- **the department's own** — committees, heading a programme or the department, joining,
  accreditation work, a pedagogical innovation project. The Head of Department sets these;
  the teacher reads them.

A full-timer goes through theirs as the first step of the timetable preferences request.
The hours are worked out from the rules when read, so a figure an administrator changes
changes every total at once, and nothing stored goes stale.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine

SAFIR, DEPARTMENT = "safir", "department"
#: A teacher's own word, not yet checked; checked with SAFIR; the Head of Department's own.
DECLARED, VALIDATED, SET = "declared", "validated", "set"
SERVICE_HOURS = 192
MOST_STUDENTS = 100
NOTE_LENGTH = 1000
_YEAR = re.compile(r"^(\d{4})-(\d{4})$")
_TERM = re.compile(r"^\d{6}$")

COMMITTEES = (("budget", "Budget"), ("ethics", "Ethics"), ("compliance", "Compliance"))

#: The department's rules, as Lama Tarsissi set them out (November 2026). `per` is the hours
#: for each student or each committee; `cap` the most a kind gives in a year. An
#: administrator may change any figure; the words of each rule are written from the figures.
RULES: list[dict[str, Any]] = [
    {
        "kind": "phd",
        "group": SAFIR,
        "label": "PhD students",
        "unit": "students",
        "per": 5,
        "cap": 20,
        "counts": "PhD student inscribed in or financed by SAFIR",
    },
    {
        "kind": "masters",
        "group": SAFIR,
        "label": "Master's internship students",
        "unit": "students",
        "per": 1,
        "cap": 10,
        "counts": "master's student on internship",
    },
    {
        "kind": "project",
        "group": SAFIR,
        "label": "Research project",
        "unit": "hours",
        "per": 1,
        "cap": None,
        "after": "The hours SAFIR validated for the project.",
    },
    {
        "kind": "hdr",
        "group": SAFIR,
        "label": "HDR (Habilitation à diriger des recherches)",
        "unit": "hours",
        "per": 1,
        "cap": 96,
        "after": "{cap} h by default, the year it is prepared.",
    },
    {
        "kind": "irg",
        "group": SAFIR,
        "label": "IRG project, as principal investigator",
        "unit": "hours",
        "per": 1,
        "cap": 40,
        "threeYears": 80,
        "after": "{threeYears} h over the project's three years, at most {cap} h in one year. The PI only.",
    },
    {
        "kind": "internships",
        "group": SAFIR,
        "label": "Internship supervision",
        "unit": "students",
        "per": 0.5,
        "cap": 10,
        "counts": "student whose internship you supervise (L2, L3 or elsewhere)",
    },
    {
        "kind": "committees",
        "group": DEPARTMENT,
        "label": "University committees",
        "unit": "committees",
        "per": 3,
        "cap": None,
        "after": "{per} h for each: budget, ethics, compliance.",
    },
    {
        "kind": "hop",
        "group": DEPARTMENT,
        "label": "Head of programme",
        "unit": "choice",
        "per": 0,
        "cap": None,
        "options": [
            {"key": "master", "label": "Master's programme", "hours": 32},
            {"key": "bachelor", "label": "Bachelor's programme", "hours": 32},
            {"key": "foundation", "label": "Foundation Year", "hours": 16},
            {"key": "foundation-200", "label": "Foundation Year, over 200 students", "hours": 32},
            {"key": "foundation-500", "label": "Foundation Year, over 500 students", "hours": 48},
        ],
        "after": "Given with Head of department to somebody who is both.",
    },
    {
        "kind": "hod",
        "group": DEPARTMENT,
        "label": "Head of department",
        "unit": "choice",
        "per": 0,
        "cap": None,
        "options": [
            {"key": "hod", "label": "Department of up to 200 students", "hours": 32},
            {"key": "hod-200", "label": "Department of over 200 students", "hours": 42},
            {"key": "hod-500", "label": "Department of over 500 students", "hours": 52},
        ],
    },
    {
        "kind": "new_joiner",
        "group": DEPARTMENT,
        "label": "New joiner",
        "unit": "yes",
        "per": 32,
        "cap": None,
        "after": "{per} h in the first year.",
    },
    {
        "kind": "accreditation",
        "group": DEPARTMENT,
        "label": "Accreditation work",
        "unit": "yes",
        "per": 5,
        "cap": None,
        "after": "{per} h a year.",
    },
    {
        "kind": "innovation",
        "group": DEPARTMENT,
        "label": "Pedagogical innovation project",
        "unit": "hours",
        "per": 1,
        "cap": 18,
        "after": "Up to {cap} h, once the EMC has validated the project.",
    },
]
KINDS = {rule["kind"]: rule for rule in RULES}
#: The figures an administrator may change, per unit.
ADJUSTABLE = {"students": ("per", "cap"), "hours": ("cap", "threeYears"), "committees": ("per",), "yes": ("per",)}


class InvalidReductions(ValueError):
    pass


class NotFullTime(PermissionError):
    """Hour reductions are a full-timer's; this teacher is not one."""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _number(value: Any) -> float:
    return float(value) if isinstance(value, (int, float, Decimal)) else 0.0


def year_of(term_code: str) -> str:
    """The academic year a portal term is in: 262710 and 262720 are both "2026-2027"."""
    term = str(term_code or "").strip()
    if not _TERM.fullmatch(term):
        raise InvalidReductions(f"{term_code!r} is not a portal term.")
    return f"20{term[0:2]}-20{term[2:4]}"


def _checked_year(year: str) -> str:
    match = _YEAR.fullmatch(str(year or "").strip())
    if not match or int(match.group(2)) != int(match.group(1)) + 1:
        raise InvalidReductions(f"{year!r} is not an academic year: write it as 2026-2027.")
    return match.group(0)


def _year_before(year: str, steps: int = 1) -> str:
    start = int(year[:4]) - steps
    return f"{start}-{start + 1}"


def _terms_prefix(year: str) -> str:
    """The first four digits every portal term of the year starts with: 2627 for 2026-2027."""
    return f"{year[2:4]}{year[7:9]}"


def full_time(staff_status: str | None) -> bool:
    """Full time for hour reductions: the department's word on the teacher's record, FT, alone.

    The portal's "Full Time" type is not enough here: it covers the language teachers and
    other departments' staff who teach our students, 32 people against the 21 or so on the
    Head of Department's sheet. Teaching loads still reads the portal type for its budget
    split, where any full-time contract counts."""
    return (staff_status or "").strip().upper() == "FT"


def _fmt(value: float) -> str:
    return f"{value:g}"


def _rule_words(rule: dict[str, Any]) -> str:
    if rule["unit"] == "students":
        return f"{_fmt(rule['per'])} h for each {rule['counts']}, up to {_fmt(rule['cap'])} h."
    if rule["unit"] == "choice":
        options = "; ".join(f"{option['label']}: {_fmt(option['hours'])} h" for option in rule["options"])
        return f"{options}." + (f" {rule['after']}" if rule.get("after") else "")
    after = str(rule.get("after") or "")
    figures = {name: _fmt(rule[name]) for name in ("per", "cap", "threeYears") if rule.get(name) is not None}
    return after.format(**figures)


class HourReductions:
    def __init__(self, engine: Engine) -> None:
        self.engine = engine

    # ------------------------------------------------------------- rules

    def _overrides(self, connection: Any) -> dict[str, dict[str, Any]]:
        return {
            row["kind"]: json.loads(row["figures"] or "{}")
            for row in connection.execute(text("SELECT kind, figures FROM hour_reduction_rules")).mappings()
        }

    def _rules(self, connection: Any) -> tuple[list[dict[str, Any]], int]:
        """The rules with an administrator's figures in, and the yearly service."""
        overrides = self._overrides(connection)
        rules = []
        for base in RULES:
            rule = {**base, **{k: v for k, v in overrides.get(base["kind"], {}).items() if k != "options"}}
            if base["unit"] == "choice":
                given = overrides.get(base["kind"], {}).get("options")
                if isinstance(given, list):
                    # An administrator's own list: options added, renamed or taken away.
                    rule["options"] = [dict(option) for option in given]
                else:
                    # The department's list, with only some hours changed (the first form kept).
                    hours = given if isinstance(given, dict) else {}
                    rule["options"] = [
                        {**option, "hours": hours.get(option["key"], option["hours"])} for option in base["options"]
                    ]
            rule["rule"] = _rule_words(rule)
            rules.append(rule)
        service = int(overrides.get("service", {}).get("hours", SERVICE_HOURS))
        return rules, service

    def rules(self) -> dict[str, Any]:
        with self.engine.connect() as connection:
            rules, service = self._rules(connection)
        return {"service": service, "rules": [_shown_rule(rule) for rule in rules]}

    def set_rules(self, given: dict[str, Any], actor: str = "") -> dict[str, Any]:
        """An administrator's figures. Only what differs from the department's rules is kept.

        A choice's options may be given as a list — `[{key, label, hours}]` — to add, rename or
        take away options: a key kept keeps its teachers, an option without one is new.
        """
        service = given.get("service")
        figures = given.get("rules") or {}
        if not isinstance(figures, dict):
            raise InvalidReductions("Give the rules' figures by kind.")
        kept: dict[str, dict[str, Any]] = {}
        with self.engine.begin() as connection:
            current = {rule["kind"]: rule for rule in self._rules(connection)[0]}
            # A kind not mentioned keeps what it has: a call about the service alone must not
            # take away the options somebody named.
            for kind, held in self._overrides(connection).items():
                if kind in KINDS and kind not in figures:
                    kept[kind] = held
            for kind, values in figures.items():
                base = KINDS.get(kind)
                if base is None or not isinstance(values, dict):
                    raise InvalidReductions(f"{kind!r} is not a kind of hour reduction.")
                changed = _changed_figures(base, values)
                if base["unit"] == "choice":
                    changed = _with_options(connection, base, current[kind]["options"], values, changed)
                if changed:
                    kept[kind] = changed
        if service is not None:
            hours = _number(service)
            if not 1 <= hours <= 500:  # noqa: PLR2004 - a year's service, generously
                raise InvalidReductions("The yearly service is between 1 and 500 hours.")
            if int(hours) != SERVICE_HOURS:
                kept["service"] = {"hours": int(hours)}
        with self.engine.begin() as connection:
            connection.execute(text("DELETE FROM hour_reduction_rules"))
            for kind, changed in kept.items():
                connection.execute(
                    text("""INSERT INTO hour_reduction_rules (kind, figures, updated_at, updated_by)
                            VALUES (:kind, :figures, :at, :by)"""),
                    {"kind": kind, "figures": json.dumps(changed), "at": _now(), "by": actor},
                )
        return self.rules()

    # ------------------------------------------------------------- reading

    def is_full_time(self, connection: Any, teacher_id: str) -> bool:
        row = (
            connection.execute(
                text("""SELECT a.staff_status, p.type FROM active_teachers a
                        LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id WHERE a.id = :id"""),
                {"id": teacher_id},
            )
            .mappings()
            .first()
        )
        return bool(row) and full_time(row["staff_status"])

    def _held(self, connection: Any, year: str, teacher_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
        clause = "" if teacher_ids is None else " AND teacher_id = ANY(:ids)"
        params: dict[str, Any] = {"year": year}
        if teacher_ids is not None:
            params["ids"] = teacher_ids
        held: dict[str, dict[str, Any]] = {}
        for row in connection.execute(
            text(f"SELECT * FROM hour_reductions WHERE academic_year = :year{clause}"),  # noqa: S608
            params,
        ).mappings():
            held.setdefault(row["teacher_id"], {})[row["kind"]] = row
        return held

    def _irg_before(self, connection: Any, year: str, teacher_id: str) -> float:
        """IRG hours already given in the two years before: the project's three years share 80."""
        return float(
            connection.execute(
                text("""SELECT coalesce(sum(amount), 0) FROM hour_reductions
                        WHERE kind = 'irg' AND teacher_id = :id AND academic_year IN (:one, :two)"""),
                {"id": teacher_id, "one": _year_before(year, 1), "two": _year_before(year, 2)},
            ).scalar()
            or 0
        )

    def _sheet(  # noqa: PLR0913 - the year, the teacher, and what was read once for every teacher
        self,
        connection: Any,
        year: str,
        teacher_id: str,
        rules: list[dict[str, Any]],
        service: int,
        held: dict[str, Any],
    ) -> dict[str, Any]:
        """One teacher's year: every kind, what they have, and what is left to teach."""
        irg = next(rule for rule in rules if rule["kind"] == "irg")
        # How much IRG this year may still take, the project's three years sharing their total.
        irg_left = max(0.0, min(irg["cap"], irg["threeYears"] - self._irg_before(connection, year, teacher_id)))
        items = []
        for rule in rules:
            row = held.get(rule["kind"])
            amount = float(row["amount"]) if row else 0.0
            detail = row["detail"] if row else ""
            items.append(
                {
                    **_shown_rule(rule),
                    "amount": amount,
                    "detail": detail,
                    "hours": _hours(rule, amount, detail),
                    "state": row["state"] if row else "",
                    "updatedAt": row["updated_at"] if row else "",
                    "updatedBy": row["updated_by"] if row else "",
                    "validatedAt": row["validated_at"] if row else "",
                    **({"available": irg_left} if rule["kind"] == "irg" else {}),
                }
            )
        total = sum(item["hours"] for item in items)
        declared = (
            connection.execute(
                text("""SELECT declared_at, declared_by, note FROM hour_reduction_years
                        WHERE academic_year = :year AND teacher_id = :id"""),
                {"year": year, "id": teacher_id},
            )
            .mappings()
            .first()
        )
        return {
            "year": year,
            "service": service,
            "items": items,
            "total": total,
            # Never below nothing: a reduction past the service is a year with no teaching, not a debt.
            "owed": max(0.0, service - total),
            "declaredAt": declared["declared_at"] if declared else "",
            "declaredBy": declared["declared_by"] if declared else "",
            "note": declared["note"] if declared else "",
        }

    def for_teacher(self, year: str, teacher_id: str) -> dict[str, Any]:
        year = _checked_year(year)
        with self.engine.connect() as connection:
            rules, service = self._rules(connection)
            held = self._held(connection, year, [teacher_id]).get(teacher_id, {})
            return self._sheet(connection, year, teacher_id, rules, service, held)

    def year(self, year: str) -> dict[str, Any]:
        """Every full-timer teaching in the year, and anybody else with a reduction in it."""
        year = _checked_year(year)
        with self.engine.connect() as connection:
            rules, service = self._rules(connection)
            people = (
                connection.execute(
                    text("""SELECT a.id, a.staff_status, p.type,
                               coalesce(nullif(p.full_name, ''), nullif(a.full_name, ''), a.email, a.id) AS name
                            FROM active_teachers a LEFT JOIN portal_teachers p ON p.teacher_id = a.portal_teacher_id
                            WHERE EXISTS (SELECT 1 FROM active_teacher_terms t
                                          WHERE t.active_id = a.id AND t.term_code LIKE :prefix)
                               OR EXISTS (SELECT 1 FROM hour_reductions r
                                          WHERE r.teacher_id = a.id AND r.academic_year = :year)
                            ORDER BY 4"""),
                    {"prefix": f"{_terms_prefix(year)}%", "year": year},
                )
                .mappings()
                .all()
            )
            held = self._held(connection, year)
            head = connection.execute(
                text("SELECT active_teacher_id FROM department_roles WHERE role = 'head_of_department'")
            ).scalar()
            teachers = [
                {
                    "teacherId": person["id"],
                    "name": person["name"],
                    "fullTime": full_time(person["staff_status"]),
                    "head": person["id"] == head,
                    **self._sheet(connection, year, person["id"], rules, service, held.get(person["id"], {})),
                }
                for person in people
                if full_time(person["staff_status"]) or person["id"] in held
            ]
        return {"year": year, "service": service, "rules": [_shown_rule(rule) for rule in rules], "teachers": teachers}

    # ------------------------------------------------------------- writing

    def declare(
        self, year: str, teacher_id: str, given: dict[str, Any], actor: str = "", note: str | None = None
    ) -> dict[str, Any]:
        """A full-timer's own word on their research reductions. The department's are not theirs
        to set; a change to a validated one sends it back to be checked."""
        year = _checked_year(year)
        with self.engine.begin() as connection:
            if not self.is_full_time(connection, teacher_id):
                raise NotFullTime(teacher_id)
            rules, _service = self._rules(connection)
            by_kind = {rule["kind"]: rule for rule in rules}
            for kind in given:
                if kind not in by_kind:
                    raise InvalidReductions(f"{kind!r} is not a kind of hour reduction.")
                if by_kind[kind]["group"] != SAFIR:
                    raise InvalidReductions(f"{by_kind[kind]['label']} is set by the Head of Department.")
            held = self._held(connection, year, [teacher_id]).get(teacher_id, {})
            for kind, value in given.items():
                self._write(connection, year, teacher_id, by_kind[kind], value, held.get(kind), actor, validated=None)
            connection.execute(
                text("""INSERT INTO hour_reduction_years (academic_year, teacher_id, declared_at, declared_by, note)
                        VALUES (:year, :id, :at, :by, :note)
                        ON CONFLICT (academic_year, teacher_id) DO UPDATE SET declared_at = excluded.declared_at,
                            declared_by = excluded.declared_by,
                            note = CASE WHEN :keep THEN hour_reduction_years.note ELSE excluded.note END"""),
                {
                    "year": year,
                    "id": teacher_id,
                    "at": _now(),
                    "by": actor,
                    "note": " ".join(str(note or "").split())[:NOTE_LENGTH],
                    "keep": note is None,
                },
            )
        return self.for_teacher(year, teacher_id)

    def set_by_department(self, year: str, teacher_id: str, given: dict[str, Any], actor: str = "") -> dict[str, Any]:
        """The Head of Department's word on any kind: the department's own, set; research ones
        corrected, and validated or not."""
        year = _checked_year(year)
        with self.engine.begin() as connection:
            known = connection.execute(text("SELECT 1 FROM active_teachers WHERE id = :id"), {"id": teacher_id}).first()
            if known is None:
                raise InvalidReductions("Not a teacher on Active teachers.")
            rules, _service = self._rules(connection)
            by_kind = {rule["kind"]: rule for rule in rules}
            unknown = [kind for kind in given if kind not in by_kind]
            if unknown:
                raise InvalidReductions(f"{unknown[0]!r} is not a kind of hour reduction.")
            held = self._held(connection, year, [teacher_id]).get(teacher_id, {})
            for kind, value in given.items():
                rule = by_kind[kind]
                validated = bool(value.get("validated")) if isinstance(value, dict) and rule["group"] == SAFIR else None
                self._write(connection, year, teacher_id, rule, value, held.get(kind), actor, validated=validated)
        return self.for_teacher(year, teacher_id)

    def _write(  # noqa: PLR0913 - one kind, as the caller has it
        self,
        connection: Any,
        year: str,
        teacher_id: str,
        rule: dict[str, Any],
        value: Any,
        previous: Any,
        actor: str,
        *,
        validated: bool | None,
    ) -> None:
        """One kind for one teacher: kept, changed, or gone when it comes to nothing."""
        amount, detail = self._checked_value(connection, year, teacher_id, rule, value)
        if amount == 0 and not detail:
            connection.execute(
                text("""DELETE FROM hour_reductions
                        WHERE academic_year = :year AND teacher_id = :id AND kind = :kind"""),
                {"year": year, "id": teacher_id, "kind": rule["kind"]},
            )
            return
        unchanged = previous is not None and float(previous["amount"]) == amount and previous["detail"] == detail
        if rule["group"] == DEPARTMENT:
            state = SET
        elif validated is None:
            # The teacher's word: what was validated stays so only while it is what was validated.
            state = previous["state"] if unchanged and previous["state"] else DECLARED
        else:
            state = VALIDATED if validated else DECLARED
        was_validated = previous is not None and previous["state"] == VALIDATED
        validated_at = (previous["validated_at"] if was_validated else _now()) if state == VALIDATED else ""
        validated_by = (previous["validated_by"] if was_validated else actor) if state == VALIDATED else ""
        if unchanged and previous["state"] == state:
            return
        connection.execute(
            text("""INSERT INTO hour_reductions (academic_year, teacher_id, kind, amount, detail, state, updated_at,
                        updated_by, validated_at, validated_by)
                    VALUES (:year, :id, :kind, :amount, :detail, :state, :at, :by, :vat, :vby)
                    ON CONFLICT (academic_year, teacher_id, kind) DO UPDATE SET amount = excluded.amount,
                        detail = excluded.detail, state = excluded.state, updated_at = excluded.updated_at,
                        updated_by = excluded.updated_by, validated_at = excluded.validated_at,
                        validated_by = excluded.validated_by"""),
            {
                "year": year,
                "id": teacher_id,
                "kind": rule["kind"],
                "amount": amount,
                "detail": detail,
                "state": state,
                "at": _now(),
                "by": actor,
                "vat": validated_at,
                "vby": validated_by,
            },
        )

    def _checked_value(  # noqa: PLR0912 - one branch per unit
        self, connection: Any, year: str, teacher_id: str, rule: dict[str, Any], value: Any
    ) -> tuple[float, str]:
        """What a kind is given, checked against its rule: `(amount, detail)`."""
        given = value if isinstance(value, dict) else {"amount": value}
        unit, label = rule["unit"], rule["label"]
        if unit == "students":
            amount = _number(given.get("amount"))
            if amount != int(amount) or not 0 <= amount <= MOST_STUDENTS:
                raise InvalidReductions(f"{label}: give a whole number of students.")
            return amount, ""
        if unit == "hours":
            amount = _number(given.get("amount"))
            cap = rule.get("cap")
            if amount < 0 or (cap is not None and amount > cap) or amount > SERVICE_HOURS * 2:
                most = f"at most {_fmt(cap)} h" if cap is not None else "too many hours"
                raise InvalidReductions(f"{label}: {most}.")
            if rule["kind"] == "irg":
                left = rule["threeYears"] - self._irg_before(connection, year, teacher_id)
                if amount > left:
                    raise InvalidReductions(
                        f"{label}: {_fmt(max(0.0, left))} h are left of the project's {_fmt(rule['threeYears'])} h."
                    )
            return amount, ""
        if unit == "yes":
            return (1.0 if given.get("amount") else 0.0), ""
        if unit == "committees":
            chosen = given.get("detail") or []
            names = chosen.split(",") if isinstance(chosen, str) else list(chosen)
            known = [key for key, _ in COMMITTEES]
            picked = {str(name).strip() for name in names if str(name).strip()}
            if any(name not in known for name in picked):
                raise InvalidReductions(f"{label}: a committee is budget, ethics or compliance.")
            # In the committees' own order, so the same choice is always written the same way.
            ordered = [key for key in known if key in picked]
            return float(len(ordered)), ",".join(ordered)
        # A choice from a list: the option, or nothing.
        option = str(given.get("detail") or "").strip()
        if option and option not in {entry["key"] for entry in rule["options"]}:
            raise InvalidReductions(f"{label}: choose one of the options.")
        return (1.0 if option else 0.0), option


def _changed_figures(base: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    """The figures an administrator gave for one kind that differ from the department's rules."""
    changed: dict[str, Any] = {}
    for name in ADJUSTABLE.get(base["unit"], ()):
        if name in values and values[name] is not None:
            value = _number(values[name])
            if not 0 <= value <= SERVICE_HOURS * 2:
                raise InvalidReductions(f"{base['label']}: {name} is out of range.")
            if base.get(name) != value:
                changed[name] = value
    if base["unit"] == "choice" and isinstance(values.get("options"), dict):
        known = {option["key"]: option["hours"] for option in base["options"]}
        options = {
            key: _number(hours)
            for key, hours in values["options"].items()
            if key in known and _number(hours) != known[key]
        }
        if options:
            changed["options"] = options
    return changed


MOST_OPTIONS = 20
OPTION_LABEL_LENGTH = 80


def _option_key(label: str, taken: set[str]) -> str:
    """A new option's key, from its name: "Data science programme" → "data-science-programme"."""
    stem = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:40] or "option"
    key, count = stem, 1
    while key in taken:
        count += 1
        key = f"{stem}-{count}"
    return key


def _checked_options(base: dict[str, Any], held: list[dict[str, Any]], given: list[Any]) -> list[dict[str, Any]]:
    """An administrator's list of options for a choice: each named, with its hours.

    An option that keeps its key keeps every teacher who has it, whatever it is renamed to;
    one without a key is new, and is given one from its name.
    """
    label = base["label"]
    if len(given) > MOST_OPTIONS:
        raise InvalidReductions(f"{label}: at most {MOST_OPTIONS} options.")
    known = {option["key"] for option in held} | {option["key"] for option in base["options"]}
    keys_given = {str(entry.get("key") or "") for entry in given if isinstance(entry, dict)}
    taken = {key for key in keys_given if key in known}
    names: set[str] = set()
    options = []
    for entry in given:
        if not isinstance(entry, dict):
            raise InvalidReductions(f"{label}: give each option a name and its hours.")
        name = " ".join(str(entry.get("label") or "").split())
        if not name:
            raise InvalidReductions(f"{label}: every option needs a name.")
        if len(name) > OPTION_LABEL_LENGTH:
            raise InvalidReductions(f"{label}: an option's name is at most {OPTION_LABEL_LENGTH} characters.")
        if name.casefold() in names:
            raise InvalidReductions(f"{label}: {name} is there twice.")
        names.add(name.casefold())
        hours = _number(entry.get("hours"))
        if not 0 <= hours <= SERVICE_HOURS:
            raise InvalidReductions(f"{label}: {name} gives between 0 and {SERVICE_HOURS} h.")
        key = str(entry.get("key") or "")
        if key not in known:
            key = _option_key(name, taken | known)
            taken.add(key)
        options.append({"key": key, "label": name, "hours": hours})
    return options


def _with_options(
    connection: Any, base: dict[str, Any], held: list[dict[str, Any]], values: dict[str, Any], changed: dict[str, Any]
) -> dict[str, Any]:
    """A choice's figures with its options as they are to be kept: a list given replaces them,
    hours alone (the first form) change only the hours, and nothing said keeps them."""
    if isinstance(values.get("options"), list):
        options = _checked_options(base, held, values["options"])
        _refuse_taking_away_in_use(connection, base, held, options)
        changed = {name: value for name, value in changed.items() if name != "options"}
    elif "options" in values:
        return changed
    else:
        options = held
    if options != base["options"]:
        changed = {**changed, "options": options}
    return changed


def _refuse_taking_away_in_use(
    connection: Any, base: dict[str, Any], held: list[dict[str, Any]], options: list[dict[str, Any]]
) -> None:
    """An option a teacher has, in any year, stays until nobody has it: it would vanish from their hours."""
    staying = {option["key"] for option in options}
    for option in held:
        if option["key"] in staying:
            continue
        count = connection.execute(
            text("SELECT count(*) FROM hour_reductions WHERE kind = :kind AND detail = :key"),
            {"kind": base["kind"], "key": option["key"]},
        ).scalar_one()
        if count:
            who = "1 teacher has" if count == 1 else f"{count} teachers have"
            raise InvalidReductions(
                f"{base['label']}: {who} {option['label']}. Give them another option before taking it away."
            )


def _hours(rule: dict[str, Any], amount: float, detail: str) -> float:
    unit = rule["unit"]
    if unit == "students":
        return min(rule["cap"], amount * rule["per"])
    if unit == "hours":
        return min(rule["cap"], amount) if rule.get("cap") is not None else amount
    if unit == "yes":
        return rule["per"] if amount else 0.0
    if unit == "committees":
        return rule["per"] * len([name for name in detail.split(",") if name])
    return next((float(option["hours"]) for option in rule["options"] if option["key"] == detail), 0.0)


def _shown_rule(rule: dict[str, Any]) -> dict[str, Any]:
    """What a page needs of a rule: the words, and the figures its fields check against."""
    shown = {
        "kind": rule["kind"],
        "group": rule["group"],
        "label": rule["label"],
        "unit": rule["unit"],
        "rule": rule.get("rule") or _rule_words(rule),
        "per": rule.get("per"),
        "cap": rule.get("cap"),
    }
    if rule.get("threeYears") is not None:
        shown["threeYears"] = rule["threeYears"]
    if rule["unit"] == "choice":
        shown["options"] = rule["options"]
    if rule["unit"] == "committees":
        shown["options"] = [{"key": key, "label": label, "hours": rule["per"]} for key, label in COMMITTEES]
    return shown
