export type CatalogueCategory =
  | "people"
  | "programmes"
  | "plos"
  | "competencies"
  | "teaching-presets"
  | "assessment-types"
  | "rubric-presets"
  | "bibliography-types";

export type CatalogueEntry = {
  id: string;
  category: CatalogueCategory;
  parentId: string | null;
  label: string;
  payload: Record<string, unknown>;
  sortOrder: number;
  isRetired: boolean;
  retiredAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogueEntryInput = {
  label: string;
  payload: Record<string, unknown>;
  parentId?: string | null;
  sortOrder?: number;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}/api/v1${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listCatalogueEntries(
  category: CatalogueCategory,
  options: { query?: string; parentId?: string; includeRetired?: boolean; limit?: number; offset?: number } = {},
): Promise<CatalogueEntry[]> {
  const params = new URLSearchParams();
  if (options.query) params.set("query", options.query);
  if (options.parentId) params.set("parentId", options.parentId);
  if (options.includeRetired) params.set("includeRetired", "true");
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const suffix = params.size ? `?${params}` : "";
  return request<{ items: CatalogueEntry[] }>(`/syllabus-catalogues/${category}${suffix}`).then((result) => result.items);
}

export function createCatalogueEntry(category: CatalogueCategory, input: CatalogueEntryInput): Promise<CatalogueEntry> {
  return request<CatalogueEntry>(`/syllabus-catalogues/${category}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateCatalogueEntry(
  category: CatalogueCategory,
  id: string,
  input: CatalogueEntryInput & { expectedRevision: number },
): Promise<CatalogueEntry> {
  return request<CatalogueEntry>(`/syllabus-catalogues/${category}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function retireCatalogueEntry(category: CatalogueCategory, id: string, expectedRevision: number): Promise<CatalogueEntry> {
  return request<CatalogueEntry>(`/syllabus-catalogues/${category}/${id}/retire`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision }),
  });
}
