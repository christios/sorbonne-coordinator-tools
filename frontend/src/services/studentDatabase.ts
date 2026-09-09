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
  /**
   * What the cohort expects of its students, as the portal codes it: the majors and the
   * portal terms it spans, and a year level. Empty means no expectation on that count.
   */
  majors: string[];
  terms: string[];
  /** "BSc-L2" — what this cohort's sheet is called in the timetable workbook. */
  workbookTab: string;
  /** The number that workbook gives this cohort's first semester: 3 for Licence 2. */
  firstSemester: number;
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
  /**
   * Which programme of the cohort takes this course, as the registrar spells it.
   *
   * Empty means all of them, which is what a set split by group NUMBER wants — Foundation
   * Year's TD 1, 2, 3 all take everything the set carries. A set split by PROGRAMME is the
   * other case: L3's CM set carries the Maths courses and the Physics courses and holds one
   * group for each, and the Physics group is not short a CRN for MATH-330.
   */
  program: string;
  /** What this course asks of the timetable, for every section of it in this set. */
  request: Request;
};

/**
 * What the timetable is asked for — said by a course, or by one section of it.
 *
 * The same eleven answers either way, because they are the same questions: how many hours
 * in all, spread how, for how many students, in what sort of room, avoiding what. A
 * course answers once for its whole set; a section answers for itself where it differs.
 */
export type Request = {
  /** An Active teacher's id, or "" when nobody has been chosen. */
  teacherId: string;
  hours: string;
  sessionsPerWeek: string;
  duration: string;
  weeks: string;
  anticipated: number;
  roomPref: string;
  dayPref: string;
  timePref: string;
  constraints: string;
  comments: string;
};

export const EMPTY_REQUEST: Request = {
  teacherId: "",
  hours: "",
  sessionsPerWeek: "",
  duration: "",
  weeks: "",
  anticipated: 0,
  roomPref: "",
  dayPref: "",
  timePref: "",
  constraints: "",
  comments: "",
};

/**
 * One stretch of a section's teaching: a CRN, and everything asked of that row.
 *
 * `part` is 1 for a section taught by one person from the first week to the last, which is
 * nearly all of them. A course handed from one professor to another at mid-semester is
 * published by the registrar as a CRN per half, and carries a part for each.
 */
export type SectionPart = Request & {
  part: number;
  crn: string;
  teacher: string;
  /** Marked rather than deleted: the fill skips it and the workbook says so. */
  retired: boolean;
};

/**
 * One section: what one group holds for one course.
 *
 * The first part's fields stand at the top level and `parts` lists every one of them, the
 * first included. A section with one part therefore reads exactly as it did before parts
 * existed — which is why nothing that shows a section's CRN or teacher had to change to go
 * on being right about it. Anything that needs EVERY CRN of a section — what a student is
 * expected to be registered in, whose hours these are, what the registrar is asked about —
 * reads `parts`.
 */
export type Section = SectionPart & {
  parts: SectionPart[];
  /**
   * How many of the group's students do not take this course — see `Exemption`.
   *
   * On the section rather than on the group: they are still in the group and still take
   * everything else in the set, so it is this one class that teaches fewer, and this one
   * room that can be booked smaller.
   */
  exempt: number;
};

export const EMPTY_PART: SectionPart = { ...EMPTY_REQUEST, part: 1, crn: "", teacher: "", retired: false };

/**
 * An empty section, whose `parts` is deliberately EMPTY rather than a list of one.
 *
 * Because this is spread — `{ ...EMPTY_SECTION, crn, retired }` — and a `parts` holding a
 * copy of the blank part would survive that spread untouched, so the section would say one
 * thing at the top level and the opposite in its own list. `partsOf` treats an empty list
 * as "this object is its own only part", which makes every such spread self-consistent.
 */
export const EMPTY_SECTION: Section = { ...EMPTY_PART, parts: [], exempt: 0 };

/**
 * Every part of a section, in order.
 *
 * A section the server built always carries at least one. Anything else — a section built
 * by hand, or one from a caller that predates parts — is its own only part, which is what
 * an empty or absent `parts` means here.
 */
export function partsOf(section: SectionPart | Section | null | undefined): SectionPart[] {
  if (!section) return [];
  const parts = (section as Section).parts;
  return parts?.length ? parts : [section];
}

export type CatalogueGroup = {
  id: string;
  label: string;
  capacity: number;
  note: string;
  /** The programme this group takes first, as the registrar spells it. Empty means any. */
  program: string;
  /** For a group of a nested set: the group of the parent set it sits inside. */
  parentGroupId: string;
  /** How many of the cohort's students sit in this group. */
  assigned: number;
  /** course id -> the section that group holds for it. */
  crns: Record<string, Section>;
};

