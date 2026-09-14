// "settings" is not an app: it is reached from the user menu, not from the picker.
export type ToolId = "roster" | "syllabus" | "database" | "settings";

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

/** The address for a page within a tool. */
export function locationFor(tool: ToolId, page = ""): string {
  return page ? `/${tool}/${page}` : `/${tool}`;
}
