/**
 * The department's programmes — Settings → Programmes.
 *
 * The programmes are the department's students' (MATH, PHYS), each under the code it means
 * when admissions has recoded it (MATS means MATH). Each has an official name the
 * department may write, and the course codes that count as it, by prefix — MATH's are MATH
 * and CPSC — and a course whose code says nothing useful can be put in one by hand, or in
 * none. Every page that narrows its courses to a programme reads it from here, so they all
 * agree; an administrator changes it.
 */

import { apiFetch } from "@/services/http";
import type { GridColumn } from "@/services/studentColumns";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/course-programs`;

export type CourseProgramme = {
  code: string;
  /** What the filters call it, short: the registrar's name, else the official one, else the code. */
  name: string;
  /** "Bachelor of Science in Mathematics", as the department writes it; "" until it does. */
  officialName: string;
  /** "Mathematics", from "MATH - Mathematics" on the students' records. */
  registrarName: string;
  /** Other codes the same students are written under: MATS, after a recode. */
  aliases: string[];
  prefixes: string[];
};
/** Said for a course that belongs to no programme, whatever its code. */
export const NO_PROGRAMME = "NONE";
export type CoursePrograms = {
  programmes: CourseProgramme[];
  /** Course code → a programme's code, or NONE, for the courses put somewhere by hand. */
  courses: Record<string, string>;
};
export const NO_COURSE_PROGRAMS: CoursePrograms = { programmes: [], courses: {} };

async function answer(response: Response): Promise<CoursePrograms> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return (await response.json()) as CoursePrograms;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchCoursePrograms(): Promise<CoursePrograms> {
  return answer(await apiFetch(BASE));
}

/** The course codes that count as a programme, by how they start. */
export async function setProgrammePrefixes(programme: string, prefixes: string[]): Promise<CoursePrograms> {
  return answer(await apiFetch(`${BASE}/programmes/${encodeURIComponent(programme)}`, json("PUT", { prefixes })));
}

/** The programme's official name; "" for none, when pages go back to the registrar's. */
export async function setOfficialName(programme: string, officialName: string): Promise<CoursePrograms> {
  return answer(await apiFetch(`${BASE}/programmes/${encodeURIComponent(programme)}/name`, json("PUT", { officialName })));
}

/** Put a course in a programme — its code, or NONE — or, with "", back to what its code says. */
export async function putCourseProgramme(courseCode: string, programme: string): Promise<CoursePrograms> {
  const at = `${BASE}/courses/${encodeURIComponent(courseCode)}`;
  return answer(await apiFetch(at, programme ? json("PUT", { programme }) : { method: "DELETE" }));
}

/** "MATH-100" → "MATH": the letters a course code starts with, which is what a programme lists. */
export function codePrefix(code: string): string {
  return (code.trim().match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
}

/**
 * Which programme a course's code says it belongs to: the one listing the longest prefix
 * the code starts with — "" when none does, as in a department with no programme yet.
 */
export function programmeFromCode(code: string, setup: CoursePrograms = NO_COURSE_PROGRAMS): string {
  const said = code.trim().toUpperCase();
  let found = "";
  let longest = 0;
  for (const programme of setup.programmes) {
    for (const prefix of programme.prefixes) {
      if (prefix.length > longest && said.startsWith(prefix)) {
        found = programme.code;
        longest = prefix.length;
      }
    }
  }
  return found;
}

/**
 * A course's programme: where the department has put it by hand, or where its code says.
 * "" for none. By the course, never by the students in it: a physicist in Mathematics 1 is
 * in a MATH course.
 */
export function programmeOf(code: string, setup: CoursePrograms = NO_COURSE_PROGRAMS): string {
  const said = setup.courses[code.trim().toUpperCase()];
  if (said === NO_PROGRAMME) return "";
  if (said && setup.programmes.some((programme) => programme.code === said)) return said;
  return programmeFromCode(code, setup);
}

/** "Mathematics" for MATH; "No programme" for none. */
export function programmeName(code: string, setup: CoursePrograms = NO_COURSE_PROGRAMS): string {
  if (!code) return "No programme";
  return setup.programmes.find((programme) => programme.code === code)?.name ?? code;
}

/**
 * A page's filter columns with a Program column added — after `after`, or last — when the
 * department has programmes; the columns as they were when it has none, so a page never
 * offers a filter with nothing in it. The programme is the row's course's, by its code.
 */
export function withProgrammeColumn<TRow>(
  columns: GridColumn<TRow>[],
  setup: CoursePrograms,
  codeOf: (row: TRow) => string,
  after = "",
): GridColumn<TRow>[] {
  if (!setup.programmes.length) return columns;
  const programme: GridColumn<TRow> = {
    id: "programme",
    displayName: "Program",
    type: "option",
    accessor: (row) => programmeName(programmeOf(codeOf(row), setup), setup),
    defaultWidth: 130,
  };
  const at = columns.findIndex((column) => column.id === after);
  return at < 0 ? [...columns, programme] : [...columns.slice(0, at + 1), programme, ...columns.slice(at + 1)];
}
