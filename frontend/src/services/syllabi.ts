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
};

export type Syllabus = SyllabusSummary & { content: SyllabusContent };

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
  sections: Array<{ id: string; label: string }>;
};

export type FieldHistoryEntry = {
  previousValue: unknown;
  newValue: unknown;
  revision: number;
  changedAt: string;
  operations?: WordDiffOperation[];
};

export type WordDiffOperation =
  | { type: "equal" | "insert" | "delete"; text: string }
  | { type: "substitute"; left: string; right: string };

export type SyllabusChange = {
  path: string;
  label: string;
  left: unknown;
  right: unknown;
  kind: "added" | "removed" | "changed";
  operations?: WordDiffOperation[];
};

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
  const response = await fetch(`${API_BASE_URL}/api/v1/syllabi/folders/${id}`, { method: "DELETE" });
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
  const response = await fetch(`${API_BASE_URL}/api/v1/syllabi/${id}`, { method: "DELETE" });
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
  const response = await fetch(`${API_BASE_URL}/api/v1/syllabi/${syllabusId}/export`);
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
