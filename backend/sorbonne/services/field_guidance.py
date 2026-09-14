"""Who writes the guidance behind a field's information button.

Guidance is one text per field, read by everybody who fills that form in. So it belongs to
whoever maintains the form — the administrator of the app the field lives in — and not to
whoever happens to be filling it in: a note one professor rewrote would be the note every
other professor then read.

Which is a narrower rule than it was. It used to be *the platform's* administrator, the
person who hands out accounts, who alone could write it. Maintaining the syllabus catalogue
and handing out accounts are different jobs, and the coordinator doing the first should not
have to ask the person doing the second to correct a sentence about ECTS credits.
"""

from __future__ import annotations

from sorbonne.services.account_access import administers


#: Which app each kind of annotated record belongs to.
APP_BY_RESOURCE = {
    "syllabus-field": "syllabus",
    "teacher": "teachers",
    "teacher-requisition": "teachers",
}


def may_write(resource_type: str, access: dict[str, str], *, platform_admin: bool) -> bool:
    """Whether this person may write the guidance on a field of this kind of record.

    A resource type no app claims is nobody's to annotate but the platform administrator's,
    so a new form cannot quietly become writable by whoever it was added for.
    """
    app = APP_BY_RESOURCE.get(resource_type)
    if app is None:
        return platform_admin
    return administers(access, app, platform_admin=platform_admin)
