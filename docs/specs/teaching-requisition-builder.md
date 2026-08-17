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
- `backend/sorbonne/services/requisition_export.py` — editable Word output.
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
- DOCX output includes the documented teaching-recruitment fields, employee-type indication, calculated total hours, and course table.
- HR, finance, budget, approval, and signature fields are not generated.

## Open question

The exact blank `.docx` template is not in this repository. The exporter is intentionally isolated so it can be switched to XML-anchor filling once that approved blank file is added.
