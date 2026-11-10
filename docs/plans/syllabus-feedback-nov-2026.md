# Plan: Syllabus Builder — November 2026 feedback round

The spec is [docs/specs/syllabus-feedback-nov-2026.md](../specs/syllabus-feedback-nov-2026.md), approved 10 Nov 2026. The work is on branch `feat/syllabus-feedback-nov-2026`, worktree `~/Documents/sorbonne-syllabus-feedback`.

## Shape of the work

**Six releases**, each one live on its own and each only on Christian's go-ahead:
- Releases A–C change no stored syllabus shape. They can ship as soon as they're ready.
- Release D introduces the new schedule and reads both shapes.
- The conversion (phase E) runs only after D is live.
- Release F, required fields, waits for Christian's ticked checklist.

```
Phase 0  prep (no code) ─────────────┬──────────────────────────────┐
                                     │                              │
A  quick fixes ── B  AI policy ── D  schedule cards ── E  conversion ── F  required fields
                      (accessor) ┘        ▲                              ▲
C  CLOs and PLOs ─────────────────────────┘ (cards pick CLOs per mode)   │
0.1 required-fields checklist (Christian ticks) ─────────────────────────┘
```

**The key design choice:** a single accessor, `gradedActivities(content)`, returns today's `assessment.items` on v1 syllabi and the graded cards on v2.
- It is introduced in **B1**, before the cards exist.
- The AI tab, the rubrics, 9.1 and the CLO pickers are all built on it, so Release D only has to switch the source.
- Every slice before D is therefore vertical (screen, preview, Word and tests together) and works on today's syllabi.

**Gates:**

| Gate | Blocks only |
|---|---|
| OQ1, Aude's options | B4 |
| OQ2, the pre-class name | A7 |
| OQ3, "Earlier note" (confirmed) | (none) |
| OQ4, the ticked required-fields checklist | F1–F2 |
| Date teachers start Spring 2027 drafting (not yet given) | sets the deadline for D, E and F |

