# Sorbonne Coordinator Tools — Project Memory

This is the persistent starting context for every new coding session. Read it first, then load only the task-specific source files and documents listed below. Keep it accurate when a product or architectural decision changes.

## Product today

Sorbonne Coordinator Tools is an internal academic-coordination platform for Sorbonne University Abu Dhabi.

- **Syllabus Builder** (`/#/syllabus`) creates, organises, compares, and exports template-aware SCEN syllabi.
- **Part-time Teacher Database** (`/#/teachers`) stores archiveable teacher profiles, nested folders, labelled teacher requisitions, and a reusable course catalogue. `/#/requisition` is a legacy redirect to this app.
- **Coordinator Handbook** is served at `/handbook/`.
- **Students and Timetables** (`/#/database`; `/#/timetables` is a legacy redirect) is one application covering two families of page (2026-08-24, merged from what were two apps). *Students / Cohorts / Groups & CRNs* are this database's own. *Semesters / Announcements* talk to the SCEN Student Hub (a separate deployment, `~/Documents/scen-student-platform`): nothing about timetables is stored here, `sorbonne/services/student_timetables.py` is the only place that talks to it, and it holds `SCEN_STUDENT_PLATFORM_TOKEN` server-side so the code never reaches a browser. Only those two pages disable themselves when the deployment is not configured — the roster pages must keep working. The term-start import lives *inside* the Semesters page, alongside the mid-term update. **Updating a semester mid-term is a reviewed diff** (2026-08-24): `SemesterUpdate.tsx` uploads a fresh export to the platform's preview route, shows only what differs, and applies just the rows the coordinator ticked — nothing is pre-ticked, and a dropped course is flagged in red because approving it also removes its enrolments. The matching of sessions across two exports is the platform's job (`timetable_diff.py` there), since the export carries no row id; `services/timetableDiff.ts` here only shapes the review and builds the operations to send.
- The roster converter remains implemented but deliberately hidden from the launcher. Do not remove it without explicit approval.

## Authoritative documents

- [UI/UX handoff](docs/handoffs/ui-ux-decisions.md): product interaction and visual decisions. Treat its “Do not regress” section as binding.
- [Template-aware syllabi ADR](docs/decisions/ADR-001-template-aware-syllabi.md): template and comparison boundaries.
- [Part-time Teacher Database spec](docs/specs/part-time-teacher-database.md): teacher-profile and requisition data model.
- `docs/specs/` and `docs/plans/`: consult the specific document that matches the task; do not load every document by default.

## Architecture and source map

- `frontend/`: React, TypeScript, Vite, Tailwind; component tests sit beside components.
- `backend/`: FastAPI, Alembic migrations, PostgreSQL stores, and DOCX export.
- `handbook/`: MkDocs source. `backend/frontend-dist/` and `backend/handbook-dist/` are generated, ignored deployment artifacts.
- Production is FastAPI Cloud; production PostgreSQL is Neon. Never place database URLs, tokens, or other secrets in source or documentation.

Important frontend boundaries:

- `SectionEditorShell` is the shared syllabus/requisition editor layout. In the syllabus desktop editor, the header and left table of contents are fixed while only the right workspace scrolls; mobile uses normal page scrolling.
- Reuse shared controls before creating a new one: `SelectMenu`, `DateField`, `TimeField`, `AutoResizeTextarea`, `HistoryTextField`, `ConfirmDialog`, `CollapsibleEntryCard`, and `FolderMoveMenu`.
- Do not use native `<select>` controls or `window.confirm` in product UI. Do not recreate a shared component locally just to make a new screen quicker.
- The current visual system uses white surfaces, subtle blue-grey borders, restrained rounded corners, dark-blue primary actions, and red only for destructive actions.

## Authentication

- **The application is closed by default.** `sorbonne/services/auth_gate.py` refuses every
  request that is not in `PUBLIC_PATHS` or the static app shell, so a router added later is
  protected the moment it is mounted; `tests/test_auth_gate.py` sweeps the OpenAPI schema and
  fails if any route answers anonymously. Do not widen `PUBLIC_PATHS` without a reason worth
  writing down.
- Sign-in is Google ID token → staff allowlist → signed session cookie
  (`sorbonne/services/staff_auth.py`). The allowlist is re-checked on every request, so
  removing someone ends their session immediately. Requires `GOOGLE_AUTH_CLIENT_ID`,
  `COORDINATOR_ACCESS_EMAILS` and `SESSION_SECRET`; without them the gate answers 503.
