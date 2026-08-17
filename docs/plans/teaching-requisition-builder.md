# Implementation plan: Teaching-requisition builder

## Architecture decisions

- Use a separate revisioned PostgreSQL resource: requisitions are person records, not course syllabi.
- Keep course rows in one structured JSON document, with the total derived at display/export time.
- Generate an editable DOCX whose layout matches the documented two-table form; do not generate HR or approval areas.

## Tasks

1. Foundation — migration, persistence store, API contract, and DOCX export.
   - Acceptance: create/update/list/get/delete/export work with revision checks.
   - Verify: backend tests and Ruff.
2. Coordinator flow — typed client, launcher route, requisition library, structured editor, duplicate/delete/export controls.
   - Acceptance: a user can complete the request and teaching-load sections and download a file.
   - Verify: frontend tests, lint, and build.
3. Integration checkpoint.
   - Acceptance: full backend/frontend suites pass and the DOCX can be opened and inspected.
   - Verify: all project verification commands relevant to changed areas.

## Risks

| Risk | Mitigation |
| --- | --- |
| The exact blank template is not versioned here | Isolate export layout so the approved asset can later replace it without changing the stored data or UI. |
| Programme/code values are ambiguous | Keep them user-entered and present an export-readiness checklist rather than inferring values. |
