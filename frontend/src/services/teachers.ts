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
export type TeacherInput = Pick<Teacher, "fullName" | "email" | "phone" | "notes"> & { taskTemplateIds?: string[] };
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

/**
 * A labelled link to a time sheet, which lives in OneDrive rather than here.
 *
 * The workbook belongs to whoever keeps it; all this profile holds is the label, the
 * academic year and the address, so the sheet is one click from the teacher's name.
 */
export type TeacherTimeSheet = {
  id: string;
  teacherId: string;
  label: string;
  academicYear: string;
  url: string;
  /**
   * The day the pay period this sheet covers begins, as a date. Empty where nobody has
   * said which period it is for, which is not the same as the sheet being overdue.
   */
  periodStart: string;
  createdAt: string;
  updatedAt: string;
};

export type TimeSheetInput = { label: string; academicYear: string; url: string; periodStart: string };

/**
 * What a teacher's row shows, asked once for everybody rather than once per row.
 *
 * Every fact here lives in a different table, so a list of two dozen people drawn from
 * the per-teacher routes would be fifty requests to paint one page.
 */
export type TeacherSummary = {
  requisitions: number;
  contractedHours: number;
  timeSheets: number;
  newestTimeSheet: TeacherTimeSheet | null;
  hasDocuments: boolean;
};

export async function fetchTeacherSummary(): Promise<Record<string, TeacherSummary>> {
  return (await request<{ summary: Record<string, TeacherSummary> }>("/teachers/summary")).summary;
}

/**
 * Which day of the month each semester's pay periods open on.
 *
 * Only the semesters somebody has decided about are listed; the rest are paid from
 * `default`, which travels with the answer so the browser keeps no second opinion about
 * the department's habit.
 */
export async function fetchPayCycles(): Promise<{ cycles: Record<string, number>; default: number }> {
  return request<{ cycles: Record<string, number>; default: number }>("/teachers/pay-cycles");
}

/** Say which day this semester's periods open on. */
export function setPayCycle(termId: string, opensOn: number): Promise<{ opensOn: number }> {
  return request<{ opensOn: number }>(`/teachers/pay-cycles/${encodeURIComponent(termId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opensOn }),
  });
}

export async function listTeacherTimeSheets(teacherId: string): Promise<TeacherTimeSheet[]> { return (await request<{ items: TeacherTimeSheet[] }>(`/teachers/${teacherId}/time-sheets`)).items; }
export function createTeacherTimeSheet(teacherId: string, input: TimeSheetInput): Promise<TeacherTimeSheet> { return request<TeacherTimeSheet>(`/teachers/${teacherId}/time-sheets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export function updateTeacherTimeSheet(teacherId: string, id: string, input: TimeSheetInput): Promise<TeacherTimeSheet> { return request<TeacherTimeSheet>(`/teachers/${teacherId}/time-sheets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
export async function deleteTeacherTimeSheet(teacherId: string, id: string): Promise<void> { await emptyRequest(`/teachers/${teacherId}/time-sheets/${id}`, { method: "DELETE" }); }
/**
 * Several of one teacher's requisitions at once, as a zip of the same documents.
 *
 * One chosen still goes through the single export, so the common case lands as a
 * document you can open rather than an archive you have to unpack first.
 */
export async function downloadTeacherRequisitions(teacherId: string, ids: string[]): Promise<void> {
  if (ids.length === 1) return downloadTeacherRequisitionExport(ids[0]);
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teachers/${teacherId}/requisitions/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  await saveResponse(response, "requisitions.zip");
}

/**
 * Every requisition of every teacher chosen, as one zip with a folder each.
 *
 * Returns how many of them had nothing to fetch, because a selection of twelve should
 * not fail over the one who has not been contracted yet, and the person who pressed the
 * button should still be told.
 */
export async function downloadTeachersRequisitions(teacherIds: string[]): Promise<{ withoutRequisitions: number }> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teachers/export/requisitions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ teacherIds }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed with status ${response.status}`);
  }
  const withoutRequisitions = Number(response.headers.get("X-Teachers-Without-Requisitions") ?? 0);
  await saveResponse(response, "part-time-requisitions.zip");
  return { withoutRequisitions };
}

export async function downloadTeacherRequisitionExport(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teacher-requisitions/${id}/export`);
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail ?? `Export failed with status ${response.status}`); }
  await saveResponse(response, "recruitment-request.docx");
}

/** Hand a downloaded response to the browser under the name the server gave it. */
async function saveResponse(response: Response, fallbackName: string): Promise<void> {
  const filename = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
