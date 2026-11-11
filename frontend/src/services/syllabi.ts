import type { FieldHistoryEntry, WordDiffOperation } from "@/services/fieldHistory";
import { apiFetch } from "@/services/http";

export type { FieldHistoryEntry, WordDiffOperation } from "@/services/fieldHistory";

export type SyllabusContent = Record<string, unknown>;

export type SyllabusSummary = {
  id: string;
  seriesId: string;
  folderId: string | null;
  templateId: string;
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  /** Whoever wrote it. Null for the ones the department wrote before anyone had their own. */
  ownerEmail: string | null;
  visibility: "private" | "public";
  /** When its author asked for it to be reviewed, if they have. */
  submittedAt: string | null;
};

export type Syllabus = SyllabusSummary & { content: SyllabusContent };

/** Publishing a syllabus, or taking it back — which also withdraws any review request. */
export function setSyllabusVisibility(id: string, visibility: "private" | "public"): Promise<Syllabus> {
  return request<Syllabus>(`/syllabi/${id}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
}

/** Asking a coordinator to look at it, or taking the request back. Only its author may. */
export function setSyllabusReview(id: string, submitted: boolean): Promise<Syllabus> {
  return request<Syllabus>(`/syllabi/${id}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submitted }),
  });
}

/** Something the syllabus must still say before it can be submitted, and the section it is in. */
export type MissingForReview = {
  section: string;
  /** The whole sentence: "Give 15 sessions a week: …". */
  message: string;
  /** The schedule cards it concerns, to open each one (11 Nov 2026). */
  items?: Array<{ id: string; label: string }>;
  /** What is missing in a word or two: "week", "CLOs assessed". */
  need?: string;
  /** Said shortly for many cards at once: "15 sessions without a week". */
  summary?: string;
};
export type SyllabusCompleteness = { complete: boolean; missing: MissingForReview[] };

/**
 * What the syllabus must still say before it can be submitted for review. The server keeps the
 * rules (syllabus_completeness.py) and checks them again when the syllabus is submitted.
 */
export function getSyllabusCompleteness(id: string): Promise<SyllabusCompleteness> {
  return request<SyllabusCompleteness>(`/syllabi/${id}/completeness`);
}

export type SyllabusFolder = {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateFolderInput = {
  name: string;
  parentId?: string | null;
};

export type SyllabusTemplate = {
  id: string;
  name: string;
  description: string;
  documentPath: string;
  /** `parts` are the stored content keys a screen section edits, in document order. */
  sections: Array<{ id: string; label: string; parts?: string[] }>;
  /** False for a template new syllabi no longer start on (the Foundation Year form, since November 2026). */
  offered?: boolean;
};

export type SyllabusChange = {
  path: string;
  label: string;
  left: unknown;
  right: unknown;
  kind: "added" | "removed" | "changed";
  operations?: WordDiffOperation[];
};

export type SyllabusComparisonRow = {
  id: string;
  label: string;
  left: unknown;
  right: unknown;
  status: "mapped" | "left-only" | "right-only";
  kind: "changed" | "unchanged";
  operations?: WordDiffOperation[];
};

/**
 * What a new syllabus is called until its course is chosen. Since November 2026 "New syllabus"
 * opens the editor straight away, and choosing the course in section 1 names it.
 */
export const UNTITLED_SYLLABUS = "Untitled syllabus";

/** "2026-2027": the academic year a day falls in; August opens it. */
export function currentAcademicYear(today: Date = new Date()): string {
  const first = today.getMonth() >= 7 ? today.getFullYear() : today.getFullYear() - 1;
  return `${first}-${first + 1}`;
}

/** "2027-2028" after "2026-2027"; anything not written as two years comes back as it was. */
export function followingAcademicYear(year: string): string {
  const match = /^(\d{4})-(\d{4})$/.exec(year.trim());
  return match ? `${Number(match[1]) + 1}-${Number(match[2]) + 1}` : year;
}

export type CreateSyllabusInput = {
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  sourceSyllabusId?: string;
  templateId?: string;
};

export type SyllabusComparison = {
  left: Syllabus;
  right: Syllabus;
  changes: SyllabusChange[];
  rows: SyllabusComparisonRow[];
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listSyllabi(): Promise<SyllabusSummary[]> {
  return (await request<{ items: SyllabusSummary[] }>("/syllabi")).items;
}

export async function listSyllabusTemplates(): Promise<SyllabusTemplate[]> {
  return (await request<{ items: SyllabusTemplate[] }>("/syllabi/templates")).items;
}

export function syllabusTemplateDocumentUrl(template: SyllabusTemplate): string {
  return `${API_BASE_URL}/api/v1${template.documentPath}`;
}

export async function listSyllabusFolders(): Promise<SyllabusFolder[]> {
  return (await request<{ items: SyllabusFolder[] }>("/syllabi/folders")).items;
}

export function createFolder(input: CreateFolderInput): Promise<SyllabusFolder> {
  return request<SyllabusFolder>("/syllabi/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function deleteFolder(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/syllabi/folders/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
}

export function getSyllabus(id: string): Promise<Syllabus> {
  return request<Syllabus>(`/syllabi/${id}`);
}

export function createSyllabus(input: CreateSyllabusInput): Promise<Syllabus> {
  return request<Syllabus>("/syllabi", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateSyllabus(
  id: string,
  input: Pick<Syllabus, "content"> & { expectedRevision: number; courseTitle: string; courseCode: string; academicYear: string },
): Promise<Syllabus> {
  return request<Syllabus>(`/syllabi/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function moveSyllabusToFolder(id: string, folderId: string | null): Promise<Syllabus> {
  return request<Syllabus>(`/syllabi/${id}/folder`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  });
}

export async function deleteSyllabus(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/syllabi/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
}

export function compareSyllabi(leftId: string, rightId: string): Promise<SyllabusComparison> {
  return request<SyllabusComparison>(`/syllabi/${leftId}/comparison/${rightId}`);
}

export function getFieldHistory(syllabusId: string, fieldPath: string): Promise<FieldHistoryEntry[]> {
  return request<{ items: FieldHistoryEntry[] }>(`/syllabi/${syllabusId}/history?fieldPath=${encodeURIComponent(fieldPath)}`).then((response) => response.items);
}

export async function downloadSyllabusExport(syllabusId: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/syllabi/${syllabusId}/export`);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Export failed with status ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? "syllabus.docx";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