- Frontend calls go through `apiFetch` (`src/services/http.ts`) so the session cookie travels
  in development, where the app and the API are on different ports. A new service that calls
  `fetch` directly will work in production and fail locally — use `apiFetch`.
- The gate is added before CORS in `main.py` so CORS stays outermost; otherwise a 401 reaches
  the browser without CORS headers and looks like a network failure.

## History, revisions, and data integrity

- **2026-08-13 — Production-data compatibility:** the deployed Syllabus Builder is actively used. All syllabus-related releases must preserve existing production syllabi, folders, template associations, comparisons, exports, and field history. Prefer additive, backward-compatible schema and API changes; keep legacy content readable and exportable. Do not run destructive data migrations, reinterpret existing fields, or delete/overwrite production records without an explicit approved migration plan, tested backup/restore path, and user confirmation immediately before deployment.
- **2026-08-13 — Shared syllabus catalogues:** catalogue items are independent, revision-protected records and retire rather than delete. Store optional stable catalogue IDs alongside legacy syllabus text; only approved template adapters may expose a catalogue control. People links resolve live for display/export, while catalogue changes never silently replace syllabus-authored academic content.
- **2026-08-17 — Bibliography lookup:** Book and journal-article lookup is user-triggered and backend-mediated through approved public metadata providers. A selected result copies safe, bounded metadata into the editable structured reference; only that ordinary syllabus content (such as a DOI or ISBN) is retained—never a provider connection or live dependency—so legacy references and DOCX exports remain self-contained. Book lookup ranks a bounded wider Open Library result set by entered title/author/year; Google Books is an optional server-side fallback enabled only with `GOOGLE_BOOKS_API_KEY`. Provider searches omit a standalone entered year (then retain it for ranking) and match simple singular/plural title variants, so a remembered-wrong edition year or inflection does not hide an otherwise valid result.
- **2026-08-19 — Approved requisition template:** the requisition DOCX export fills the approved blank SUAD form bundled at `backend/sorbonne/assets/teaching_requisition_template.docx` instead of building a document from scratch, so exports carry the institutional letterhead, section layout, and Word content controls. Fill anchors are the visible row labels, not fixed indices. Do not edit the bundled template to fix an export; replace it only to follow an HR revision, and re-run the export tests when you do.
- A revision number protects against conflicting saves. It is not a readable change log.
- Field history is an optional platform capability, supplied by `FieldHistoryProvider` and the shared history-aware controls. It is currently enabled for syllabus fields only; teacher profiles and teacher requisitions deliberately do not opt in.
- **2026-08-21 — Shared field information and scoped tasks:** field information is a separate optional capability supplied by `FieldInfoProvider` and `FormFieldLabel`, keyed by resource type, record ID, and stable field key. It is available on saved syllabus, teacher-profile, and teacher-requisition fields, but never on unsaved creation forms. Generic scoped tasks use selectable templates; the initial Teacher onboarding template creates CID Clearance, Requisition signature, and ID Issuance (for newcomers) as one bundle. Tasks currently render only on teacher profiles and survive archival. Do not create an app-specific task UI or a global task inbox without an approved scope.
- **2026-08-21 — Teacher task queue:** the approved scope is a teacher-only Tasks view, backed by the generic task API. It defaults to incomplete tasks for active teachers ordered overdue, due within seven days, then undated; task stage and urgency use shared visual primitives, and teacher rows expose completed/total progress. Do not extend it into a cross-platform inbox without an explicit product decision.
- **2026-08-21 — Binary task lifecycle, activity, and quick templates:** tasks are `NOT_STARTED` or `COMPLETED` only. Migration `0020` converted the retired `IN_PROGRESS` rows additively and left completed rows and their timestamps intact; the API accepts `IN_PROGRESS` for one release and folds it into `NOT_STARTED`. Tasks gained an optional description and a dated activity history (`CREATED` / `COMPLETED` / `REOPENED`) with actor attribution deliberately deferred — only completion and reopening are stored, and creation is derived from `created_at` so every creation path reports a full history. Multi-task bundles and single-task quick templates are separate concepts: the fixed Teacher onboarding bundle still runs at teacher creation, while shared quick templates are curated from the task dialog. The library task queue is now a Tasks Overview with summary cards and shared task rows, and `TaskRow`/`TaskFormDialog` are used by both the profile panel and the overview. Do not add assignees, notifications, comments, recurring tasks, named actors, or a platform-wide inbox without an approved scope.
- History controls belong inside the shared field/control layout. Do not manually position an icon beside individual text fields.
- Legacy syllabus history can require a parent-path fallback for migrated structured data; preserve that compatibility in the store.
- The teacher database was created by migration `0007`, which intentionally removed legacy requisition and requisition-folder data. Treat later destructive data migrations with the same explicit care.

