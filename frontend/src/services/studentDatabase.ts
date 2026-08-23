/**
 * The student record, the cohorts it can be put in, and a cohort's groups and CRNs.
 *
 * Our side holds a student id, a status and a cohort — nothing else. Names belong to the
 * registrar extension and stay in the browser, so nothing here ever sends one.
 */

import { apiFetch } from "@/services/http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type Cohort = {
  id: string;
  name: string;
  term: string;
  notes: string;
  memberCount: number;
  scopeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CatalogueCourse = {
  id: string;
  code: string;
  name: string;
  component: string;
};

export type CatalogueGroup = {
  id: string;
  label: string;
  capacity: number;
  note: string;
  /** How many of the cohort's students sit in this group. */
  assigned: number;
  /** course id -> the CRN that group holds for it. */
  crns: Record<string, { crn: string; teacher: string }>;
};

/** A block of components taught in parallel groups — Foundation Year TD, Languages A1. */
export type CatalogueScope = {
  id: string;
  code: string;
  name: string;
  note: string;
  courses: CatalogueCourse[];
  groups: CatalogueGroup[];
};

export type Catalogue = { scopes: CatalogueScope[] };

export type ImportReport = {
  filename: string;
  sheet: string;
  style: "cohort" | "language";
  read: { scopes: number; groups: number; crns: number };
  added: { scopes: number; courses: number; groups: number; crns: number };
};

const BASE = "/api/v1/student-database";

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // fall through to the generic message
  }
  return "That could not be saved. Try again in a moment.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}${path}`, init);
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchCohorts(): Promise<Cohort[]> {
  return (await request<{ cohorts: Cohort[] }>(`${BASE}/cohorts`)).cohorts;
}

export function createCohort(input: { name: string; term?: string; notes?: string }): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts`, "POST", { term: "", notes: "", ...input });
}

export function updateCohort(
  cohortId: string,
  input: { name: string; term: string; notes: string },
): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts/${cohortId}`, "PATCH", input);
}

export function deleteCohort(cohortId: string): Promise<void> {
  return request<void>(`${BASE}/cohorts/${cohortId}`, { method: "DELETE" });
}

export function fetchCatalogue(cohortId: string): Promise<Catalogue> {
  return request<Catalogue>(`${BASE}/cohorts/${cohortId}/catalogue`);
}

export function importReferenceWorkbook(cohortId: string, file: File): Promise<ImportReport> {
  const body = new FormData();
  body.set("workbook", file);
  return request<ImportReport>(`${BASE}/cohorts/${cohortId}/catalogue/import`, { method: "POST", body });
}

export function addScope(
  cohortId: string,
  input: { code: string; name?: string; note?: string },
): Promise<{ id: string }> {
  return send<{ id: string }>(`${BASE}/cohorts/${cohortId}/scopes`, "POST", { name: "", note: "", ...input });
}

export function updateScope(
  scopeId: string,
  input: { code: string; name: string; note: string },
): Promise<void> {
  return send<void>(`${BASE}/scopes/${scopeId}`, "PATCH", input);
}

export function deleteScope(scopeId: string): Promise<void> {
  return request<void>(`${BASE}/scopes/${scopeId}`, { method: "DELETE" });
}

export function addCourse(
  scopeId: string,
  input: { code: string; name?: string; component?: string },
): Promise<{ id: string }> {
  return send<{ id: string }>(`${BASE}/scopes/${scopeId}/courses`, "POST", {
    name: "",
    component: "",
    ...input,
  });
}

export function deleteCourse(courseId: string): Promise<void> {
  return request<void>(`${BASE}/courses/${courseId}`, { method: "DELETE" });
}

export function addGroup(
  scopeId: string,
  input: { label: string; capacity?: number; note?: string },
): Promise<{ id: string }> {
  return send<{ id: string }>(`${BASE}/scopes/${scopeId}/groups`, "POST", {
    capacity: 0,
    note: "",
    ...input,
  });
}

export function updateGroup(
  groupId: string,
  input: { label: string; capacity: number; note: string },
): Promise<void> {
  return send<void>(`${BASE}/groups/${groupId}`, "PATCH", input);
}

export function deleteGroup(groupId: string): Promise<void> {
  return request<void>(`${BASE}/groups/${groupId}`, { method: "DELETE" });
}

/** One cell of the matrix. An empty CRN clears it. */
export function setGroupCrn(
  groupId: string,
  courseId: string,
  input: { crn: string; teacher?: string },
): Promise<void> {
  return send<void>(`${BASE}/groups/${groupId}/courses/${courseId}`, "PUT", { teacher: "", ...input });
}

/** One student, as our side knows them: an id, a status, and the cohort they are in. */
export type Student = {
  studentId: string;
  /** What the last full sync found. */
  status: "in_portal" | "not_in_portal";
  cohortId: string | null;
  cohortName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** scope id -> group id, for the blocks this student has been placed in. */
  groups: Record<string, string>;
};

export type SyncReport = {
  seen: number;
  added: number;
  missing: number;
  syncedAt: string;
};

/**
 * A view: a named population, and the filter that fixes what it asks the portal.
 *
 * The filter is set when the view is made and never afterwards — that is what makes "no
 * longer in the portal" mean something, because the question has not changed underneath
 * the answer. A different question is a different view.
 */
export type StudentView = {
  id: string;
  name: string;
  description: string;
  filter: Record<string, string[]>;
  /** How many students this view still returns, and how many it has stopped returning. */
  held: number;
  gone: number;
  lastSyncedAt: string;
  createdAt: string;
  updatedBy: string;
};

export async function fetchViews(): Promise<StudentView[]> {
  return (await request<{ views: StudentView[] }>(`${BASE}/views`)).views;
}

/** Administrators only: a new view fixes a population, and its filter cannot change. */
export function createView(input: {
  name: string;
  description?: string;
  filter: Record<string, string[]>;
}): Promise<StudentView> {
  return send<StudentView>(`${BASE}/views`, "POST", { description: "", ...input });
}

/** Administrators only: this takes the record of who the view returned with it. */
export function deleteView(viewId: string): Promise<void> {
  return request<void>(`${BASE}/views/${viewId}`, { method: "DELETE" });
}

export async function fetchStudents(viewId = ""): Promise<Student[]> {
  const path = viewId ? `${BASE}/students?view=${encodeURIComponent(viewId)}` : `${BASE}/students`;
  return (await request<{ students: Student[] }>(path)).students;
}

/**
 * Tell the server which ids this view's filter just returned.
 *
 * A sync is a census of that view's population, so an id the view held and the pull did
 * not return has left it. Nothing else writes to a view's membership.
 */
export async function syncView(viewId: string, studentIds: string[]): Promise<SyncReport> {
  return send<SyncReport>(`${BASE}/views/${viewId}/sync`, "POST", { studentIds });
}

/** Put students in a cohort, or take them out of whichever one they are in with null. */
export async function setCohort(studentIds: string[], cohortId: string | null): Promise<number> {
  const body = await send<{ moved: number }>(`${BASE}/students/cohort`, "POST", { studentIds, cohortId });
  return body.moved;
}
