/**
 * Cohorts and their catalogue of groups and CRNs.
 *
 * A cohort holds student ids and nothing else. Names belong to the registrar extension
 * and stay in the browser, so nothing in this module ever sends one.
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

export type CohortMember = {
  studentId: string;
  addedAt: string;
  addedBy: string;
  /** scope id -> group id, for the blocks this student has been placed in. */
  groups: Record<string, string>;
};

export async function fetchMembers(cohortId: string): Promise<CohortMember[]> {
  return (await request<{ members: CohortMember[] }>(`${BASE}/cohorts/${cohortId}/members`)).members;
}

export async function addMembers(cohortId: string, studentIds: string[]): Promise<number> {
  const body = await send<{ added: number }>(`${BASE}/cohorts/${cohortId}/members`, "POST", { studentIds });
  return body.added;
}

export async function removeMembers(cohortId: string, studentIds: string[]): Promise<number> {
  const body = await send<{ removed: number }>(
    `${BASE}/cohorts/${cohortId}/members/remove`,
    "POST",
    { studentIds },
  );
  return body.removed;
}

// ------------------------------------------------------------- saved searches

/** A named registrar search: portal codes, shared with every coordinator. */
export type SavedSearch = {
  id: string;
  name: string;
  description: string;
  filter: Record<string, string[]>;
  expectedCount: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type SavedSearchInput = {
  name: string;
  description?: string;
  filter: Record<string, string[]>;
  expectedCount?: number;
};

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  return (await request<{ filters: SavedSearch[] }>(`${BASE}/filters`)).filters;
}

export function createSavedSearch(input: SavedSearchInput): Promise<SavedSearch> {
  return send<SavedSearch>(`${BASE}/filters`, "POST", { description: "", expectedCount: 0, ...input });
}

export function updateSavedSearch(id: string, input: SavedSearchInput): Promise<SavedSearch> {
  return send<SavedSearch>(`${BASE}/filters/${id}`, "PUT", { description: "", expectedCount: 0, ...input });
}

export function deleteSavedSearch(id: string): Promise<void> {
  return request<void>(`${BASE}/filters/${id}`, { method: "DELETE" });
}