## Teacher Database rules

- Teacher identity is an opaque generated ID. Email and phone are optional and email is not unique.
- Teachers can be archived and restored; archiving preserves their requisitions.
- Requisitions belong to a teacher, have a required coordinator-authored label and academic year, and multiple requisitions may share a year.
- Teacher folders are nested and safe to delete only when empty.
- Course-list imports use Excel data with **CRN** as the course identifier. Superseded conflicting entries are retained as obsolete for backward compatibility.
- The requested SharePoint document-tracking workflow (mark fixed required documents received and store a link) is not implemented yet; do not imply that files are stored in this application.
- **2026-08-20 — Google Form document intake:** when configured, the teacher library manually syncs the latest required-email Google Form response into a fresh managed Google Drive folder per exact active teacher match. It copies rather than moves form uploads, retains only the current folder in the profile, and protects folder/ZIP/review access with a deployment allowlist and Google ID-token verification. Sync additionally uses a short-lived Drive/Sheets token that must resolve to that same verified account; never persist it in the browser or database. The service account has inherited root-reader access only for server-generated ZIP downloads. SharePoint remains out of scope.
- **2026-08-20 — Teacher requisition workflow:** requisitions autosave using the shared syllabus save-state pattern; there is no manual Save button. The coordinator edits a requisition label inline from either the editor header or the profile-history card, and the whole history card opens the requisition except for its explicit title/edit and destructive controls. All request-detail and course fields are required and visibly marked; export takes the coordinator to the final incomplete section, while **Review** summarizes the teacher, request details, course count, and decimal teaching hours. The approved DOCX export must preserve the exact decimal total (including comma-decimal input), never truncate it to an integer.
- **2026-08-21 — Course-level class types:** the requisition-level Type of class remains mapped to the approved Word form. Each new teaching-load course must also select a class type. DOCX course rows append that course type to numeric hours (for example `15 TD`), while legacy suffixed-hour courses remain valid and retain their previous export representation.
- **2026-08-20 — Teaching-load selection:** **Add course** creates one expanded course card. The coordinator then chooses an active catalogue course or completes it from scratch; catalogue search is tolerant of formatting differences such as omitted dashes and displays only course title and code. Keep only one course card expanded at a time.
- **2026-08-20 — Shared semantic calendar:** `DateField` is the branded shared calendar picker for syllabus and requisition dates. When opened, it selects the fully visible side of its trigger with an edge margin and keeps that placement fixed until closed; use a six-week grid so navigating months never changes popup height or placement. Do not substitute native browser date controls or reimplement date positioning per screen.
- **2026-08-20 — Shared semantic time:** `TimeField` is the shared branded 24-hour time control. It prioritizes direct keyboard editing, has no time-picker icon, and opens its themed picker only through the explicit keyboard interaction; keep a field-history control in the field’s trailing position when history is enabled.

## Working agreement

1. Read the relevant source, test, and authoritative handoff/spec before changing behaviour.
2. Use existing shared components and extend them where the new behaviour is truly shared.
3. For UI changes, verify in the live local browser as well as with an automated test.
4. For a bug fix, add a failing regression test first; then run the focused test, lint, and build. Run the full affected suite for a release.
5. Preserve unrelated work in this often-dirty workspace. Do not stage, delete, reset, or reformat unrelated files.
6. Add a short dated note to this file only for durable, cross-session decisions—not transient task progress.

## Common commands

```bash
# Backend
cd backend
uv run pytest -q
uv run ruff check .

# Frontend
cd frontend
npm test
npm run lint
npm run build

# Local services
docker compose up -d postgres
cd backend && uv run alembic upgrade head && uv run uvicorn sorbonne.main:app --reload --port 8000
cd frontend && npm run start
```

## Deployment

Build the frontend into `backend/frontend-dist/`, build the handbook into `backend/handbook-dist/`, then deploy from `backend/` with FastAPI Cloud. The exact manual-release commands and production smoke checks are in [README.md](README.md#deploying). Prefer the configured GitHub Actions release when the changes are committed.
