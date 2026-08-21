import { RequisitionContent } from "@/services/requisitions";
import { apiFetch } from "@/services/http";

export type Teacher = {
  id: string;
  folderId: string | null;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TeacherFolder = { id: string; name: string; parentId: string | null; createdAt: string; updatedAt: string };
export type TeacherRequisitionSummary = { id: string; teacherId: string; label: string; academicYear: string; revision: number; createdAt: string; updatedAt: string };
export type TeacherRequisition = TeacherRequisitionSummary & { content: RequisitionContent };
export type TeacherInput = Pick<Teacher, "fullName" | "email" | "phone" | "notes">;
export type RequisitionInput = { label: string; academicYear: string; sourceRequisitionId?: string };
export type CourseCatalogueEntry = {
  id: string;
  crn: string;
  term: string;
  courseCode: string;
  courseTitle: string;
  sequence: string;
  credit: string;
  department: string;
  level: string;
  college: string;
  contactHours: string;
  isObsolete: boolean;
  importedAt: string;
  obsoleteAt: string | null;
};
export type CourseCatalogueImportResult = { imported: number; retained: number; obsoleted: number; totalActive: number };
export type TeacherDocumentFolder = { teacherId: string; driveFolderId: string; driveFolderUrl: string; responseFingerprint: string; responseTimestamp: string; syncedAt: string; createdAt: string; updatedAt: string };
export type TeacherDocumentIssue = { id: string; sourceEmail: string; sourceTimestamp: string; reason: "UNMATCHED_EMAIL" | "AMBIGUOUS_EMAIL" | "COPY_FAILED"; message: string; status: "OPEN" | "RESOLVED"; createdAt: string; updatedAt: string };
export type TeacherDocumentSyncResult = { updated: number; skipped: number; needsReview: number };

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listTeachers(includeArchived = false): Promise<Teacher[]> { return (await request<{ items: Teacher[] }>(`/teachers?includeArchived=${includeArchived}`)).items; }
export function getTeacher(id: string): Promise<Teacher> { return request<Teacher>(`/teachers/${id}`); }
export function createTeacher(input: TeacherInput): Promise<Teacher> { return request<Teacher>("/teachers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export function updateTeacher(id: string, input: TeacherInput): Promise<Teacher> { return request<Teacher>(`/teachers/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export function archiveTeacher(id: string): Promise<Teacher> { return request<Teacher>(`/teachers/${id}/archive`, { method: "POST" }); }
export function restoreTeacher(id: string): Promise<Teacher> { return request<Teacher>(`/teachers/${id}/restore`, { method: "POST" }); }
export async function listTeacherFolders(): Promise<TeacherFolder[]> { return (await request<{ items: TeacherFolder[] }>("/teachers/folders")).items; }
export async function listCourseCatalogue(query = "", includeObsolete = false): Promise<CourseCatalogueEntry[]> { return (await request<{ items: CourseCatalogueEntry[] }>(`/teachers/courses?query=${encodeURIComponent(query)}&includeObsolete=${includeObsolete}`)).items; }
export function importCourseCatalogue(file: File): Promise<CourseCatalogueImportResult> { const body = new FormData(); body.set("file", file); return request<CourseCatalogueImportResult>("/teachers/courses/import", { method: "POST", body }); }
export function createTeacherFolder(input: { name: string; parentId?: string | null }): Promise<TeacherFolder> { return request<TeacherFolder>("/teachers/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export async function deleteTeacherFolder(id: string): Promise<void> { await emptyRequest(`/teachers/folders/${id}`, { method: "DELETE" }); }
export function moveTeacherToFolder(id: string, folderId: string | null): Promise<Teacher> { return request<Teacher>(`/teachers/${id}/folder`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId }) }); }
export async function listTeacherRequisitions(teacherId: string): Promise<TeacherRequisitionSummary[]> { return (await request<{ items: TeacherRequisitionSummary[] }>(`/teachers/${teacherId}/requisitions`)).items; }
export function createTeacherRequisition(teacherId: string, input: RequisitionInput): Promise<TeacherRequisition> { return request<TeacherRequisition>(`/teachers/${teacherId}/requisitions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export function getTeacherRequisition(id: string): Promise<TeacherRequisition> { return request<TeacherRequisition>(`/teacher-requisitions/${id}`); }
export function updateTeacherRequisition(requisition: TeacherRequisition): Promise<TeacherRequisition> { return request<TeacherRequisition>(`/teacher-requisitions/${requisition.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: requisition.revision, label: requisition.label, academicYear: requisition.academicYear, content: requisition.content }) }); }
export async function deleteTeacherRequisition(id: string): Promise<void> { await emptyRequest(`/teacher-requisitions/${id}`, { method: "DELETE" }); }
export async function downloadTeacherRequisitionExport(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teacher-requisitions/${id}/export`);
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? `Export failed with status ${response.status}`); }
  const filename = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "recruitment-request.docx";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

function documentAuth(credential: string): HeadersInit { return { Authorization: `Bearer ${credential}` }; }
export async function getTeacherDocuments(teacherId: string, credential: string): Promise<TeacherDocumentFolder | null> { return (await request<{ folder: TeacherDocumentFolder | null }>(`/teacher-documents/teachers/${teacherId}`, { headers: documentAuth(credential) })).folder; }
export async function listTeacherDocumentIssues(credential: string): Promise<TeacherDocumentIssue[]> { return (await request<{ items: TeacherDocumentIssue[] }>("/teacher-documents/issues", { headers: documentAuth(credential) })).items; }
export function syncTeacherDocuments(credential: string, driveAccessToken: string): Promise<TeacherDocumentSyncResult> { return request<TeacherDocumentSyncResult>("/teacher-documents/sync", { method: "POST", headers: { ...documentAuth(credential), "X-Google-Drive-Access-Token": driveAccessToken } }); }
export async function downloadTeacherDocuments(teacherId: string, credential: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teacher-documents/teachers/${teacherId}/download`, { headers: documentAuth(credential) });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? `Download failed with status ${response.status}`); }
  const filename = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "teacher-documents.zip";
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

async function emptyRequest(path: string, init: RequestInit): Promise<void> { const response = await apiFetch(`${API_BASE_URL}/api/v1${path}`, init); if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? `Request failed with status ${response.status}`); } }
