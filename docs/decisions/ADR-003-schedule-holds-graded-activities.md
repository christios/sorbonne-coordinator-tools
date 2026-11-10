# ADR-003: The course schedule holds the graded activities; one department switch decides who writes the CLOs

## Status

Proposed (10 Nov 2026). Becomes Accepted when Christian gives the go-ahead for Release D.

## Date

2026-11-10

## Context

The November 2026 feedback round on the Syllabus Builder (spec: `docs/specs/syllabus-feedback-nov-2026.md`) asked for four things that ADR-001 and ADR-002 did not allow on their own:

- A graded activity was typed twice: once in Course assessment (`assessment.items`) and again, as free text, in the schedule's Assessments and Deadline columns. The two drifted apart, and the Word schedule printed whatever the teacher had last typed.
- The AI policy was one choice for the whole course, from a hard-coded list of four, while the approved template's table 9.3 has five options and expects them per activity.
- The Head of Department owns each course's PLO matrix (curriculum mapping), but teachers could align a CLO to any PLO and leave an expected PLO uncovered. The department also wants to be able to have the Head of Department write the CLOs themselves.
- Teachers could submit a syllabus for review with required parts empty.

## Decision

**The schedule is the source of graded activities.**
- A schedule card is either a session or a graded activity (`kind: "graded"`).
- A graded card carries what an `assessment.items` row carried: its type, weight, CLOs, AI policy and "Other" text, plus a required week and an optional date.
- Course assessment 9.1, the rubrics, the AI tab and the Word document read the graded cards through one accessor: `graded_activities(content)` on the server and `gradedActivities` on the screen.
- The Word schedule prints each graded activity in the Assessment and Date columns of the last session of its week, or on its own row when that week has no session.
- Foundation Year cards also name the row of the assessment form they fill: continuous, final or laboratory.

**`content.schemaVersion` marks the shape.**
- 2 means the schedule holds the graded activities. A missing value means 1, today's `assessment.items`.
- Every reader handles both shapes, so a syllabus nobody has converted keeps opening, previewing and exporting as before.
- New syllabi and copies start at 2.

**AI policy per activity, from the template's five options.**
- The AI catalogue is fixed at the template's five options (migration 0088). It is reworded, never extended.
- An older syllabus's course-wide policy is the fallback for its activities (`course_ai_fallback`), until conversion copies that policy onto each card.

**One department-wide outcome mode** (`syllabus_outcome_mode`, migration 0089), set by a Syllabus builder administrator in Settings:
- **Teacher mode**: teachers write the CLOs. A CLO can only be aligned to the PLOs the matrix expects of the course, and each of those PLOs must be aligned at least once.
- **Head of Department mode**: the Head of Department writes each course's CLOs, with their PLOs and competencies, in the curriculum mapping. Every syllabus of the course shows them read-only.
  - They are resolved live at display and export time (`resolve_outcomes`), like People links.
  - The CLOs a teacher wrote stay stored and untouched, for the day the switch goes back.
  - Graded activities pick the Head of Department's CLOs by id (`catalogueCloIds`).

**One approved content conversion.**
- Existing syllabi are converted once, through a temporary administrator-only route (`POST /api/v1/syllabi/convert-v2`, with `dryRun`).
- The conversion is additive. It adds graded cards and `schemaVersion`, and keeps `assessment.items`, ids and the course-wide AI policy.
- Free text in a session's old Assessments and Deadline columns becomes an "Earlier note" for the teacher to move into a card or clear. It is never parsed.
- The route is removed in the release after it runs.

**Required fields are a server rule.**
- `syllabus_completeness.py` lists what a syllabus still lacks, by section.
- The editor shows that list, and the review route refuses an incomplete syllabus.
- Saving, exporting and withdrawing a review request are never blocked.

## Departures from ADR-001 and ADR-002

- **A content conversion.** ADR-002 says "existing syllabus JSON is not rewritten or backfilled". This ADR approves one exception: the schedule conversion above. It runs only after a rehearsal on a copy of production, a dry run, a backup, and Christian's go-ahead immediately before (AGENTS.md, 2026-08-13).
- **Catalogue-owned academic content.** ADR-002 keeps academic content authored by the syllabus. In Head of Department mode the CLOs are catalogue-owned and resolved live, the way People links are. In Teacher mode nothing changes.
- **Screen sections no longer map one-to-one to stored keys.** A screen section can edit several content parts: description and delivery are one section (`TemplateSection.parts`). The Word document keeps the template's own headings, and stored keys and field history are unchanged.
- **A removed template heading.** `SyllabusTemplate.removed_headings` drops Document control from the Word document. The approved template file itself is not edited.

## Consequences

- Every new feature that reads graded activities goes through the accessor, never `assessment.items` or the schedule directly.
- The parity fixtures (`fixtures/syllabus-export-parity*.json`) cover both shapes, and the preview and the Word document must keep agreeing on both.
- A v1 syllabus can still exist after the conversion: it may be restored from history or imported. Readers must keep handling it until a later ADR retires v1.
- The outcome mode is department-wide. Per-programme or per-course switches are out of scope and would need a new decision.
- Changing a required-field rule is a change to `syllabus_completeness.py` and its tests. The editor has no list of its own.
