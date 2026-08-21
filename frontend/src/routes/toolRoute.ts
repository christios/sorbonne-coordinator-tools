export type ToolId = "roster" | "syllabus" | "teachers" | "timetables";

const tools = new Set<ToolId>(["roster", "syllabus", "teachers", "timetables"]);

function asToolId(value: string): ToolId | null {
  return tools.has(value as ToolId) ? (value as ToolId) : null;
}

export function toolFromLocation(pathname: string, hash: string): ToolId | null {
  if (pathname === "/requisition" || hash === "#/requisition") return "teachers";
  const pathTool = asToolId(pathname.replace(/^\//, ""));
  if (pathTool) return pathTool;

  return asToolId(hash.replace(/^#\/?/, ""));
}
