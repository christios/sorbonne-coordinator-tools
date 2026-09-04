/**
 * The student record, the cohorts it can be put in, and a cohort's groups and CRNs.
 *
 * Our side holds a student id, a status and a cohort — nothing else. Names belong to the
 * registrar extension and stay in the browser, so nothing here ever sends one.
 */

import { apiFetch } from "@/services/http";
import type { Operation, WorkbookPreview } from "@/services/workbookReview";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export type Cohort = {
  id: string;
  name: string;
  term: string;
  notes: string;
  /** What the cohort expects of its students, as the portal words it. Empty means no expectation. */
  program: string;
  yearLevel: string;
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
  /** The student tab this block's column lives on in the workbook it came from. */
  tab?: string;
  /** What that column is called there: "TD group", "Readiness group". */
  groupColumn?: string;
  /** Which column it was, so blocks sharing a tab come back in the order they were in. */
  columnIndex?: number;
  courses: CatalogueCourse[];
  groups: CatalogueGroup[];
};

export type Catalogue = { scopes: CatalogueScope[] };

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

export type CohortInput = { name: string; term?: string; notes?: string; program?: string; yearLevel?: string };

export function createCohort(input: CohortInput): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts`, "POST", { term: "", notes: "", program: "", yearLevel: "", ...input });
}

export function updateCohort(cohortId: string, input: CohortInput): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts/${cohortId}`, "PATCH", {
    term: "",
    notes: "",
    program: "",
    yearLevel: "",
    ...input,
  });
}

/** What counts as a discrepancy between the portal and a cohort. Shared by every coordinator. */
export type DiscrepancyRule = {
  id: string;
  field: string;
  kind: "changed" | "changed_to" | "is" | "is_not" | "differs";
  values: string[];
};

export async function fetchDiscrepancyRules(): Promise<DiscrepancyRule[]> {
  // The full API address, like every other call here: a relative path reaches the
  // dev server in local development and comes back as index.html.
  const response = await apiFetch(`${API_BASE_URL}${BASE}/discrepancy-rules`);
  if (!response.ok) throw new Error("The rules could not be loaded.");
  return ((await response.json()) as { rules: DiscrepancyRule[] }).rules;
}

/** The whole set, replaced: the page edits them as one list. */
export async function saveDiscrepancyRules(
  rules: Omit<DiscrepancyRule, "id">[] | DiscrepancyRule[],
): Promise<DiscrepancyRule[]> {
  return (await send<{ rules: DiscrepancyRule[] }>(`${BASE}/discrepancy-rules`, "PUT", { rules })).rules;
}

export function deleteCohort(cohortId: string): Promise<void> {
  return request<void>(`${BASE}/cohorts/${cohortId}`, { method: "DELETE" });
}

export function fetchCatalogue(cohortId: string, termId?: string): Promise<Catalogue> {
  // A cohort's blocks are defined per semester, so asking without one would show both
  // semesters' "TD" at once, meaning different things.
  const query = termId ? `?term_id=${encodeURIComponent(termId)}` : "";
  return request<Catalogue>(`${BASE}/cohorts/${cohortId}/catalogue${query}`);
}

export type PlacementReport = {
  assigned: number;
  /** Ids the block's cohort does not hold. They were not placed. */
  skipped: string[];
};

/**
 * Put students in one group of one block, or take them out of it with a null group.
 *
 * A student holds at most one group per block, so this replaces rather than adds — which
 * is what makes their enrolment the union of their blocks rather than a pile of history.
 */
export function assignStudents(
  scopeId: string,
  studentIds: string[],
  groupId: string | null,
): Promise<PlacementReport> {
  return send<PlacementReport>(`${BASE}/scopes/${scopeId}/assignments`, "PUT", { studentIds, groupId });
}

/** Who is in which group, as `{student id: {scope id: group id}}`. */
export async function fetchAssignments(cohortId: string): Promise<Record<string, Record<string, string>>> {
  const payload = await request<{ assignments: Record<string, Record<string, string>> }>(
    `${BASE}/cohorts/${cohortId}/assignments`,
  );
  return payload.assignments;
}

/**
 * What one workbook would change, without changing any of it.
 *
 * One file, both halves: the Reference sheet says what the blocks are, the student tabs say
 * who is in them. They were two uploads and are one, because they were always one document.
 */
export function previewWorkbook(
  cohortId: string,
  termId: string,
  file: File,
): Promise<WorkbookPreview> {
  const body = new FormData();
  body.set("term_id", termId);
  body.set("workbook", file);
  return request<WorkbookPreview>(`${BASE}/cohorts/${cohortId}/workbook/preview`, {
    method: "POST",
    body,
  });
}

export type WorkbookApplied = {
  courses: number;
  groups: number;
  cells: number;
  placements: number;
};

/** Carry out the rows that were ticked, and only those. */
export function applyWorkbook(
  cohortId: string,
  termId: string,
  operations: Operation[],
): Promise<WorkbookApplied> {
  return send<WorkbookApplied>(`${BASE}/cohorts/${cohortId}/workbook/apply`, "POST", {
    termId,
    operations,
  });
}

export function addScope(
  cohortId: string,
  input: { code: string; name?: string; note?: string; termId?: string },
): Promise<{ id: string }> {
  // The semester matters: a block added without one is invisible to the page that made it.
  return send<{ id: string }>(`${BASE}/cohorts/${cohortId}/scopes`, "POST", {
    name: "",
    note: "",
    termId: "",
    ...input,
  });
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
  /** When they were placed in that cohort; empty for a placement made before this was kept. */
  cohortSince: string;
  firstSeenAt: string;
  lastSeenAt: string;
  /** The blocks this student sits in, labelled — one entry per (semester, block). */
  groups: { termId: string; scopeCode: string; groupLabel: string }[];
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
