# ADR-001: Keep syllabus templates as approved application definitions

## Status

Accepted

## Date

2026-07-23

## Context

Every syllabus must identify the Word template it is based on. The template controls both the editor sections a professor sees and the DOCX source used for export. Future approved templates may use different field structures, but yearly review needs an explicit, trustworthy relationship between templates before their syllabi can be compared.

## Decision

Store a required `template_id` on each syllabus. Template definitions are application-owned and contain the display name, DOCX source, and ordered editor sections. The initial `scen-en-v1` definition uses the approved English SCEN DOCX template.

New syllabi default to `scen-en-v1`; duplicates inherit their source template. The API exposes the registered templates and serves each approved source DOCX. DOCX export resolves the source document from the stored template ID.

Same-template comparisons continue to work. Different templates are not comparable until an explicit directional mapping of their corresponding fields is registered.

`fys-2025-26` is the approved Foundation Year Sciences template based on the 14 November 2022 form used for the 2025-26 FYS syllabi. Its approved SCEN mapping compares only equivalent academic content: course identity in the comparison header; academic context; compatible contact-hour categories; prerequisites/equipment; instructor name/status, affiliation or institution, office hours, and email; delivery; description; CLO text; supplemental resources; ordered schedule topics; assessment description, weight, and CLOs; and approver/HoD plus approval date. Template-only content is displayed as one-sided review rows rather than given an invented equivalence.

Course weight and ECTS remain distinct measures. SCEN workshops and seminars, coordinator details, PLO alignment, graduate competencies, pre-class work, AI policy, editable rubrics, and document-version metadata are SCEN-only unless a future mapping is approved. FYS phone details, additional staff, required textbooks, teaching-method hours, assessment components/categories, week identifiers, and assessment-date metadata are FYS-only. Fixed policy, grading-reference, and rubric pages supplied by either Word form are template boilerplate, not syllabus-record comparison fields.

## Alternatives considered

### Let professors upload any DOCX template

Rejected: a DOCX alone cannot safely define the editor’s schema, export bindings, or comparison semantics. It would also make output and review inconsistent.

### Keep one global template setting

Rejected: changing that setting would silently change the meaning and export source of existing syllabi.

### Compare unrelated templates by matching field labels

Rejected: labels are ambiguous and can conceal changed academic meaning. Mappings must be reviewed explicitly.

## Consequences

- A future template requires a registered definition, supported field renderer, DOCX exporter mapping, and an Alembic-safe rollout.
- A new-year duplicate may select an approved mapped template. It remains in the same syllabus series and copies only mapped content into the target schema.
- Existing rows are backfilled to `scen-en-v1`.
- Cross-template comparison returns a clear validation error until its mapping is approved and implemented.
