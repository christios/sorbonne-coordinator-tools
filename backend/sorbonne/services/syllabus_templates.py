"""The approved syllabus templates that can be used by the builder.

Templates are application-owned definitions. This keeps their field structure and
their DOCX source together, rather than allowing an arbitrary file to be attached
to a syllabus record.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


class TemplateNotFound(Exception):
    """Raised when a request refers to an unregistered syllabus template."""


@dataclass(frozen=True)
class TemplateSection:
    id: str
    label: str
    # The parts of the stored content one screen section edits, in the order the
    # approved document prints them. Usually just the section itself; a merged
    # section lists each part, so stored content and field history keep their keys.
    parts: tuple[str, ...] = ()

    @property
    def content_parts(self) -> tuple[str, ...]:
        return self.parts or (self.id,)


@dataclass(frozen=True)
class SyllabusTemplate:
    id: str
    name: str
    description: str
    document_path: Path
    sections: tuple[TemplateSection, ...]
    # Headings of the bundled document that the department no longer uses. The export
    # takes them (and the table under each) out of every generated copy, so the
    # Provost's file itself is never edited.
    removed_headings: tuple[str, ...] = ()
    # Whether a new syllabus may be started on it. A template no longer offered keeps
    # opening, previewing and exporting the syllabi already written on it.
    offered: bool = True


DEFAULT_TEMPLATE_ID = "scen-en-v1"
FYS_TEMPLATE_ID = "fys-2025-26"
# The catalogue programme a Foundation Year course is mapped under; it has no PLOs.
FYS_PROGRAMME_TITLE = "Foundation Year in Sciences"
_ASSET_DIRECTORY = Path(__file__).resolve().parents[1] / "assets"

_TEMPLATES = {
    DEFAULT_TEMPLATE_ID: SyllabusTemplate(
        id=DEFAULT_TEMPLATE_ID,
        name="SCEN syllabus template (English)",
        description="Approved English template for SCEN course syllabi.",
        document_path=_ASSET_DIRECTORY / "syllabus_template_en.docx",
        sections=(
            TemplateSection("identification", "1. Course identification"),
            TemplateSection("contacts", "2. Academic contacts"),
            # Description and delivery are one section on screen (November 2026 review);
            # the document keeps them under its own two headings.
            TemplateSection("description", "3. Course description and delivery", ("description", "delivery")),
            TemplateSection("learningOutcomes", "4. Learning outcomes"),
            TemplateSection("schedule", "5. Course schedule"),
            TemplateSection("bibliography", "6. Bibliography"),
            TemplateSection("teachingApproach", "7. Teaching approach"),
            TemplateSection("assessment", "8. Course assessment"),
        ),
        # Removed from the syllabus by the November 2026 review.
        removed_headings=("DOCUMENT CONTROL",),
    ),
    FYS_TEMPLATE_ID: SyllabusTemplate(
        id=FYS_TEMPLATE_ID,
        name="Foundation Year syllabus template (Sciences, 2025-26)",
        description="Approved Foundation Year Sciences syllabus form for 2025-26.",
        document_path=_ASSET_DIRECTORY / "fys_syllabus_template_2025_26.docx",
        # 10 Nov 2026: Foundation Year courses use the bachelor template; there is no
        # separate Foundation Year syllabus any more (ADR-003). Kept for any written on it.
        offered=False,
        sections=(
            TemplateSection("courseDetails", "1. Course details"),
            TemplateSection("facultyDetails", "2. Faculty details"),
            # The Foundation Year form prints delivery before description.
            TemplateSection("description", "3. Course description and delivery", ("delivery", "description")),
            TemplateSection("learningOutcomes", "4. Course learning outcomes"),
            TemplateSection("requiredMaterials", "5. Required materials"),
            TemplateSection("teachingMethodologies", "6. Teaching methodologies"),
            TemplateSection("assessment", "7. Course assessment"),
            TemplateSection("schedule", "8. Teaching schedule"),
        ),
    ),
}

# Cross-template mapping is intentionally empty until a second approved template
# and its review mapping are supplied. Same-template comparisons are implicit.
_COMPARISON_MAPPINGS: dict[tuple[str, str], dict[str, str]] = {
    (DEFAULT_TEMPLATE_ID, FYS_TEMPLATE_ID): {},
    (FYS_TEMPLATE_ID, DEFAULT_TEMPLATE_ID): {},
}


def list_templates() -> list[SyllabusTemplate]:
    return list(_TEMPLATES.values())


def get_template(template_id: str) -> SyllabusTemplate:
    try:
        return _TEMPLATES[template_id]
    except KeyError as exc:
        raise TemplateNotFound from exc


def comparison_mapping(left_template_id: str, right_template_id: str) -> dict[str, str] | None:
    """Return a field mapping for an approved cross-template comparison.

    The identity mapping for a shared template is handled by the caller. Future
    template pairs can add an explicit directional mapping here.
    """
    return _COMPARISON_MAPPINGS.get((left_template_id, right_template_id))
