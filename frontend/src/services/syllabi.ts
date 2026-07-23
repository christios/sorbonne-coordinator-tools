export type SyllabusContent = Record<string, unknown>;

export type SyllabusSummary = {
  id: string;
  seriesId: string;
  courseTitle: string;
  courseCode: string;
  academicYear: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type Syllabus = SyllabusSummary & { content: SyllabusContent };

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

export function compareSyllabi(leftId: string, rightId: string): Promise<SyllabusComparison> {
  return request<SyllabusComparison>(`/syllabi/${leftId}/comparison/${rightId}`);
}

export function getFieldHistory(syllabusId: string, fieldPath: string): Promise<FieldHistoryEntry[]> {
  return request<{ items: FieldHistoryEntry[] }>(`/syllabi/${syllabusId}/history?fieldPath=${encodeURIComponent(fieldPath)}`).then((response) => response.items);
}
