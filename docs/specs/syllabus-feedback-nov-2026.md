# Spec: Syllabus Builder — November 2026 feedback round

Status: **draft for Christian's review** (10 Nov 2026). Branch `feat/syllabus-feedback-nov-2026`, worktree `~/Documents/sorbonne-syllabus-feedback`, cut from `origin/main` @ 5ef2fe1.

## Objective

The reviewers' latest feedback, as confirmed with Christian on 10 Nov 2026, must be live before teachers write their **Spring 2027** syllabi. It applies to the SCEN bachelor template (`scen-en-v1`) and, wherever that template has the matching part, to the Foundation Year template (`fys-2025-26`). See the applicability table.

The users are teachers, who write syllabi, and the Syllabus Builder administrators. The administrators curate the catalogues and, in HoD mode, own each course's CLOs. The Head of Department is given that role.

**The changes, in short:**
1. **The course schedule becomes the single source of graded activities.**
   - The schedule is one list of cards, each a **Session** or a **Graded activity**.
   - The 9.1 summary is built from those cards and shown read-only.
   - "Deadline" becomes "Assessment date".
2. **AI policy is per graded activity.**
   - Each activity uses one of the Word template's five options.
   - The AI policy tab shows an open section for each option in use. It has no drop-down.
   - The Word document ticks every option in use.
3. **CLOs and PLOs.**
   - The PLO matrix (Curriculum mapping) always belongs to the administrators.
   - One department-wide switch decides who writes the CLOs and their alignment:
     - **Teacher mode:** the teacher, restricted to the matrix's PLOs, with each one used at least once.
     - **HoD mode:** the administrators, in the catalogue, with teachers read-only.
4. **Sections.**
   - On screen, 3 and 4 merge into "Course description and delivery", and the later sections are renumbered. The Word document keeps its official headings.
   - Document control is removed from the screen, the preview and the Word document.
5. **Smaller points:**
   - Programme becomes required.
   - Coordinator becomes a drop-down.
   - The pre-class field is renamed.
   - The rubric preview shows only the types in use.
   - Required fields are audited and enforced at submission.
   - The AI catalogue bugs are fixed.
6. **Existing syllabi are converted** once, all of them, by a rehearsed and reviewed conversion run after a backup, with Christian's go-ahead immediately before it.

**Success means:**
- A teacher can't submit a syllabus with a required field missing, a PLO outside the course's matrix (teacher mode), or a matrix PLO left unused.
- The preview and the Word document show the same content, in the same order, as the screen.
- Every existing syllabus still opens, previews and exports after conversion.

## Applicability per template

