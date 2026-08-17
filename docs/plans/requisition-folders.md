# Plan: requisition folders

## Architecture decision

Replicate the syllabus folder resource contract under `/requisitions`, while reusing the existing generic `FolderMoveMenu` in the requisition library. Requisition folders use their own tables to avoid cross-tool coupling.

## Tasks

1. Completed — add an additive migration and store/API contract for requisition folders.
   - Acceptance: create/list/delete folders and move a requisition; folder deletion rejects populated folders.
   - Verify: requisition store test.
2. Completed — extend the typed frontend client and React Query mutations.
   - Acceptance: folder and move requests use the requisition resource contract.
   - Verify: service test.
3. Completed — refactor the requisition library to the existing folder-library layout.
   - Acceptance: folders, search, unfiled filter, nested paths, move control, and deletion confirmation match syllabus behavior.
   - Verify: component test, full frontend test/build, local API check.

## Risks

| Risk | Mitigation |
|---|---|
| Migration runs against existing data | `folder_id` is nullable so existing requisitions stay unfiled. |
| UI divergence | Reuse `FolderMoveMenu` and syllabus library interaction patterns. |
