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


@dataclass(frozen=True)
class SyllabusTemplate:
    id: str
    name: str
    description: str
    document_path: Path
    sections: tuple[TemplateSection, ...]


DEFAULT_TEMPLATE_ID = "scen-en-v1"
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
            TemplateSection("description", "3. Course description"),
            TemplateSection("delivery", "4. Course delivery"),
            TemplateSection("learningOutcomes", "5. Learning outcomes"),
            TemplateSection("schedule", "6. Course schedule"),
            TemplateSection("bibliography", "7. Bibliography"),
            TemplateSection("teachingApproach", "8. Teaching approach"),
            TemplateSection("assessment", "9. Course assessment"),
            TemplateSection("documentControl", "10. Document control"),
        ),
    )
}

# Cross-template mapping is intentionally empty until a second approved template
# and its review mapping are supplied. Same-template comparisons are implicit.
_COMPARISON_MAPPINGS: dict[tuple[str, str], dict[str, str]] = {}


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
