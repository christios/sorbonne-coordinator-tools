# Spec: requisition folders

## Objective

Organize teaching-recruitment requisitions with the same persistent nested-folder workflow used by the syllabus library. A coordinator can create folders and subfolders, filter/search requisitions, move a requisition, and safely delete empty folders.

## Tech stack

- FastAPI, SQLAlchemy, PostgreSQL, Alembic
- React, TypeScript, TanStack Query, Tailwind, Vitest

## Commands

- Frontend test: `cd frontend && npm test`
- Frontend quality check: `cd frontend && npm run lint && npm run build`
- Backend folder store test: `cd backend && uv run pytest tests/test_requisition_store.py`

## Project structure

- `backend/sorbonne/services/requisition_store.py`: persistence and folder rules
- `backend/sorbonne/api/requisitions.py`: requisition and folder API boundary
- `backend/alembic/versions/0006_add_requisition_folders.py`: additive schema migration
- `frontend/src/services/requisitions.ts`: typed client contract
- `frontend/src/components/RequisitionBuilder.tsx`: library integration using shared folder UI pieces

## Code style

Use the established resource pattern: a `folderId` nullable summary field, `/folders` collection endpoints, and `PATCH /{id}/folder` for moves. Keep folder UI state local; server state remains in TanStack Query.

## Testing strategy

- Store test: duplicate preservation, move, and non-empty deletion protection.
- Client test: typed folder and move requests.
- Library test: folder filter and move affordance behavior.
- Full frontend suite and production build.

## Boundaries

- Always: preserve existing requisitions as unfiled; validate request inputs; block deletion of folders containing requisitions or children.
- Ask first: shared folders across tools, folder rename, drag-and-drop, bulk moves.
- Never: delete/rewrite existing requisitions or change DOCX output.

## Success criteria

- Requisitions expose `folderId`; folders persist with parent relationships.
- Users can create nested folders, filter/search them, move a requisition, and see its folder path.
- Deleting a non-empty folder returns a clear conflict and empty folders require confirmation.
- Existing records continue to list and export unchanged.

## Open questions

None. Folder rename and cross-tool sharing are intentionally out of scope.
