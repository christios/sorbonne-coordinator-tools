/**
 * One layout for the syllabus builder's screens with a menu beside them — the library, the
 * editor and Manage catalogues — so moving between them does not move the menu.
 *
 * On a desktop the page fills the window: under a header of the same height on every screen
 * (eyebrow, title, one line beneath), the menu is the same width, starts at the same height
 * and runs to the bottom of the window whatever it lists, and each side scrolls on its own.
 * On a phone the menu stacks above the content and the page scrolls as one.
 */

/** The menu and what it opens, side by side from `lg` up. */
export const WORKSPACE_BODY = "mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[240px_minmax(0,1fr)]";

/** The menu's card: full height beside the content, scrolling inside itself if it is long. */
export const WORKSPACE_SIDEBAR = "rounded-lg border border-[#c3cbd6] bg-white p-2 shadow-sm lg:min-h-0 lg:overflow-y-auto";

/**
 * The same, with a menu that shrinks to its section numbers between `lg` and `xl` (the
 * syllabus editor, 11 Nov 2026): on a 1024px screen the editor's content needs the room —
 * the learning outcomes put their PLOs in a panel beside the matrix. Names show on hover and
 * to a screen reader; from 1280px the menu is full width again.
 */
export const WORKSPACE_BODY_COMPACT_MENU = "mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[4.5rem_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]";
