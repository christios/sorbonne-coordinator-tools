export type ToolId = "roster" | "syllabus";

const tools = new Set<ToolId>(["roster", "syllabus"]);

function asToolId(value: string): ToolId | null {
  return tools.has(value as ToolId) ? (value as ToolId) : null;
}

export function toolFromLocation(pathname: string, hash: string): ToolId | null {
  const pathTool = asToolId(pathname.replace(/^\//, ""));
  if (pathTool) return pathTool;

  return asToolId(hash.replace(/^#\/?/, ""));
}
