# UI/UX Handoff: Syllabus Builder and Workspace

## Purpose

This document records the user-facing decisions made while shaping the SCEN Coordinator Tools workspace. Treat it as product intent, not a list of incidental implementation details. Preserve these choices when extending the builder, changing the template, or simplifying components.

## Design principles

1. **Make academic data easy to enter correctly.** Prefer structured, guided inputs over large free-text boxes when the eventual DOCX output needs consistent formatting.
2. **Show only the detail a professor needs now.** Repeated content starts compact; added items open for editing, while existing complete items can remain collapsed.
3. **Use human language everywhere.** Labels, history entries, comparison fields, and card titles must be readable academic terms—not JSON paths such as `description.overview`.
4. **Use one visual language.** Controls use the existing white surface, subtle blue-grey border, moderate rounded corners, dark-blue action colour, and restrained red for destructive actions. Do not reintroduce browser-native-looking selects or sharp-cornered controls.
5. **Keep review trustworthy.** Revision history and year-over-year comparison should communicate exactly what changed without obscuring the original text.
6. **Reuse shared interaction primitives.** New selection controls use `SelectMenu` (with its search option for long lists); semantic dates use `DateField`; destructive actions use the in-app `ConfirmDialog`. Do not introduce native `<select>` controls or `window.confirm` in product UI.

## Workspace launcher

- The root page is an **app launcher**, not a tool toggle. It offers search and application cards.
- The currently visible cards are **Syllabus Builder** and **Coordinator Handbook**.
- **Course roster** remains implemented but is deliberately hidden from the launcher. Do not remove its route or API without explicit product approval.
- The handbook opens at `/handbook/` in production. In Vite development it opens the MkDocs preview URL defined by `VITE_HANDBOOK_URL` (default `http://127.0.0.1:8001/`).

## Syllabus library and folders

### Library

- The library is the syllabus home screen. New syllabi can be blank or duplicated into a new academic year.
- Choosing a template is explicit. The template selector links to its approved Word document; duplication retains the source template.
- Each syllabus row shows its name, then its folder breadcrumb beside the name. Course code, academic year, and revision sit below with their own icons.
- Search applies within the selected folder; the left sidebar separately searches folders.

### Folders

- Folders support nesting. Creating a folder while a folder is selected creates a child folder.
- The left sidebar shows a compact folder tree with indentation, not a separate tree-management page.
- **Unfiled** is only shown when one or more syllabi are unfiled.
- A folder can only be deleted when empty and without child folders. Explain why the delete control is disabled instead of silently failing.
- Moving a syllabus is represented by a **folder icon next to the trash control**, not by a visible select field. It opens an opaque searchable popover with folder rows and a checkmark for the current folder.
- Popovers must not be clipped by their containing row, must close when clicking outside or pressing Escape, and must never allow controls behind them to show through.

## Editor shell and fields

- The syllabus editor uses a numbered section sidebar and one focused section canvas at a time.
- Integrity policy and classroom etiquette were intentionally removed from the editor and navigation.
- Locked institutional policy text stays fixed; only course-specific content is editable.
- Every editable field has a history icon inside the right edge. For multi-line fields, position it at the top-right.
- Inputs reserve right-side space for trailing icons. Select arrows and history controls must never overlap.
- Textareas grow with their content; avoid fixed tall blank textareas.
- Semantic dates use native date inputs so a date picker is available.
- Use the shared custom `SelectMenu` for every select-like control. It exists to maintain the application’s rounded, branded UI and support searchable/multi-select behaviour where needed.

## Field history

- A history icon opens a small **latest saved change** preview beside the field. It shows the most recent change only.
- The preview closes on outside click, focus change, Escape, or its close button.
- “View all edits” opens a fixed right-hand sidebar, similar to Excel’s history panel.
- History entries display a single inline diff, not separate “previous value” and “changed to” fields.
- Diff formatting is shared with comparison: red struck-through deletion, green insertion, and amber substitution shown as `old → new`.
- Rapid sequential edits to the same field are coalesced; this is useful edit history, not a forensic audit log.

## UI hardening: observed issues and their fixes

These are not cosmetic preferences. They were reported while exercising the live editor and should be treated as regression cases.

