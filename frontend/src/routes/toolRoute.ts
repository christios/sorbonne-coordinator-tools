// "settings" is not an app: it is reached from the user menu, not from the picker.
export type ToolId = "roster" | "syllabus" | "teachers" | "database" | "settings";

const tools = new Set<ToolId>(["roster", "syllabus", "teachers", "database", "settings"]);

function asToolId(value: string): ToolId | null {
  // Timetables used to be an application of its own; its pages now live in the student
  // one, so a link somebody kept still opens something rather than nothing.
  if (value === "timetables") return "database";
  return tools.has(value as ToolId) ? (value as ToolId) : null;
}

export function toolFromLocation(pathname: string, hash: string): ToolId | null {
  if (pathname === "/requisition" || hash === "#/requisition") return "teachers";
  const pathTool = asToolId(pathname.replace(/^\//, ""));
  if (pathTool) return pathTool;

  return asToolId(hash.replace(/^#\/?/, ""));
}
