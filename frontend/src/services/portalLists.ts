/**
 * The portal's courses, teachers and a student's registrations, as this application keeps them.
 *
 * Three lists behind three other pages of the registrar portal, pulled the way students
 * are — a saved filter, the extension, a sync — and kept on the server the way each
 * deserves: a course and a teacher whole, minus anything personal; a registration as a
 * student id against a CRN. The mappers at the bottom are where a portal row becomes
 * exactly that and nothing more, so a name in a registrations pull ends here.
 */

import { apiFetch } from "@/services/http";
import type { RosterRow } from "@/services/scenRosters";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/portal`;

export type ListKind = "courses" | "teachers" | "registrations";

export type PortalFilter = {
  id: string;
  kind: ListKind;
  name: string;
  filter: Record<string, string[]>;
  /** How many the filter still returns, and how many it has stopped returning. */
  held: number;
  gone: number;
  lastSyncedAt: string;
  createdAt: string;
  updatedBy: string;
};

export type PortalCourse = {
  termCode: string;
  crn: string;
  courseCode: string;
  title: string;
  subject: string;
  sequence: string;
  partOfTerm: string;
  partOfTermDesc: string;
  credits: string;
  department: string;
  level: string;
  college: string;
  contactHours: string;
  teacherName: string;
  registered: number;
  begins: string;
  ends: string;
  status: "in_portal" | "not_in_portal";
  firstSeenAt: string;
  lastSeenAt: string;
};

export type PortalTeacher = {
  teacherId: string;
  fullName: string;
  teacherStatus: string;
  category: string;
  type: string;
  lastTerm: string;
  credits: string;
  coursesCount: string;
  periodsCount: string;
  studentsCount: string;
  department: string;
  rank: string;
  courses: string;
  institution: string;
  psuadEmail: string;
  status: "in_portal" | "not_in_portal";
  firstSeenAt: string;
  lastSeenAt: string;
};

export type Registration = {
  termCode: string;
  crn: string;
  courseCode: string;
  title: string;
  teacherName: string;
  status: "in_portal" | "not_in_portal";
  lastSeenAt: string;
};

/** One way a student's registration differs from the group we placed them in. */
export type Mismatch = {
  studentId: string;
  termId: string;
  termCode: string;
  courseCode: string;
  kind: "missing" | "wrong" | "extra" | "unplaced";
  expected: string;
  registered: string[];
};

export type SyncReport = { seen: number; added: number; missing: number; syncedAt: string; rows?: number };

export type TermCheck = {
  portalTermCode: string;
  linked: boolean;
  portalCourses: number;
  hubOnly: { crn: string; code: string; staff: string }[];
  teacherDiffers: { crn: string; code: string; hub: string; portal: string }[];
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.trim()) return body.detail;
  } catch {
    // fall through
  }
  return "That could not be completed. Try again in a moment.";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${BASE}${path}`, init);
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function send<T>(path: string, method: string, body: unknown): Promise<T> {
  return request<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

// ------------------------------------------------------------------ filters

export async function fetchPortalFilters(kind: ListKind): Promise<PortalFilter[]> {
  return (await request<{ filters: PortalFilter[] }>(`/filters?kind=${kind}`)).filters;
}

export function createPortalFilter(input: { kind: ListKind; name: string; filter: Record<string, string[]> }): Promise<PortalFilter> {
  return send<PortalFilter>("/filters", "POST", input);
}

export function deletePortalFilter(filterId: string): Promise<void> {
  return request<void>(`/filters/${filterId}`, { method: "DELETE" });
}

export function syncCourses(filterId: string, rows: CourseRow[]): Promise<SyncReport> {
  return send<SyncReport>(`/filters/${filterId}/sync/courses`, "POST", { rows });
}

export function syncTeachers(filterId: string, rows: TeacherRow[]): Promise<SyncReport> {
  return send<SyncReport>(`/filters/${filterId}/sync/teachers`, "POST", { rows });
}

export function syncRegistrations(filterId: string, termCode: string, rows: RegistrationRow[]): Promise<SyncReport> {
  return send<SyncReport>(`/filters/${filterId}/sync/registrations`, "POST", { termCode, rows });
}

// ------------------------------------------------------------------ reading

export async function fetchPortalCourses(term = "", filter = ""): Promise<{ terms: string[]; courses: PortalCourse[] }> {
  const query = new URLSearchParams();
  if (term) query.set("term", term);
  if (filter) query.set("filter", filter);
  const suffix = query.toString();
  return request(`/courses${suffix ? `?${suffix}` : ""}`);
}

export async function fetchPortalTeachers(filter = ""): Promise<PortalTeacher[]> {
  return (await request<{ teachers: PortalTeacher[] }>(`/teachers${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`)).teachers;
}

/**
 * One of the department's active teachers: chosen from the portal, brought from the
 * part-time database, or both when the two turned out to be one person.
 */
export type ActiveTeacher = {
  id: string;
  portalTeacherId: string;
  partTimeTeacherId: string;
  fullName: string;
  email: string;
  source: "portal" | "part-time" | "both";
  addedAt: string;
  addedBy: string;
  teacherStatus: string;
  category: string;
  type: string;
  lastTerm: string;
  department: string;
  rank: string;
  courses: string;
  institution: string;
  portalStatus: string;
};

export async function fetchActiveTeachers(): Promise<ActiveTeacher[]> {
  return (await request<{ teachers: ActiveTeacher[] }>("/active-teachers")).teachers;
}

export function addActiveTeachers(input: {
  portalTeacherIds?: string[];
  partTime?: { id: string; fullName: string; email: string }[];
}): Promise<{ added: number; linked: number; skipped: number }> {
  return send("/active-teachers", "POST", { portalTeacherIds: [], partTime: [], ...input });
}

export function removeActiveTeacher(activeId: string): Promise<void> {
  return request<void>(`/active-teachers/${encodeURIComponent(activeId)}`, { method: "DELETE" });
}

/**
 * One of the department's active courses: chosen from the portal's list or added by
 * hand, and carrying what the timetabler's workbook needs to know about the course
 * itself — its Sorbonne UE and the parent CRN its sections hang from.
 */
export type ActiveCourse = {
  id: string;
  courseCode: string;
  title: string;
  ue: string;
  addedAt: string;
  addedBy: string;
  /** How many of its CRNs the register holds, and how many the portal lists. */
  crnCount: number;
  portalCrnCount: number;
  termCount: number;
  lastTerm: string;
  /**
   * The CRN of the portal's own row for this course — the one with the plain title, no
   * teacher and nobody registered — which the register offers as each section's parent.
   * Empty when the portal has no such row, or more than one.
   */
  portalParentCrn: string;
};

/**
 * One CRN of the department's register: ours, linked to the portal's entry for it, and
 * to the portal's entry for the parent it hangs from.
 */
export type ActiveCrn = {
  id: string;
  termCode: string;
  crn: string;
  courseCode: string;
  /** The CRN this section hangs from, as an entry of the portal's own list. */
  parentCrn: string;
  /** What the course says, the same on every CRN of it. */
  courseTitle: string;
  ue: string;
  /** What the portal says about this CRN; blank when it lists it no longer. */
  portalTitle: string;
  teacherName: string;
  registered: number;
  portalStatus: "in_portal" | "not_in_portal" | "not_listed";
  sequence: string;
  partOfTerm: string;
  credits: string;
  contactHours: string;
  /** The parent as the portal knows it, so a link leading nowhere shows as one. */
  parentTitle: string;
  parentStatus: "" | "in_portal" | "not_in_portal" | "not_listed";
  parentCourseCode: string;
  /** How many of the register's CRNs hang from this one, which is what makes it a parent. */
  childCount: number;
  /** How many sections of a course card teach under this CRN. */
  usedBy: number;
  addedAt: string;
  addedBy: string;
};

/** Where the registrar's list and the department's register have moved apart. */
export type RegisterCheck = {
  /** Ours, that the portal has stopped listing. */
  gone: { id: string; termCode: string; crn: string; courseCode: string; usedBy: number }[];
  /** The portal's, for a course of ours, that nobody has taken in. */
  arrived: { termCode: string; crn: string; courseCode: string; title: string; teacherName: string; registered: number }[];
  /** Taught on a course card under a CRN the register does not hold. */
  unregistered: { crn: string; courseCode: string }[];
};

export async function fetchActiveCrns(term = ""): Promise<ActiveCrn[]> {
  return (await request<{ crns: ActiveCrn[] }>(`/active-crns${term ? `?term=${encodeURIComponent(term)}` : ""}`)).crns;
}

export function addActiveCrns(input: {
  courseCodes?: string[];
  crns?: { termCode: string; crn: string; courseCode?: string }[];
}): Promise<{ added: number; skipped: number }> {
  return send("/active-crns", "POST", { courseCodes: [], crns: [], ...input });
}

export function setParentCrn(crnId: string, parentCrn: string): Promise<ActiveCrn> {
  return send(`/active-crns/${encodeURIComponent(crnId)}`, "PATCH", { parentCrn });
}

export function removeActiveCrn(crnId: string): Promise<void> {
  return request<void>(`/active-crns/${encodeURIComponent(crnId)}`, { method: "DELETE" });
}

export function fetchRegisterCheck(term = ""): Promise<RegisterCheck> {
  return request<RegisterCheck>(`/register-check${term ? `?term=${encodeURIComponent(term)}` : ""}`);
}

export async function fetchActiveCourses(): Promise<ActiveCourse[]> {
  return (await request<{ courses: ActiveCourse[] }>("/active-courses")).courses;
}

export function addActiveCourses(input: {
  courseCodes?: string[];
  byHand?: { courseCode: string; title: string }[];
}): Promise<{ added: number; skipped: number }> {
  return send("/active-courses", "POST", { courseCodes: [], byHand: [], ...input });
}

export function updateActiveCourse(activeId: string, input: { title: string; ue: string }): Promise<ActiveCourse> {
  return send(`/active-courses/${encodeURIComponent(activeId)}`, "PATCH", input);
}

export function removeActiveCourse(activeId: string): Promise<void> {
  return request<void>(`/active-courses/${encodeURIComponent(activeId)}`, { method: "DELETE" });
}

export async function fetchRegistrations(studentId: string): Promise<Registration[]> {
  return (await request<{ registrations: Registration[] }>(`/students/${encodeURIComponent(studentId)}/registrations`)).registrations;
}

export async function fetchTermLinks(): Promise<Record<string, string>> {
  return (await request<{ links: Record<string, string> }>("/term-links")).links;
}

export function linkTerm(termId: string, portalTermCode: string): Promise<{ termId: string; portalTermCode: string }> {
  return send(`/term-links/${encodeURIComponent(termId)}`, "PUT", { portalTermCode });
}

export type TermCrns = {
  portalTermCode: string;
  crns: Record<string, { courseCode: string; title: string; teacherName: string; status: string }>;
};

export function fetchTermCrns(termId: string): Promise<TermCrns> {
  return request<TermCrns>(`/terms/${encodeURIComponent(termId)}/crns`);
}

export function fetchTermCheck(termId: string): Promise<TermCheck> {
  return request<TermCheck>(`/terms/${encodeURIComponent(termId)}/check`);
}

export async function fetchRegistrationCheck(cohortId: string): Promise<Mismatch[]> {
  return (await request<{ mismatches: Mismatch[] }>(`/cohorts/${encodeURIComponent(cohortId)}/registration-check`)).mismatches;
}

// ---------------------------------------------- the part-time teacher database

export type PartTimeTeacher = { id: string; fullName: string; email: string };

export async function fetchPartTimeTeachers(): Promise<PartTimeTeacher[]> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/teachers`);
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { items?: PartTimeTeacher[]; teachers?: PartTimeTeacher[] };
  return body.items ?? body.teachers ?? [];
}


// ---------------------------------------------------------- the mappers

export type CourseRow = {
  termCode: string;
  crn: string;
  courseCode: string;
  title: string;
  subject: string;
  sequence: string;
  partOfTerm: string;
  partOfTermDesc: string;
  credits: string;
  department: string;
  level: string;
  college: string;
  contactHours: string;
  teacherName: string;
  registered: number;
  begins: string;
  ends: string;
};

export type TeacherRow = {
  teacherId: string;
  fullName: string;
  status: string;
  category: string;
  type: string;
  lastTerm: string;
  credits: string;
  coursesCount: string;
  periodsCount: string;
  studentsCount: string;
  department: string;
  rank: string;
  courses: string;
  institution: string;
  psuadEmail: string;
};

/** What the server is told about a registration: no name, no absence, nothing else. */
export type RegistrationRow = { studentId: string; crn: string; courseCode: string };

const text = (row: RosterRow, field: string) => String(row[field] ?? "").trim();

export function courseRowOf(row: RosterRow): CourseRow {
  return {
    termCode: text(row, "TERM_CODE"),
    crn: text(row, "COURSE_CRN"),
    courseCode: text(row, "COURSE_CODE"),
    title: text(row, "COURSE_TITLE"),
    subject: text(row, "COURSE_SUBJ"),
    sequence: text(row, "SEQ_NUMB"),
    partOfTerm: text(row, "PTERM_CODE"),
    partOfTermDesc: text(row, "PTERM_DESC"),
    credits: text(row, "CREDIT_HRS_NUM"),
    department: text(row, "DEPT_CODE"),
    level: text(row, "LEVEL_CODE"),
    college: text(row, "COLLEGE_CODE"),
    contactHours: text(row, "CONTACT_HRS_NUM"),
    teacherName: text(row, "TEACHER_NAME"),
    registered: Number(row.NUM_REG_STUD ?? 0) || 0,
    begins: text(row, "BEGIN_DATE"),
    ends: text(row, "END_DATE"),
  };
}

export function teacherRowOf(row: RosterRow): TeacherRow {
  return {
    teacherId: text(row, "SPRIDEN_ID").toUpperCase(),
    fullName: text(row, "FULL_NAME"),
    status: text(row, "TEACHER_STATUS"),
    category: text(row, "TEACHER_CAT_DESC"),
    type: text(row, "TEACHER_TYPE_DESC"),
    lastTerm: text(row, "LAST_TERM_CODE"),
    credits: text(row, "TOTAL_CREDITS"),
    coursesCount: text(row, "TEACHING_COURSES_COUNT"),
    periodsCount: text(row, "TEACHING_PERIODS_COUNT"),
    studentsCount: text(row, "TEACHING_STUDENT_COUNT"),
    department: text(row, "TEACHING_DEPT"),
    rank: text(row, "TEACHER_RANK"),
    courses: text(row, "TEACHING_COURSES"),
    institution: text(row, "ACADEMIC_INSTITUTION"),
    psuadEmail: text(row, "PSUAD_EMAIL"),
  };
}

export function registrationRowOf(row: RosterRow): RegistrationRow {
  return {
    studentId: text(row, "SPRIDEN_ID").toUpperCase(),
    crn: text(row, "COURSE_CRN"),
    courseCode: text(row, "COURSE_CODE"),
  };
}

/** The portal term a registrations pull was about: the extension's word, else the rows'. */
export function termCodeOf(term: { code: string } | null | undefined, rows: RosterRow[]): string {
  return term?.code || (rows.length ? text(rows[0], "TERM_CODE") : "");
}

/** What a pull's warning means, in words a coordinator can act on. */
export function describePullWarning(warning: string | null, count: number, expected: number | null): string {
  switch (warning) {
    case "zero_rows":
      return "The portal answered with nobody at all. A filter code it does not recognise returns an empty list rather than an error, so check the codes.";
    case "short_answer":
      return `The portal said there were more than the ${count.toLocaleString()} it sent. This pull is incomplete — sync it again before trusting it.`;
    case "truncated":
      return `More rows than this tool will hold; the first ${count.toLocaleString()} were kept. Narrow the filter.`;
    case "count_drift":
      return `${count.toLocaleString()} rows, where about ${expected?.toLocaleString() ?? "another number"} was expected. Worth a look before it is relied on.`;
    default:
      return "";
  }
}

/** "registered in 23224, group says 23223" — one mismatch as a sentence. */
export function describeMismatch(mismatch: Mismatch): string {
  switch (mismatch.kind) {
    case "missing":
      return `${mismatch.courseCode}: not registered, group says ${mismatch.expected}`;
    case "wrong":
      return `${mismatch.courseCode}: registered in ${mismatch.registered.join(", ")}, group says ${mismatch.expected}`;
    case "extra":
      return `${mismatch.courseCode}: registered in ${mismatch.registered.join(" and ")}, group says only ${mismatch.expected}`;
    case "unplaced":
      return `${mismatch.courseCode}: registered in ${mismatch.registered.join(", ")}, but in no group of ours`;
  }
}