/** A group set is plain — numbered across whatever courses it carries — or nested inside another. */
export type ScopeKind = "shared" | "nested";

/** A block of components taught in parallel groups — Foundation Year TD, Languages A1. */
export type CatalogueScope = {
  id: string;
  code: string;
  name: string;
  note: string;
  /** The Student Hub semester this block belongs to. */
  termId?: string;
  kind: ScopeKind;
  /** For a nested set, the set it sits inside. */
  parentScopeId: string;
  /**
   * True for a set the whole department shares. Languages are the case: A1-G1 holds
   * first, second and third years at once, because the level decides the group and the
   * degree does not. Such a set takes any student, and counts all of them.
   */
  openToAll: boolean;
  /**
   * Whose row this is. A shared set has to live under some cohort and belongs to none of
   * them, so a page asking for the shared sets too can tell them apart from its own.
   */
  cohortId?: string;
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

/** One cohort's catalogue, with the cohort named, as the cards page reads them all at once. */
export type CohortCatalogue = Catalogue & { cohort: { id: string; name: string; term: string } };

export async function fetchCourseCards(): Promise<CohortCatalogue[]> {
  return (await request<{ cohorts: CohortCatalogue[] }>(`${BASE}/course-cards`)).cohorts;
}

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

function send<T>(path: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

export async function fetchCohorts(): Promise<Cohort[]> {
  return (await request<{ cohorts: Cohort[] }>(`${BASE}/cohorts`)).cohorts;
}

export type CohortInput = {
  name: string;
  term?: string;
  notes?: string;
  majors?: string[];
  terms?: string[];
  yearLevel?: string;
  workbookTab?: string;
  firstSemester?: number;
};

const COHORT_DEFAULTS = { term: "", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0 };

export function createCohort(input: CohortInput): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts`, "POST", { ...COHORT_DEFAULTS, ...input });
}

export function updateCohort(cohortId: string, input: CohortInput): Promise<Cohort> {
  return send<Cohort>(`${BASE}/cohorts/${cohortId}`, "PATCH", { ...COHORT_DEFAULTS, ...input });
}

/** What counts as a discrepancy between the portal and a cohort. Shared by every coordinator. */
export type DiscrepancyRule = {
  id: string;
  field: string;
  kind: "changed" | "changed_to" | "is" | "is_not" | "differs" | "belongs";
  values: string[];
  /** The cohort the rule is for; empty for every cohort. */
  cohortId: string;
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

export function fetchCatalogue(cohortId: string, termId?: string, withShared = false): Promise<Catalogue> {
  // A cohort's blocks are defined per semester, so asking without one would show both
  // semesters' "TD" at once, meaning different things.
  const query = new URLSearchParams();
  if (termId) query.set("term_id", termId);
  // The sets open to every cohort as well — the department's, not this cohort's.
  if (withShared) query.set("with_shared", "true");
  const asked = query.toString();
  return request<Catalogue>(`${BASE}/cohorts/${cohortId}/catalogue${asked ? `?${asked}` : ""}`);
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

/**
 * Write a whole fill — `group id -> student ids` — in one go, all of it or none of it.
 *
 * The fill was planned in the browser, where the names and programmes it ordered by are
 * held; only ids and group ids travel.
 */
export function placeStudents(scopeId: string, placements: Record<string, string[]>): Promise<PlacementReport> {
  return send<PlacementReport>(`${BASE}/scopes/${scopeId}/placements`, "PUT", { placements });
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
  input: {
    code: string;
    name?: string;
    note?: string;
    termId?: string;
    kind?: ScopeKind;
    parentScopeId?: string;
    openToAll?: boolean;
  },
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
  input: { code: string; name: string; note: string; kind?: ScopeKind; parentScopeId?: string; openToAll?: boolean },
): Promise<void> {
  return send<void>(`${BASE}/scopes/${scopeId}`, "PATCH", input);
}

/**
 * One place up or down the order a cohort's sets are read in.
 *
 * Which is the order Groups & CRNs draws them in, and the order the workbooks write them,
 * because everything downstream takes the catalogue's word for it.
 */
export function moveScope(scopeId: string, by: -1 | 1): Promise<void> {
  return send<void>(`${BASE}/scopes/${scopeId}/move`, "POST", { by });
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
  input: { label: string; capacity?: number; note?: string; program?: string; parentGroupId?: string },
): Promise<{ id: string }> {
  return send<{ id: string }>(`${BASE}/scopes/${scopeId}/groups`, "POST", {
    capacity: 0,
    note: "",
    program: "",
    ...input,
  });
}

export function updateGroup(
  groupId: string,
  input: { label: string; capacity: number; note: string; program: string; parentGroupId?: string },
): Promise<void> {
  return send<void>(`${BASE}/groups/${groupId}`, "PATCH", input);
}

export function deleteGroup(groupId: string): Promise<void> {
  return request<void>(`${BASE}/groups/${groupId}`, { method: "DELETE" });
}

export function updateCourse(
  courseId: string,
  input: { code: string; name: string; component: string; program?: string },
): Promise<void> {
  return send<void>(`${BASE}/courses/${courseId}`, "PATCH", input);
}

/**
 * What the course asks of the timetable, as against what each of its sections asks.
 *
 * Nothing is pushed into the sections: they keep whatever they say, blank included, and
 * the workbook is where a blank is answered by the course's own line.
 */
export function updateCourseRequest(courseId: string, input: Request): Promise<void> {
  return send<void>(`${BASE}/courses/${courseId}/request`, "PATCH", input);
}

/**
 * Everything the workbook says about one PART of a section but its CRN, which setGroupCrn
 * sets. Part 1 unless said otherwise, which is the section itself for all but a handover.
 */
export function updateSection(
  groupId: string,
  courseId: string,
  input: Omit<SectionPart, "crn" | "teacher" | "part"> & { part?: number },
): Promise<void> {
  return send<void>(`${BASE}/groups/${groupId}/courses/${courseId}`, "PATCH", { part: 1, ...input });
}

/** One part of one cell. An empty CRN clears that part, not the whole section. */
export function setGroupCrn(
  groupId: string,
  courseId: string,
  input: { crn: string; teacher?: string; part?: number },
): Promise<void> {
  return send<void>(`${BASE}/groups/${groupId}/courses/${courseId}`, "PUT", { teacher: "", part: 1, ...input });
}

/**
 * A student who is in the group and does not take one of the courses its set teaches.
 *
 * Credit from elsewhere, a course already passed, a waiver. Held on the server and not as
 * a dismissed warning, because a dismissal lives in one browser: this is the department's
 * decision and the next person to open the page has to see it.
 */
export type Exemption = {
  studentId: string;
  courseId: string;
  courseCode: string;
  scopeId: string;
  scopeCode: string;
  termId: string;
  reason: string;
};

export async function fetchExemptions(cohortId: string): Promise<Exemption[]> {
  const answer = await request<{ exemptions: Exemption[] }>(`${BASE}/cohorts/${encodeURIComponent(cohortId)}/exemptions`);
  return answer.exemptions;
}

export function setExemption(studentId: string, courseId: string, reason = ""): Promise<void> {
  return send<void>(`${BASE}/students/${encodeURIComponent(studentId)}/exemptions/${courseId}`, "PUT", { reason });
}

export function clearExemption(studentId: string, courseId: string): Promise<void> {
  return request<void>(`${BASE}/students/${encodeURIComponent(studentId)}/exemptions/${courseId}`, {
    method: "DELETE",
  });
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
  /** `groupId` is what the Meets column joins on: a label cannot find a group's sections. */
  groups: {
    termId: string;
    scopeCode: string;
    groupLabel: string;
    groupId?: string;
    /** A set open to every cohort — the languages — which a move may keep. */
    openToAll?: boolean;
  }[];
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
export async function syncView(viewId: string, studentIds: string[], signal?: AbortSignal): Promise<SyncReport> {
  return send<SyncReport>(`${BASE}/views/${viewId}/sync`, "POST", { studentIds }, signal);
}

/** Put students in a cohort, or take them out of whichever one they are in with null. */
export async function setCohort(
  studentIds: string[],
  cohortId: string | null,
  /** Keep the placements in sets open to every cohort. The languages are not the cohort's. */
  keepShared = false,
): Promise<number> {
  const body = await send<{ moved: number }>(`${BASE}/students/cohort`, "POST", { studentIds, cohortId, keepShared });
  return body.moved;
}

/**
 * A group nobody should be placed into any more.
 *
 * Retirement is recorded on the SECTION, not the group: a group of a set that carries
 * several courses holds one section per course, and retiring one of them says nothing
 * about the group. It is retired only when every section it holds is.
 *
 * The length guard is load-bearing, not defensive. `add_group` writes no sections at all,
 * so a group created a moment ago holds none — and `every()` over an empty list is true,
 * which would quietly hide every brand-new group from the fill and the placement dialog.
 */
export function groupIsRetired(group: Pick<CatalogueGroup, "crns">): boolean {
  // Down to the part: a group whose first half is retired and whose second half still runs
  // is a group that still teaches, and hiding it from the fill would strand its students.
  const parts = Object.values(group.crns ?? {}).flatMap((section) => partsOf(section));
  return parts.length > 0 && parts.every((part) => part.retired);
}
