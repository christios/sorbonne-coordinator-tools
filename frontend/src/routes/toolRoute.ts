// "settings" is not an app: it is reached from the user menu, not from the picker.
export type ToolId = "roster" | "syllabus" | "teachers" | "timetables" | "database" | "settings";

const tools = new Set<ToolId>(["roster", "syllabus", "teachers", "timetables", "database", "settings"]);

function asToolId(value: string): ToolId | null {
  return tools.has(value as ToolId) ? (value as ToolId) : null;
}

export function toolFromLocation(pathname: string, hash: string): ToolId | null {
  if (pathname === "/requisition" || hash === "#/requisition") return "teachers";
  const pathTool = asToolId(pathname.replace(/^\//, ""));
  if (pathTool) return pathTool;

  return asToolId(hash.replace(/^#\/?/, ""));
}
