import { apiFetch } from "@/services/http";
export type BibliographyLookupKind = "book" | "article";

export type BibliographyLookupItem = {
  provider: string;
  kind: BibliographyLookupKind;
  title: string;
  authors: string[];
  year: string | null;
  publisher: string | null;
  isbn: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  url: string | null;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function lookupBibliography(kind: BibliographyLookupKind, query: string): Promise<BibliographyLookupItem[]> {
  const parameters = new URLSearchParams({ kind, q: query.trim() });
  const response = await apiFetch(`${API_BASE_URL}/api/v1/bibliography/lookup?${parameters}`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  return (await response.json() as { items: BibliographyLookupItem[] }).items;
}
