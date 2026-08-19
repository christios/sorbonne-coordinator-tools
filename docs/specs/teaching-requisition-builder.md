# Spec: Teaching-requisition builder

## Objective

Add a SCEN Teaching-requisition builder alongside the Syllabus Builder. Coordinators can keep one structured requisition per person, add course or administrative-hour rows, duplicate a prior request, and download an editable DOCX. The generated document fills academic fields only; salary, HR, budget, approval, and signature areas remain blank.

## Contract

`/api/v1/requisitions` is a separate REST resource. It returns requisition summaries, stores a revisioned `content` object, accepts partial metadata updates with an optimistic-concurrency revision, and exposes `GET /{id}/export` for DOCX. The UI owns a simple local form state and autosaves through this contract.

## Sections

- Request details: employee name, academic year, hiring department, programme, job title, class type, employee type, contract dates.
- Teaching load: repeatable subject-code, course-number, level, course-title, and hours rows; the total is calculated from rows.
- Review: identifies missing decision fields and provides DOCX export.

## Commands

- Backend tests: `cd backend && uv run pytest tests -q`
- Backend lint: `cd backend && uv run ruff check .`
- Frontend tests: `cd frontend && npm test`
- Frontend lint/build: `cd frontend && npm run lint && npm run build`

## Project structure

- `backend/sorbonne/api/requisitions.py` — API boundary and input validation.
- `backend/sorbonne/services/requisition_store.py` — PostgreSQL persistence.
- `backend/sorbonne/services/requisition_export.py` — editable Word output filled into the approved template.
- `backend/sorbonne/assets/teaching_requisition_template.docx` — the approved blank SUAD form.
- `frontend/src/components/RequisitionBuilder.tsx` — library and editor.
- `frontend/src/services/requisitions.ts` — typed API client.

## Testing strategy

Backend tests verify persistence, stale-update protection, computed totals, and the DOCX table contents. Frontend tests cover route recognition and the requisition service request shape. The normal backend and frontend suites provide regression coverage.

## Boundaries

- Always: preserve the blank template concept, leave HR/approval fields blank, validate revisions, and keep courses structured.
- Ask first: importing spreadsheets automatically, changing the approved Word template, or exposing new HR fields.
- Never: overwrite a source template, infer programme/course codes, or persist salary/signature data.

## Success criteria

- The launcher presents a Teaching-requisition builder at `/#/requisition`.
- A coordinator can create, reopen, duplicate, edit, delete, and export a requisition.
- DOCX output is the approved SUAD form itself, with its letterhead, section layout, and content controls intact.
- The export fills the documented teaching-recruitment fields, employee-type checkbox, calculated total hours, and course table.
- HR, finance, budget, approval, and signature fields are left blank for the approvers to complete.

## Template filling

The approved blank form ships in `backend/sorbonne/assets/`. The exporter opens it and fills anchors found by their visible labels: table rows are matched on their first-column heading, and each row's Word content controls are set in reading order (dropdowns, dates, and the employee-type checkboxes). The course table is rebuilt from its own first sample row, so cloned rows keep the level dropdown and column widths.

Word rejects a content control whose run properties sit out of schema order, so every control is normalised before the file is saved. Replacing the template file is enough to follow an HR revision as long as the row labels stay the same; changing the template is an "ask first" decision.
