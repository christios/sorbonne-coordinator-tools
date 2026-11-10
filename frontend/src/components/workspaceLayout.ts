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
export const WORKSPACE_SIDEBAR = "rounded-lg border border-[#d9dee7] bg-white p-2 lg:min-h-0 lg:overflow-y-auto";