| Change | SCEN bachelor | Foundation Year |
|---|---|---|
| Schedule cards (Session / Graded activity) | yes: §6 schedule, §9.1 summary | yes: Teaching schedule (Week, Session, Topic, Assessment description, Date) and the continuous / final / laboratory assessment tables. A graded card adds a **component** (Continuous, Final, Laboratory). |
| "Assessment date" | yes | yes (the table already says Date) |
| AI policy per activity, AI tab sections | yes | **no** (the template has no AI policy) |
| Rubrics: only types in use | yes | no (its criteria tables are fixed text) |
| CLO/PLO switch | yes | **CLOs only**: no PLOs, so no matrix. HoD-mode CLOs live in a "Foundation Year in Sciences" programme entry with no PLOs. Note the template's "4 to 6 CLOs". |
| Merge 3+4 and renumber | 3 Description + 4 Delivery | 3 Delivery + 4 Description (fields keep the Word document's order inside the merged section) |
| Remove Document control | yes | not present |
| Programme required | yes | fixed to "Foundation Year in Sciences" |
| Coordinator drop-down | §2 Academic contacts | Faculty details has no coordinator, so nothing to change |
| Pre-class rename | yes | not present |
| Required-fields audit | yes | yes |

**Found while surveying:** the Foundation Year schedule and assessment editors save free-text fields (`scheduleText`, `*Text`), but its export reads row lists, so those Word tables come out empty today. Moving the Foundation Year onto schedule cards fixes this as a side effect.

## Data model

All changes are **additive**. Legacy shapes stay readable and exportable (AGENTS.md "Production-data compatibility", ADR-001, ADR-002).

### Content version
- Add `content.schemaVersion`. A missing value means v1, i.e. today's shapes. The conversion stamps `2`, and new syllabi are created at `2`.
- v1 readers, previewers and exporters stay in place until no v1 syllabus is left, and one release after that.

### Schedule cards (v2)
`content.schedule[]` rows gain `kind: "session" | "graded"`. A row without `kind` is a session.

- **Session card:**
  - Keeps today's keys: `id, sessionType, week, topic, details, preClass`.
  - `deadline` and the free-text `assessments` are no longer edited. On converted syllabi they are kept and handled as in Open question 3.
- **Graded card:**
  - Keys: `id, kind: "graded", week (required), date (optional ISO), assessmentTypeId, type, name, weight, cloIds: string[], aiPolicyId, aiPolicy (label), aiOtherText`.
  - Plus `component` on the Foundation Year template.
- **Ordering (proposed):** cards sort by week. Within a week, sessions come first in their saved order, then graded cards by date. The teacher doesn't drag cards.
- **Week and date (proposed):**
  - A graded card always has a week, which places it.
  - The **Assessment date** is optional. 9.1 prints the date when given, otherwise "Week N".
  - The per-syllabus `assessment.scheduleBy` toggle is retired. It is still read on v1.

### Course assessment (v2)
- `assessment.items` is **not written** on v2 syllabi. 9.1 is derived from the graded cards.
- These stay: `methodologies`, `lateSubmissionPolicy`, `aiAllowedUses`, `aiOtherUses`, `aiVerificationMechanism` and `aiInstructions`. The details now belong to whichever AI sections are shown.
- `assessment.aiPolicy`, the single course-level policy, is no longer written. On v1 it is still read.

### Field history
- Graded cards keep the ids of the items they came from. History reads for `schedule[<id>].*` fall back to `assessment.items[<id>].*`, the same pattern as the existing parent-path fallback.
- History rows are **never rewritten**.
- New internal id keys (`kind`, `aiPolicyId`, `cloIds` on schedule rows) are added to the comparison's hidden paths (`api/syllabi.py` ~325–336).

### Outcome mode
- A new single-row table, `syllabus_outcome_mode(mode text check in ('teacher','hod'), updated_at, updated_by)`, with its service and router.
  - It follows the `portal_pace` / `department_roles` pattern.
  - The default is `teacher`, which is today's behaviour.
- Read by any signed-in user. Set only by Syllabus Builder administrators (`require_curator`).

### Curriculum mapping
- The `curriculum-mapping` payload gains `clos: [{id, clo, ploIds: string[]}]`, maintained by curators. This is additive, and existing entries without CLOs are unaffected.
- Matching stays as today: entry label = course code, normalised, under the syllabus's programme.

### AI policies catalogue
- Exactly the template's five entries.
  - An additive migration adds **"Other (Specify)"**. This reverses the note in migration 0048, on Christian's decision of 10 Nov.
- Each entry carries:
  - `payload.templateRow` (1–5): the row it ticks in the Word document;
  - `payload.description`: its official wording;
  - for "AI Permitted as a Support Tool", `payload.permittedUses: string[]`, with the template's full wording, e.g. "Language editing (grammar, spelling, style, and readability)".
- **Proposed:** no "New AI policy" button. Curators edit the wording; they don't add rows the Word document can't print.

## Behaviour and acceptance criteria

### A. Course schedule (both templates)
- [ ] "Add session" and "Add graded activity" create cards. They follow the existing card pattern: collapsible, titled, numbered, new cards open, no default blank rows.
- [ ] A graded card asks for:
  - Week, then an optional Assessment date (the `DateField` control);
  - Assessment type, which is required (SCEN: from the catalogue);
  - Name (optional) and Weight (%);
  - CLOs assessed, picked from the defined CLOs;
  - AI policy (SCEN), plus "Describe the AI policy for this activity" when it is Other (Specify);
  - Component (Foundation Year).
- [ ] Session cards show no Deadline or Assessments input. "Pre-class learning activities" is relabelled to the name Christian gives (Open question 2).
- [ ] **Word §6 (SCEN):**
  - A graded card in week N prints in the Assessment column of the **last session row of week N**, with its date in the Date column. Several cards in one week are joined.
  - With no session in week N, the card gets a row of its own: week N, blank session, the activity's name as topic, Assessment and Date filled.
  - The preview matches.
- [ ] **Word teaching schedule (Foundation Year):** the same rule, filling Assessment description and Date.

### B. Course assessment section
- [ ] SCEN tabs:
  - **Graded activities**: a read-only 9.1 table built from the cards, with a link to each card in the schedule.
  - **Grading rubrics**.
  - **AI policy**.
  - Methodologies and late submission policy are editable again: they are exported but currently have no editor.
- [ ] The 9.1 Word table and the preview print, per graded card: the date or "Week N", name or type, weight %, "CLO n" numbers, and the AI policy label ("Other: <text>" for Other).
- [ ] Rubrics: the preview and Word show **only** the rubrics of assessment types used by at least one graded card, once each.
- [ ] Foundation Year: the continuous, final and laboratory tables are filled from the graded cards' component, description, CLOs and weight.

### C. AI policy (SCEN)
- [ ] The tab shows one **open** section per AI option used by at least one graded card, in template order. There is no drop-down. Each section shows:
  - its official wording;
  - which activities use it;
  - its details:
    - Prohibited: verification mechanism;
    - Support Tool: permitted-use checkboxes from the catalogue, plus "Other uses";
    - Other (Specify): each activity's text, read-only, with a link to edit on the card.
- [ ] With no graded cards, the tab says so and points to the schedule.
- [ ] "Additional instructions regarding AI" offers Aude's options (Open question 1) plus free text.
- [ ] Word §9.3: every option in use is ticked ☒, with its details filled. The Other row lists the activities' texts.
- [ ] Catalogue fixes:
  - The edit form shows and saves `payload.description`. It falls back to the legacy `payload.details` and stops writing it.
  - Both places in the syllabus read the catalogue; nothing is hard-coded.
  - The permitted uses come from the catalogue.

### D. CLOs and PLOs
- [ ] **Settings → Department:** an "Who writes course learning outcomes" switch with two choices, Teachers / Head of Department.
  - Only Syllabus Builder administrators can change it. Others see it read-only.
  - It shows who changed it and when.
- [ ] **Teacher mode (SCEN):**
  - The PLO picker on each CLO offers only the **non-retired PLOs in the course's matrix entry**.
  - Uncovered matrix PLOs are listed under the CLOs. This replaces today's "Guidance, never a gate" note, and submission is blocked until each one is aligned at least once.
  - If the course has no matrix entry: all programme PLOs are offered, with a notice that "this course is not in the curriculum mapping yet". This doesn't block submission; it's listed in the completeness panel as a warning.
- [ ] **HoD mode:**
  - Manage catalogues → Curriculum mapping → a course edits its CLOs, each with PLOs restricted to that course's matrix and the same each-PLO-at-least-once rule.
  - In the syllabus, the CLO section is read-only and shows the catalogue CLOs, resolved live as rubrics are, with "Set by the Head of Department in the catalogue".
  - Graded cards pick CLOs from those.
  - A course with no catalogue CLOs shows a notice, and submission is blocked.
- [ ] **Switching modes** never deletes content.
  - The syllabus's own CLOs are kept, hidden in HoD mode and shown again in teacher mode.
  - Graded cards remember their CLO picks per mode (`cloIds` versus `catalogueCloIds`).
  - The switch's confirmation dialog says that teachers' CLO picks don't carry across modes.
- [ ] **Foundation Year:** the same switch applies to its CLOs. There are no PLOs or matrix.

### E. Sections, preview and Word
- [ ] **SCEN screen:** 1 Course identification · 2 Academic contacts · 3 Course description and delivery · 4 Learning outcomes · 5 Course schedule · 6 Bibliography · 7 Teaching approach · 8 Course assessment.
- [ ] **Foundation Year screen:** 1 Course details · 2 Faculty details · 3 Course description and delivery · 4 Course learning outcomes · 5 Required materials · 6 Teaching methodologies · 7 Course assessment · 8 Teaching schedule.
- [ ] Document control:
  - It is gone from the SCEN screen, the table of contents and the preview.
  - At export, the DOCUMENT CONTROL heading and its table are removed from the generated document. The bundled template file is not edited.
  - The stored `documentControl` stays untouched.
- [ ] The preview reads `bibliography.journalArticles`; it currently reads `articles`, which is a bug. It covers every block the export fills, and the parity fixture covers the new and fixed blocks.

### F. Smaller points
- [ ] **Programme** is required and marked, with no "optional" wording. It counts in the completeness panel.
- [ ] **Coordinator** (§2 Academic contacts):
  - It is a `SelectMenu` drop-down of non-retired People-catalogue entries, with those holding the coordinator role first.
  - The free-typed fallback is removed for new entries. Legacy typed values still show and export, and can be replaced by a choice.
- [ ] **Required fields:**
  - Step 1 is a checklist of every SCEN and Foundation Year field, generated from the editors and proposing required or optional, for Christian to tick (Open question 4).
  - Step 2: the ticked fields get the required marker (`FormFieldLabel required`).
  - A completeness panel lists what's missing, with links.
  - **Submit for review** is blocked until it's complete. Export stays possible for drafts, labelled "draft — incomplete".

### G. Conversion of existing syllabi (Christian chose "convert all now")
- [ ] An admin-only `POST /api/v1/syllabi/convert-v2`.
  - It has a `dryRun` flag and returns a per-syllabus report: cards created, items without a week, AI policies inferred, and leftover session texts.
  - It is idempotent: v2 syllabi are skipped.
  - It writes through the store with a revision bump. History rows are not rewritten.
- [ ] **Rules:**
  - Each `assessment.items[i]` becomes a graded card with the same id.
  - The week is the item's own. If an item has only a date, the week is left blank and flagged as needing one (it blocks submission).
  - The AI policy is the item's own, otherwise the course-level `assessment.aiPolicy`.
  - `scheduleBy` is dropped from use but kept in storage.
  - `assessment.items`, the course-level `aiPolicy` and the session `deadline` / `assessments` texts are **kept in storage**, so a code rollback still reads v1.
- [ ] **Release order:**
  1. Ship readers for both versions, with new syllabi created at v2.
  2. Rehearse the conversion on a copy of the production syllabi in the isolated database.
     - The copy mechanism is settled in phase 0. `copy_prod_to_dev.py` copies cohorts and groups, not syllabi; the candidate is the admin backup export.
  3. Check the preview and Word export of a sample from each folder against the pre-conversion export.
  4. Take a fresh backup (`coordinator-tools-backups/backup_prod.py`).
  5. Get Christian's go-ahead **immediately before** the run.
  6. Run it in production.
  7. Run a smoke check.

## Commands

Work in the worktree. Its `./dev.sh` exports isolated `DATABASE_URL` / `TEST_DATABASE_URL` (alembic and conftest ignore `backend/.env`).

```bash
cd ~/Documents/sorbonne-syllabus-feedback
./dev.sh migrate upgrade head        # isolated sorbonne_syllabus DB
./dev.sh test -q                     # backend tests (isolated test DB)
./dev.sh lint .                      # ruff
./dev.sh api                         # API on :8010
./dev.sh web                         # web on :3010 (frontend/.env.local VITE_API_BASE_URL=http://localhost:8010)
cd frontend && npm test && npm run lint && npm run build
```

## Project structure (where the work lands)

- `backend/sorbonne/services/`:
  - `syllabus_store.py`: default content v2, the history fallback, display labels.
  - `syllabus_export.py`: §6 placement, derived §9.1, §9.3 multi-tick, Document control removal, Foundation Year tables.
  - `fys_syllabus.py`: conversion and comparison rows for cards.
  - `syllabus_templates.py`: section lists.
  - `syllabus_catalogue_store.py`: AI payload, mapping CLOs, resolving catalogue CLOs.
  - New `syllabus_outcome_mode.py`.
- `backend/sorbonne/api/`: `syllabi.py` (convert route, hidden comparison paths), `syllabus_catalogues.py`, new `syllabus_outcome_mode.py`, registered in `main.py`.
- `backend/alembic/versions/`: the `syllabus_outcome_mode` table, and the "Other (Specify)" AI policy plus `templateRow` / `permittedUses` payloads. These are catalogue-only; no syllabus rows are touched.
- `frontend/src/components/`:
  - `ScheduleEditor.tsx`: cards and the graded card;
  - `StructuredEntryEditors.tsx`: read-only 9.1, AI sections, removal of unused `AssessmentEditor` / `PloEditor` / `AiPolicyEditor`;
  - `AssessmentTabs.tsx`, `SyllabusEditor.tsx` (sections, mode, completeness), `PloAlignmentField.tsx`, `AcademicContactsEditor.tsx`, `CourseIdentificationEditor.tsx`;
  - `SyllabusCatalogues.tsx`: the AI form fix, mapping CLOs;
  - `SyllabusExportPreview.tsx`, `StaffSettings.tsx`.
- `frontend/src/services/`: `syllabusProjection.ts`, `syllabusContent.ts` (v1/v2 readers), `syllabusCatalogues.ts`, new `syllabusOutcomeMode.ts`.
- `fixtures/syllabus-export-parity.json`: new v2 cases.
- `docs/decisions/`: new **ADR-003** "Schedule is the source of graded activities; content schemaVersion; outcome mode". It records the departures from ADR-002: HoD-mode CLOs resolve live from the catalogue, and the one approved syllabus-content conversion.
- `AGENTS.md`: a dated note when this ships.

## Code style

- Follow `AGENTS.md` and `docs/handoffs/ui-ux-decisions.md`, especially "Do not regress".
  - Use the shared controls (`SelectMenu`, `DateField`, `CollapsibleEntryCard`, `ConfirmDialog`, the history-aware fields).
  - No native `<select>`, no `window.confirm`, no internal keys shown to teachers.
  - All calls go through `apiFetch`.
- History controls stay inside the shared field layout.
- Comments explain *why*, in the repo's existing voice.
- Commit messages are plain-English sentences describing the effect. Each one ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Python: ruff clean, typed signatures as in neighbouring code.

## Testing strategy

- **Bug fixes** (the AI catalogue form, the preview bibliography key): write a failing test first.
- **Backend:**
  - Export tests per card placement case: same week, empty week, several per week, date versus week.
  - §9.3 multi-tick and Other.
  - Document control removal.
  - Foundation Year tables.
  - Store tests for v2 defaults and the history fallback.
  - Conversion tests: dry run, idempotence, item without a week, AI inference, untouched legacy keys.
  - Outcome-mode access: curator only.
- **Frontend:** component tests for:
  - the card editor (add session, add graded, ordering);
  - read-only 9.1;
  - AI sections;
  - PLO restriction and coverage;
  - the HoD-mode read-only CLOs;
  - the completeness panel;
  - the Coordinator drop-down.
- **Parity:** extend `fixtures/syllabus-export-parity.json` with v2 cases, so the preview and Word can't drift.
- **Live check in the local browser** for every UI phase, per AGENTS.md working agreement 3.
- **Conversion rehearsal** on a production copy. Compare v1 versus v2 exports for a sample.

## Boundaries

- **Always:**
  - Keep v1 syllabi readable and exportable.
  - Make additive migrations only.
  - Use the isolated worktree databases.
  - Run the focused tests, lint and build before each commit.
  - Commit on `feat/syllabus-feedback-nov-2026`.
- **Ask first:**
  - Every deploy or push to `main` (Christian decides each time).
  - The production conversion run, immediately before it.
  - Any change to the bundled Word templates.
  - Any change in who may edit catalogues or syllabi.
  - Dropping a legacy key's reader.
- **Never:**
  - Rewrite field-history rows.
  - Delete `assessment.items` or other legacy content.
  - Run the conversion without a fresh backup and a rehearsal.
  - Point tests or migrations at `sorbonne` / `sorbonne_test`.
  - Touch the SCEN Student Hub.
  - Show student names.

## Open questions (owed by Christian)

1. **Aude's options** for "Additional instructions regarding AI": their exact wording, and whether several may be chosen.
2. **The new name** for "Pre-class learning activities".
3. **Session free text after conversion.** Converted syllabi may still have free text in a session's old "Assessments" or "Deadline" field. Proposed: show it on that session as "Earlier note" with a Remove button, keep exporting it until removed, and list it in the completeness panel.
4. **The required-fields checklist**, delivered in phase 0 for ticking.
5. **The proposed defaults** to confirm or change:
   - a graded card always has a week, and the date is optional;
   - automatic ordering, with no dragging;
   - the AI catalogue fixed at the template's five;
   - the Coordinator drop-down lists all People-catalogue entries, coordinators first.

## Out of scope

- Importing CLOs or mappings from files.
- A switch per programme or per course.
- Approval states beyond "submitted for review".
- The export-preview access check. It's a separate task: that route lacks the `_readable` check.
