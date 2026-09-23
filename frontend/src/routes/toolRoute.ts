// "settings" is not an app: it is reached from the user menu, not from the picker.
export type ToolId = "roster" | "syllabus" | "database" | "settings";

/** The pages of Settings, each its own entry in the account menu and its own address. */
export type SettingsSection = "users" | "tokens" | "checks";

const tools = new Set<ToolId>(["roster", "syllabus", "database", "settings"]);

function asToolId(value: string): ToolId | null {
  // Timetables and the part-time teacher database used to be applications of their own;
  // their pages now live in the student one, so a link somebody kept still opens something
  // rather than nothing. Which page is picked up from the address in `App`.
  if (value === "timetables" || value === "teachers") return "database";
  return tools.has(value as ToolId) ? (value as ToolId) : null;
}

/** The parts of "#/database/groups", without the empties a stray slash leaves behind. */
function segments(hash: string): string[] {
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export function toolFromLocation(pathname: string, hash: string): ToolId | null {
  if (pathname === "/requisition" || hash === "#/requisition") return "database";
  const pathTool = asToolId(pathname.replace(/^\//, ""));
  if (pathTool) return pathTool;

  return asToolId(segments(hash)[0] ?? "");
}

/**
 * Which page inside the application, from "#/database/groups".
 *
 * An application's pages were state and nothing else, so every refresh — and every use of
 * the back button — dropped the coordinator back on the first one, however deep in the
 * work they were. Keeping it in the address makes reloading, going back, and sending
 * somebody a link all mean the same thing.
 *
 * Returns "" when the address names no page, which is the caller's cue to use its default
 * rather than to show nothing.
 */
export function pageFromLocation(hash: string): string {
  return segments(hash)[1] ?? "";
}

/**
 * What within the page, from "#/database/semesters/timetable:abc123".
 *
 * A page is not always one screen. Semesters is a list until you open a week, and that
 * week is the screen a coordinator spends the afternoon on — but it was state and nothing
 * else, so a reload, or a step to another page and back, put them in front of the list
 * again with no way to say where they had been.
 *
 * Returns "" when the address names nothing beyond the page, which is the page's cue to
 * show whatever it shows by default.
 */
export function detailFromLocation(hash: string): string {
  return segments(hash)[2] ?? "";
}

/** The address for a page within a tool, and for what is open within the page. */
export function locationFor(tool: ToolId, page = "", detail = ""): string {
  if (!page) return `/${tool}`;
  return detail ? `/${tool}/${page}/${detail}` : `/${tool}/${page}`;
}