Sizes: **S** is under half a day, **M** about a day, **L** two days or more. Every task ends with a commit on the branch (see the spec's code style) and nothing is pushed.

## Phase 0: preparation (no product code)

- **0.1 Required-fields checklist (S).**
  - Generate a list of every SCEN and Foundation Year field, by section, with a proposed required/optional mark and the reason. Present it to Christian as a page he can tick.
  - Acceptance: every field the editors write appears once, in screen order, with no internal keys.
  - Verify: cross-check against the editors' field paths and the export's fill calls.
- **0.2 A production copy for rehearsal (S).**
  - Find out whether the admin backup export (`coordinator-tools-backups/backup_prod.py`) contains syllabi, and how to restore them into the isolated `sorbonne_syllabus` database.
  - If it can't, design the smallest read-only export of syllabi.
  - Acceptance: a documented, repeatable command puts all production syllabi into the isolated database without touching production.
  - Verify: the counts match the production library.
- **0.3 ADR-003 draft (S).**
  - Cover: the schedule as the source of graded activities, `content.schemaVersion`, the outcome mode, HoD-mode CLOs resolved live, and the one approved content conversion.
  - Acceptance: the departures from ADR-002 are named.

## Release A: quick fixes (no data shape change)

- **A1 AI catalogue form shows the wording (S, bug).**
  - Test first: editing "AI Prohibited" shows its stored `payload.description`.
  - The form reads `description` (falling back to `details`) and saves `description`.
  - Verify: `SyllabusCatalogues.test.tsx`, then edit and save in the local browser and reload.
- **A2 Preview bibliography key (S, bug).**
  - Test first: journal articles appear in the preview.
  - Read `bibliography.journalArticles`, and add a parity-fixture case.
  - Verify: `syllabusProjection.test.ts`, `test_syllabus_export.py` parity.
- **A3 Remove Document control (S).**
  - Remove it from the SCEN section list, the TOC, the editor and the preview.
  - The Word export strips the DOCUMENT CONTROL heading and its table; the template file is untouched. Stored `documentControl` is untouched.
  - Verify: an export test asserting the heading is absent, the preview test, and a local export opened in Word or LibreOffice.
- **A4 Merge sections 3 and 4, and renumber (M).**
  - SCEN: 3 "Course description and delivery", then 4–8 as in the spec.
  - Foundation Year: the same merge, keeping the Word document's field order.
  - Section keys stay stable, so history and anchors keep working; only labels and grouping change.
  - The preview headings follow the Word document's own headings.
  - Verify: template test, editor TOC test, preview check for both templates in the local browser.
- **A5 Programme required (S).**
  - Required marker, and the "optional" wording removed.
  - Enforcement comes in F.
  - Verify: `CourseIdentificationEditor.test.tsx`.
- **A6 Coordinator drop-down (S).**
  - A `SelectMenu` of non-retired People entries, coordinators first. No free-typed fallback for new entries; a legacy typed value is shown and still exports.
  - Verify: `AcademicContactsEditor.test.tsx` for a choice, a legacy value and an export.
- **A7 Rename the pre-class field (S). Gated by OQ2.**
  - Change the label on screen, in the preview and in the comparison labels. The Word column header is the template's and stays.
  - Verify: tests that reference the label.
- **A8 Faithful rubrics (M, bug).**
  - Tests first:
    - (a) the Word document has exactly one rubric table per type used, and none when no type is used. Today the template's two tables always remain, so an empty "Assessment type:" table prints.
    - (b) when activities name no catalogue type, old stored rubrics are shown only if their assessment type matches an activity's type.
  - Fix `_fill_rubrics` and `resolve_rubrics`, and keep the preview in parity.
  - Verify: export and parity tests, and a local export.

**Checkpoint A:**
- `./dev.sh test -q`, `./dev.sh lint .`, and `npm test && npm run lint && npm run build` all pass.
- Check both templates in the local browser.
- Christian reviews them locally, then gives (or holds) the go-ahead for Release A.

## Release B: AI policy per graded activity (on today's syllabi)

- **B1 The `gradedActivities` accessor (S).**
  - Add it in frontend `syllabusContent.ts` and in backend export and catalogue helpers. It returns `assessment.items` today.
  - Move the rubric resolution, 9.1 projection and the AI code onto it, with no behaviour change.
  - Verify: the existing tests pass unchanged, plus accessor unit tests.
- **B2 The AI catalogue at the template's five (M).**
  - An additive migration adds "Other (Specify)" and sets `templateRow` on all five, plus `permittedUses` (full template wording) on Support Tool. It touches only rows it recognises by id or label; no syllabus rows.
  - The catalogue screen: no "New AI policy" button, wording editable, permitted uses editable.
  - Verify: migration test (up on a seeded database, idempotent), catalogue component test.
- **B3 Per-activity picker, AI tab sections, and 9.3 (L).**
  - Each activity picks from the catalogue, storing `aiPolicyId` with its label. "Other (Specify)" adds a text field.
  - The course-level drop-down is gone, and the tab shows one open section per option in use, in template order. Each section has its wording, the activities using it, and its details:
    - Prohibited: verification mechanism;
    - Support Tool: permitted uses and "Other uses";
    - Other: each activity's text.
  - An empty state points to the graded activities.
  - Word: 9.1 prints the label or "Other: <text>", and 9.3 ticks every option in use and fills its details. The preview is in parity.
  - Legacy course-level `aiPolicy` stays readable: an activity without a policy shows the course's in grey, and exports it.
  - Verify:
    - component tests for the sections and the empty state;
    - export tests for 9.3 with one option, three options, and Other, and for a legacy course-level-only syllabus;
    - a parity case;
    - a local browser check and an export.
- **B4 "Additional instructions regarding AI" options (S). Gated by OQ1.**
  - Aude's options as choices (single or multiple, per her comment), plus free text. Exported after the 9.3 table.
  - Verify: component and export tests.

**Checkpoint B:**
- Run the full suites.
- Christian checks a real Fall 2026 syllabus copy locally: its AI sections match its activities.
- Go-ahead for Release B.

## Release C: CLOs and PLOs (independent of B)

- **C1 Teacher mode restricted to the matrix (M).**
  - The PLO picker offers only non-retired PLOs in the course's mapping entry. A course with no entry offers all programme PLOs, with a notice.
  - Uncovered matrix PLOs are listed under the CLOs, replacing the "guidance" note. Blocking comes in F.
  - Verify: `PloAlignmentField` and editor tests for restriction, no entry, retired PLOs and the coverage list. Local browser.
- **C2 The outcome-mode switch (M).**
  - Covers the `syllabus_outcome_mode` table and migration (default `teacher`), its service and router (read by all, set only by curators), and `services/syllabusOutcomeMode.ts`.
  - The panel sits under Settings → Department and shows who changed it and when. Changing it asks for confirmation, with the "CLO picks don't carry across" warning.
  - Verify: backend access tests (a curator can set it, a member can't), the panel test, a local check.
- **C3 CLOs in the curriculum-mapping catalogue (M).**
  - A course's mapping entry edits `clos[]`, each with PLOs restricted to that entry's matrix, plus the coverage rule. Curators only.
  - Verify: catalogue store and component tests.
- **C4 HoD mode in the syllabus (L).**
  - In HoD mode the CLO section is read-only. It shows the catalogue CLOs, resolved live for screen, preview and Word, with a "Set by the Head of Department" note, and a notice when there are none.
  - Activities pick CLOs from them (`catalogueCloIds`). The syllabus's own CLOs stay stored and come back in teacher mode.
  - Verify:
    - store and export tests in both modes, and switching back and forth loses nothing;
    - a parity case;
    - local browser in both modes.
- **C5 Foundation Year CLOs under the switch (S).**
  - Add a "Foundation Year in Sciences" programme entry with no PLOs, through the catalogue, not a migration.
  - Same read-only behaviour as C4. Keep the template's 4–6 CLO note.
  - Verify: tests on the Foundation Year template.

**Checkpoint C:**
- Run the full suites.
- Christian picks the mode he wants for Spring 2027. In HoD mode, the administrators enter the CLOs before teachers start.
- Go-ahead for Release C.

## Release D: the schedule holds the graded activities (reads both shapes)

- **D1 v2 content and the readers (M).**
  - `content.schemaVersion`. New syllabi are created at v2, and a duplicate of a v1 syllabus is converted with the same converter as E.
  - `gradedActivities` returns the graded cards on v2.
  - History for `schedule[<id>].*` falls back to `assessment.items[<id>].*`. The new id keys are hidden from comparison.
  - Verify: store tests for v2 defaults, duplicating v1 to v2, the history fallback, and comparison of v1 against v2.
- **D2 Session and graded cards in the SCEN schedule (L).**
  - "Add session" and "Add graded activity".
  - A graded card has: week (required), optional Assessment date, type, name, weight, CLOs (per mode), AI policy, and Other text.
  - Cards sort by week, sessions first, then graded cards by date. There is no dragging.
  - Session cards no longer show Deadline or Assessments, except an "Earlier note" with Remove when old text exists (OQ3).
  - Follow the handoff's card rules: collapsible, titled, numbered, new cards open.
  - Verify: `ScheduleEditor.test.tsx` covering adding each kind, ordering, the earlier note and removal. Local browser.
- **D3 Course assessment tab on v2 (M).**
  - The Graded activities tab becomes a read-only 9.1, with links to each card.
  - Methodologies and late submission policy are editable again.
  - On v1 the tab is unchanged until conversion.
  - Verify: component tests for v1 and v2.
- **D4 Word §6 placement and the preview (M).**
  - A graded card in week N goes into the last session row of week N, with its date in the Date column; several cards are joined. With no session that week, it gets its own row.
  - The earlier notes still print.
  - Verify: export tests (same week, empty week, several per week, a date given, no date) and parity cases.
- **D5 Foundation Year on cards (L).**
  - Graded cards with a component (Continuous / Final / Laboratory).
  - The teaching schedule and the continuous, final and laboratory tables are filled from the cards. This fixes today's empty Foundation Year tables.
  - The Foundation Year text-only editors are retired for v2.
  - Covers the SCEN-to-Foundation Year duplicate (`convert_scen_to_fys`) and the comparison rows.
  - Verify:
    - Foundation Year export tests (the tables are no longer empty);
    - duplicate and compare tests;
    - a local export.
- **D6 Temporary conversion route (M).**
  - `POST /api/v1/syllabi/convert-v2` with `dryRun`, admin only. It is idempotent, writes through the store with a revision bump, and keeps every v1 key.
  - Its report covers: cards created, items without a week, inferred AI policies, and earlier notes.
  - Verify: tests for dry run, idempotence, a dated item without a week, AI inference, untouched legacy keys, and a non-admin refused.

**Checkpoint D:**
- Run the full suites.
- Test the conversion on the production copy from 0.2 (this is rehearsal 1). Compare v1 and v2 exports for a sample from each folder; any difference other than the intended ones must be explained.
- Christian reviews the cards locally.
- Go-ahead for Release D. v1 syllabi keep working unchanged after release.

## Phase E: conversion of the existing syllabi (after D is live)

- **E1 Rehearsal 2 (S).** Take a fresh production copy and run the conversion with `dryRun`, then for real, locally. Review the report with Christian, especially items with no week.
- **E2 Production dry run (S).** I call the live route with `dryRun` using the API token, and share the report.
- **E3 Backup and go-ahead (S).** Run `backup_prod.py`, check the backup holds the syllabi, then get Christian's explicit go-ahead in that turn.
- **E4 Run and smoke check (S).**
  - Run the conversion. Check it twice: the counts must match the dry run, and a re-run must change nothing.
  - Open, preview and export three syllabi from different folders.
- **E5 Remove the route (S).** This goes in the next release, on its own go-ahead, together with `scripts/rehearse_syllabus_conversion.py` and `./dev.sh rehearse`. Add an AGENTS.md dated note.

## Release F: required fields (after OQ4)

- **F1 Required markers and the completeness panel (M).**
  - The ticked fields get `FormFieldLabel required`.
  - A panel lists what's missing, with links, including:
    - an uncovered matrix PLO;
    - no catalogue CLOs in HoD mode;
    - a graded card without a week;
    - earlier notes.
  - Export works for drafts, labelled "draft — incomplete".
  - Verify: tests for the panel per rule.
- **F2 Submission gate (S).**
  - "Submit for review" is disabled with reasons until complete. The server checks too, so the API can't bypass the gate.
  - Verify: backend test for a submit refused when incomplete; component test.

**Checkpoint F:** run the full suites, then get the go-ahead for Release F.

## Task list

- [x] 0.1 Required-fields checklist for Christian — docs/plans/required-fields-checklist.md, tickable page https://claude.ai/artifact/L5Fxpvnvc5BkYwiacCEp3G (83 rows, 54 proposed required); awaiting his ticks
- [x] 0.2 Production syllabi copy for rehearsal — `./dev.sh rehearse <backup folder>` (10 Nov: production had 2 syllabi; both converted, re-run found nothing)
- [x] 0.3 ADR-003 draft — docs/decisions/ADR-003, Proposed until the Release D go-ahead
- [x] A1 AI catalogue form shows the wording
- [x] A2 Preview journal articles
- [x] A3 Remove Document control
- [x] A4 Merge 3+4 and renumber (both templates)
- [x] A5 Programme required
- [x] A6 Coordinator drop-down
- [ ] A7 Pre-class rename (OQ2)
- [x] A8 Faithful rubrics
- [ ] Checkpoint A, then the go-ahead for Release A
- [x] B1 `gradedActivities` accessor
- [x] B2 AI catalogue: the template's five
- [x] B3 Per-activity AI, tab sections, 9.3
- [ ] B4 Aude's options (OQ1)
- [ ] Checkpoint B, then the go-ahead for Release B
- [x] C1 PLOs restricted to the matrix
- [x] C2 Outcome-mode switch
- [x] C3 CLOs in curriculum mapping
- [x] C4 HoD mode in the syllabus
- [x] C5 Foundation Year CLOs under the switch
- [ ] Checkpoint C, then the go-ahead for Release C
- [x] D1 v2 content and readers
- [x] D2 SCEN schedule cards
- [x] D3 Course assessment tab on v2
- [x] D4 Word §6 placement and preview
- [x] D5 Foundation Year on cards
- [x] D6 Temporary conversion route
- [ ] Checkpoint D (rehearsal 1), then the go-ahead for Release D
- [ ] E1–E4 Conversion: rehearsal 2, production dry run, backup and go-ahead, run and smoke check
- [ ] E5 Remove the route (next release)
- [ ] F1 Required markers and completeness panel (OQ4) — panel built ("N to fill in before review"); markers and final rules wait for the ticked list
- [x] F2 Submission gate — server refuses an incomplete syllabus; withdraw, save and export never blocked
- [ ] Checkpoint F, then the go-ahead for Release F

## Risks

| Risk | Mitigation |
|---|---|
| Conversion damages live syllabi | v1 keys are kept, the route is idempotent, two rehearsals on production copies, a dry run on production, a fresh backup, the go-ahead immediately before. A rollback is a code revert, since v1 data is intact. |
| Items with a date but no week can't be placed | Flagged in the dry-run report and by the completeness panel; the teacher sets the week. |
| Switching the outcome mode after teachers start | Confirmation warning; Christian picks the mode at Checkpoint C, before drafting starts. |
| The preview and Word drift apart | Every Word change adds a parity-fixture case. |
| Field history orphaned by the move | Same ids, plus a read fallback; history rows are never rewritten. |
| Release D is large | B1's accessor and the C work land first, so D swaps a source instead of rebuilding features. |
| Other sessions in the repo | An isolated worktree and databases (`./dev.sh`), and commits only on this branch. |
| Deadline | Releases A–C are small and independent. The Spring 2027 drafting date (not yet given) decides whether F ships before or after D/E. |
