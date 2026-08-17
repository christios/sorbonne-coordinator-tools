# ADR-002: Bind shared syllabus catalogues only through approved template adapters

## Status

Accepted

## Date

2026-08-13

## Context

SCEN needs consistent reusable choices for people, programme learning outcomes, teaching approaches, assessment types, rubrics, and bibliography. Templates have different approved field structures, so a global catalogue control would risk forcing SCEN assumptions into Foundation Year Sciences (FYS) syllabi.

## Decision

Store catalogue items separately from syllabus JSON with stable IDs, revision numbers, timestamps, and a non-destructive retirement state. Existing syllabus JSON is not rewritten or backfilled.

Template adapters decide which catalogue controls are shown:

- SCEN may use People, programme/PLO sets, teaching presets, assessment types, and bibliography.
- FYS may use People and bibliography only.
- SCEN competencies and rubric presets are centrally maintained reference catalogues in this phase; neither is automatically mapped into syllabus content.

People links are live: a syllabus stores an optional `personId`, while display and DOCX export resolve the current directory details without replacing the syllabus’s manual fallback fields. Other academic content remains authored by the syllabus. A PLO selection retains the existing human-readable alignment text alongside optional stable IDs. Retired records no longer appear for new selections but remain resolvable for linked syllabi and exports.

Teaching presets are previewed and explicitly applied. Applying them never overwrites existing syllabus text without a confirmation. Bibliography items can retain legacy/freeform references or use structured fields.

## Consequences

- New catalogue migrations must be additive and must not modify syllabus, folder, or history records.
- A new template receives a catalogue binding only after its field mapping and export semantics are approved.
- Comparisons and history should render human labels, not catalogue IDs.
- Catalogue records are retired rather than permanently deleted through the product UI.
