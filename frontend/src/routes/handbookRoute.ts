// FastAPI uses port 8000 in local development, so keep the MkDocs preview separate.
const DEFAULT_LOCAL_HANDBOOK_URL = "http://127.0.0.1:8001/";

export function handbookUrl(
  hostname: string,
  localHandbookUrl = import.meta.env.VITE_HANDBOOK_URL || DEFAULT_LOCAL_HANDBOOK_URL,
): string {
  return hostname === "localhost" || hostname === "127.0.0.1" ? localHandbookUrl : "/handbook/";
}
