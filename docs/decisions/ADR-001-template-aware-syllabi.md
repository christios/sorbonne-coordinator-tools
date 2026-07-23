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

Same-template comparisons continue to work. Different templates are not comparable until an explicit directional mapping of their corresponding fields is registered. The mapping registry is deliberately empty until a second approved template and its comparison rules are supplied.

## Alternatives considered

### Let professors upload any DOCX template

Rejected: a DOCX alone cannot safely define the editor’s schema, export bindings, or comparison semantics. It would also make output and review inconsistent.

### Keep one global template setting

Rejected: changing that setting would silently change the meaning and export source of existing syllabi.

### Compare unrelated templates by matching field labels

Rejected: labels are ambiguous and can conceal changed academic meaning. Mappings must be reviewed explicitly.

## Consequences

- A future template requires a registered definition, supported field renderer, DOCX exporter mapping, and an Alembic-safe rollout.
- Existing rows are backfilled to `scen-en-v1`.
- Cross-template comparison returns a clear validation error until its mapping is approved and implemented.