| Observed issue | Guardrail now in place | Preserve when changing UI |
| --- | --- | --- |
| History and dropdown popovers looked see-through; icons and text from fields below appeared inside the popup. | History previews render through a React portal on `document.body`, with fixed positioning, `z-[100]`, `isolate`, and an opaque white surface. Shared select and folder menus also use opaque white, `isolate`, and an elevated z-index. | Never put opacity on a popup container or rely on a translucent parent. Keep the surface opaque and isolated; use a portal for any overlay that can cross complex stacking contexts. |
| A history or move popover stayed open after the user clicked elsewhere. | History, select, and folder controls listen for outside pointer/mouse/focus events and Escape, then close themselves. | Every newly introduced popover must have outside-click, focus-change, and Escape dismissal. Test a click into the next field. |
| History icons appeared to be in the wrong place, but they were actually controls showing through a transparent preview. | Opaque overlay treatment removes the visual bleed. Inputs reserve trailing space; multi-line controls deliberately place their history icon at top-right. | Diagnose stacking/opacity before moving icons. Do not remove input right padding or the `placement="top"` rule for textareas. |
| Dropdown chevrons overlapped history controls. | `SelectMenu` moves the chevron left when a trailing control exists and increases right padding for the field value. | Any trailing action added to a select must reserve space for both the action and chevron. Do not use a native select to bypass this layout. |
| Dropdowns looked like browser-native controls and had sharp corners that did not match the product. | Custom button/listbox controls use rounded corners, white surfaces, muted borders, branded focus rings, hover states, and selected rows. | Use `SelectMenu` (or match its visual and accessibility contract) for all new selection controls. |
| Folder destination popover was cut off by the syllabus row. | The library uses a compact folder-icon trigger next to delete, a right-aligned elevated menu, bounded scroll area, and no clipping on the row container. | Do not add `overflow-hidden` to a parent of a menu. If a new context can still clip it, render that menu via a portal. |
| Large bibliography and outcome canvases overflowed horizontally. | Repeated-content containers use `min-w-0`, `max-w-full`, shrinkable actions, and vertical card layouts rather than wide tables. | Check card layouts with long titles and narrow widths. Long academic text should wrap or truncate intentionally, never force horizontal canvas overflow. |
| Empty textareas consumed too much space and made the form feel unfinished. | `AutoResizeTextarea` grows to content and structured/repeatable cards start with only the fields the user asked to add. | Avoid fixed large textareas and bulk-created blank rows. Preserve auto-resize for narrative inputs. |
| Data-entry tables were difficult to scan and edit on long forms. | Outcomes, schedule, bibliography, assessments, rubrics, and lists use collapsible cards. The comparison grid remains a review-only exception. | Do not reintroduce tables for editable repeated data without an explicit product decision. |
| Technical field paths appeared in review UI. | Field history and comparison map fields to academic labels; paths remain an implementation detail only. | Add/update the human label mapping whenever a field is added or renamed. |
| The left comparison column was visually noisy. | The older version is plain; all word-level insert/delete/substitute treatment appears only in the newer version. | Do not apply diff marks to the left column. Maintain substitution rendering as one amber operation. |

### Overlay implementation checklist

Before merging any overlay, dropdown, tooltip-like preview, or move menu:

- Verify it is visually opaque over a dense form with history icons.
- Open it near the viewport edge and inside a long scrollable list; it must remain visible and usable.
- Click another field, click blank space, tab away, and press Escape; it must close.
- Confirm the trigger remains keyboard-accessible and has a descriptive accessible name.
- Confirm long option labels do not overlap icons or force an unwanted horizontal scroll.

## Repeated structured content

### General pattern

- Do not use editable tables for complex repeated content. Use compact, collapsible cards with an add button, visible summary, remove icon, and structured fields inside.
- Add only one empty item when the user chooses **Add**. Do not pre-render a large number of blank fields.
- Use icon-only move and delete controls when space is constrained; provide accessible labels and tooltips.
- Move controls open a searchable destination picker rather than requiring a user to know a row number in a long list. Newly added items scroll into view.

### Learning outcomes

