"""Filling the syllabus People directory from the people who actually teach.

The directory is what a syllabus picks its instructors from, and nobody was ever
going to type a hundred names into it by hand — which is why it sat empty and the
instructor picker had nothing to offer. Students and Timetables already keeps the
list of who is teaching, so this copies that list across, and copies it again
whenever it changes.

It only ever adds people and fills in blanks. A name, address or rank somebody
typed here wins over the registrar's, a retired person stays retired, and the
academic coordinators the directory holds are none of its business.
"""

from __future__ import annotations

from typing import Any
import unicodedata

from sorbonne.services.portal_lists import PortalListStore
from sorbonne.services.syllabus_catalogue_store import SyllabusCatalogueStore


PAGE = 200


def _name_key(name: str) -> str:
    """Cécile and Cecile are one person; the two lists disagree about the accent."""
    stripped = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return " ".join(stripped.lower().split())


def _all_people(catalogue: SyllabusCatalogueStore) -> list[dict[str, Any]]:
    people: list[dict[str, Any]] = []
    while True:
        page = catalogue.list("people", include_retired=True, limit=PAGE, offset=len(people))
        people.extend(page)
        if len(page) < PAGE:
            return people


def _rank(teacher: dict[str, Any]) -> str:
    """The registrar records a rank for some and only a category for the rest."""
    return str(teacher.get("rank") or teacher.get("category") or "").strip()


def import_teachers(catalogue: SyllabusCatalogueStore, portal: PortalListStore) -> dict[str, Any]:
    existing = _all_people(catalogue)
    by_portal_id = {
        str(person["payload"].get("portalTeacherId")): person
        for person in existing
        if str(person["payload"].get("portalTeacherId") or "").strip()
    }
    by_name = {_name_key(person["label"]): person for person in existing if person["label"].strip()}

    added: list[str] = []
    updated: list[str] = []
    unchanged: list[str] = []
    retired: list[str] = []

    for teacher in portal.list_active_teachers():
        name = str(teacher.get("fullName") or "").strip()
        if not name:
            continue
        portal_id = str(teacher.get("portalTeacherId") or "").strip()
        person = by_portal_id.get(portal_id) if portal_id else None
        person = person or by_name.get(_name_key(name))

        if person is None:
            payload = {
                "academicRank": _rank(teacher),
                "email": str(teacher.get("email") or "").strip(),
                "phone": "",
                "affiliations": "",
                "officeHours": "",
                "roles": ["instructor"],
                "portalTeacherId": portal_id,
            }
            catalogue.create("people", label=name, payload=payload, sort_order=0)
            added.append(name)
            continue

        if person["isRetired"]:
            retired.append(person["label"])
            continue

        payload = dict(person["payload"])
        before = dict(payload)
        roles = [role for role in payload.get("roles", []) if isinstance(role, str)]
        if "instructor" not in roles:
            roles = [*roles, "instructor"]
        payload["roles"] = roles
        # Only ever fill a blank: whatever somebody typed here outranks the registrar.
        for key, value in (("email", teacher.get("email")), ("academicRank", _rank(teacher))):
            if not str(payload.get(key) or "").strip() and str(value or "").strip():
                payload[key] = str(value).strip()
        if portal_id and not str(payload.get("portalTeacherId") or "").strip():
            payload["portalTeacherId"] = portal_id

        if payload == before:
            unchanged.append(person["label"])
            continue
        catalogue.update(
            "people",
            person["id"],
            expected_revision=person["revision"],
            label=person["label"],
            payload=payload,
            parent_id=person.get("parentId"),
            sort_order=person.get("sortOrder", 0),
        )
        updated.append(person["label"])

    return {"added": added, "updated": updated, "unchanged": unchanged, "retired": retired}
