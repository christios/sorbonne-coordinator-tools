# Plan: shared syllabus and requisition builder components

## Objective

Make the requisition builder use the same UI components and interaction foundations as the syllabus builder wherever their responsibilities match, without coupling the two domain models.

## Shared boundaries

- `SectionEditorShell`: header, back action, numbered section navigation, focused canvas, and action area. It now powers both editors.
- `CollapsibleEntryCard`: compact repeated-item header, expand/collapse affordance, optional actions, and card body. It now powers syllabus schedule sessions and requisition teaching-load entries.
- Existing `SelectMenu` and `AutoResizeTextarea` remain the shared field controls.

## Tasks

1. Extract and test the shared section shell from the syllabus editor.
   - Acceptance: both editors render the same navigation/canvas semantics.
   - Verify: component test, syllabus tests, requisition tests.
2. Extract and test the shared compact entry-card skeleton.
   - Acceptance: schedule and requisition courses share the same collapsible card surface.
   - Verify: schedule and requisition-card tests.
3. Migrate both editors and run the full frontend suite and browser check.
   - Acceptance: no behaviour, section labels, accessibility labels, or DOCX data mapping regresses.

## Boundaries

- Keep syllabus history, comparison, template links, and autosave as syllabus-specific action/content props.
- Keep requisition course fields and export readiness as requisition-specific content props.
- Do not change backend data or DOCX export in this UI refactor.