- PLOs and CLOs are separate tabs so long lists do not force unnecessary scrolling.
- Cards use simple titles (`PLO 1`, `CLO 1`) and show the outcome text as their collapsed summary. Do not duplicate the full outcome above its editable field.
- The actions are consistently labelled **Add outcome**.
- CLOs use an **Aligned PLOs** multi-select sourced from the current PLO list; one CLO can align with more than one PLO.
- PLO/CLO cards can be collapsed. A newly added blank card opens immediately; completed cards may begin collapsed.
- Do not show internal position labels. Reordering is available via the move icon and destination picker.

### Course schedule

- Each schedule session is a collapsible card. Its card title is the **Topic**, not a duplicate “Session” field.
- A compact section-number pill sits next to the move arrows; do not put the number in the title or as a separate editable field.
- New blank sessions are open, so the professor can immediately enter the topic; existing populated sessions can be collapsed.
- Session details are structured fields, including a native date picker where appropriate.

### Bibliography and lists

- Bibliography is split into **Books**, **Websites**, and **Journal articles** tabs.
- Each resource type uses structured cards: identify the source with the essential fields first, then reveal optional publication details on demand.
- Books and journal articles keep the **reference search panel always visible** in non-legacy cards; do not hide it behind a “Find reference” button. Centre the Structured/Freeform toggle above it. Search is submitted explicitly with a title, author, ISBN, or DOI; selecting a result copies metadata into the card's editable structured fields. Keep this provider lookup backend-mediated and copy-only—never make saved references or DOCX export depend on a live provider.
- Book lookup first uses Open Library, then the optional server-side Google Books fallback. Normal 10- or 13-character ISBN values accept punctuation/spaces and use an ISBN-specific fallback if Open Library has no record. Google Books can temporarily fail, so the focused fallback is retried once; preserve this graceful behaviour rather than surfacing a provider outage as a permanent “no results” state.
- Legacy imported reference text remains editable in a single imported-reference field; do not discard it during migration.
- Affiliations, office hours/location, prerequisites/co-requisites, equipment, and “other permitted AI uses” are lists or structured entries—not a single unbounded narrative field.

### Assessment

- Course assessment uses tabs for **Graded activities**, **Grading criteria**, and **AI policy**.
- Assessment items and rubrics are compact cards rather than tables.
- Assessment dates use date inputs; assessed CLOs are selected from the defined CLOs.
- AI policy presents course-level choices, predefined permitted-use checkboxes, and a repeatable list for other permitted uses.

## Comparison and change rendering

- Comparisons are limited to versions in the same syllabus series and template.
- The comparison view uses human-readable section/field names and starts with **Changes only** enabled.
- The earlier (left) version is plain text with no diff decoration.
- The newer (right) version carries all word-level formatting:
  - deletion: red, struck through;
  - insertion: green;
  - substitution: amber `old → new` within one operation.
- Prefer substitutions when a word or short phrase has been replaced; do not render every replacement as unrelated delete and insert operations.
- The comparison grid is a deliberate exception to the “avoid tables for editing” rule: it is a review surface, not a data-entry interface.

## Do not regress

- Never expose code paths or internal field keys to professors.
- Do not reintroduce the old native dropdown appearance.
- Do not use browser-native confirmation dialogs for destructive actions; use the shared `ConfirmDialog`.
- Do not stack PLO and CLO editors, bibliography categories, or assessment areas into one long page when tabs give a clearer focus.
- Do not let overlays be transparent, clipped, persistent after outside clicks, or visually interfere with underlying history icons.
- Do not add multiple blank rows by default.
- Keep destructive actions obvious and confirmed.

## Where to make changes

| Area | Primary code |
| --- | --- |
| Launcher | `frontend/src/routes/App.tsx` |
| Library and folder UX | `frontend/src/components/SyllabusLibrary.tsx`, `FolderMoveMenu.tsx` |
| Editor sections | `frontend/src/components/SyllabusEditor.tsx` |
| Structured lists, PLOs, bibliography, assessments | `frontend/src/components/StructuredEntryEditors.tsx` |
| Schedule cards and reordering | `frontend/src/components/ScheduleEditor.tsx` |
| Shared custom dropdown | `frontend/src/components/SelectMenu.tsx` |
| History preview/sidebar | `frontend/src/components/FieldHistory.tsx` |
| Version comparison | `frontend/src/components/SyllabusComparison.tsx` |

When changing a repeated structure, update the matching frontend tests and check the DOCX export mapping as well. When changing a template-driven field, also review ADR-001 and the template definition before changing the UI.
