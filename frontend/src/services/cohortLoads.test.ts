import { describe, expect, it } from "vitest";

import { cohortLoads, departmentSplit, shareOf, staffStatusOf, statusFromPortal } from "@/services/cohortLoads";
import { buildCards } from "@/services/courseCards";
import type { ActiveCourse, ActiveTeacher } from "@/services/portalLists";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";

const teacher = (id: string, fullName: string, type: string, staffStatus = ""): ActiveTeacher =>
  ({ id, fullName, type, staffStatus, source: "portal" }) as ActiveTeacher;

const TEACHERS = [
  teacher("act-1", "Bilal Maaz", "Full Time"),
  teacher("act-2", "Samar Ghantous", "Local-Professional Assignment"),
  teacher("act-3", "Simone Rinaldi", "VP Visiting Professor"),
  // The portal says full time; the department knows better.
  teacher("act-4", "Louis Malterre", "Full Time", "PHD"),
];

const course = (id: string, code: string, component: string, hours: string) => ({
  id,
  code,
  name: code === "MATH-001" ? "Pre-calculus" : "Elements of calculus",
  component,
  request: { ...EMPTY_REQUEST, hours },
});
const group = (id: string, label: string, crns: Record<string, object>, assigned = 0) => ({
  id,
  label,
  capacity: 30,
  note: "",
  parentGroupId: "",
  assigned,
  crns: Object.fromEntries(Object.entries(crns).map(([courseId, section]) => [courseId, { ...EMPTY_SECTION, ...section }])),
});
const set = (id: string, code: string, termId: string, courses: object[], groups: object[]) => ({
  id,
  code,
  name: code,
  note: "",
  termId,
  kind: "shared" as const,
  parentScopeId: "",
  openToAll: false,
  courses,
  groups,
});

/** Foundation Year over two semesters: a lecture, three tutorials, one retired, one nobody's. */
const CATALOGUES = [
  {
    cohort: { id: "fy", name: "Foundation Year", term: "2026-27" },
    scopes: [
      set("cm", "CM", "s1", [course("cm-pre", "MATH-001", "CM", "50")], [group("cm-1", "1", { "cm-pre": { crn: "22151", teacherId: "act-1" } }, 120)]),
      set("td", "TD", "s1", [course("td-pre", "MATH-001", "TD", "50")], [
        group("td-1", "1", { "td-pre": { crn: "23223", teacherId: "act-2", exempt: 2 } }, 30),
        group("td-2", "2", { "td-pre": { crn: "23224" } }, 30),
        group("td-3", "3", { "td-pre": { crn: "23425", teacherId: "act-4", retired: true } }, 30),
        group("td-4", "4", { "td-pre": { crn: "23562", teacherId: "act-4", hours: "20" } }, 30),
      ]),
      set("cm2", "CM", "s2", [course("cm-ele", "MATH-002", "CM", "40")], [group("cm2-1", "1", { "cm-ele": { crn: "24100", teacherId: "act-3" } }, 120)]),
    ],
  },
] as unknown as CohortCatalogue[];

const COURSES = [{ id: "a1", courseCode: "MATH-001", coefficient: "15" } as ActiveCourse];

const cards = () => buildCards(CATALOGUES, (id) => (id === "s1" ? "Semester 1" : "Semester 2"), COURSES);

describe("a cohort's hours, as the teaching-load sheet has them", () => {
  it("lists every course of the year, its sections and who teaches each", () => {
    const [fy] = cohortLoads(cards(), ["s1", "s2"], TEACHERS);

    expect(fy.cohortName).toBe("Foundation Year");
    expect(fy.semesters.map((semester) => semester.termId)).toEqual(["s1", "s2"]);
    const [precalculus] = fy.semesters[0].courses;
    expect(precalculus.coefficient).toBe("15");
    // The retired tutorial is not taught, so it is not counted.
    expect(precalculus.sections.map((section) => [section.label, section.crn, section.teacher, section.kind, section.hours])).toEqual([
      ["CM 1", "22151", "Bilal Maaz", "CM", 50],
      ["TD 1", "23223", "Samar Ghantous", "TD", 50],
      ["TD 2", "23224", "", "TD", 50],
      // Its own hours, over the course's.
      ["TD 4", "23562", "Louis Malterre", "TD", 20],
    ]);
    // Placed, less those exempt from the course.
    expect(precalculus.sections[1].students).toBe(28);
  });

  it("splits the hours by status, semester by semester and for the year", () => {
    const [fy] = cohortLoads(cards(), ["s1", "s2"], TEACHERS);

    expect(fy.split.s1).toEqual({ FT: 50, PHD: 20, VP: 0, PT: 50, UNSET: 0, NOBODY: 50 });
    expect(fy.split.s2).toEqual({ FT: 0, PHD: 0, VP: 40, PT: 0, UNSET: 0, NOBODY: 0 });
    expect(fy.split.year).toEqual({ FT: 50, PHD: 20, VP: 40, PT: 50, UNSET: 0, NOBODY: 50 });
    expect(fy.kinds).toEqual({ CM: 90, TD: 120, TP: 0, OTHER: 0 });
    expect(fy.teachers.map((row) => [row.teacher, row.status, row.hours])).toEqual([
      ["Bilal Maaz", "FT", 50],
      ["Samar Ghantous", "PT", 50],
      ["Simone Rinaldi", "VP", 40],
      ["Louis Malterre", "PHD", 20],
    ]);
    expect(departmentSplit([fy], ["s1", "s2"]).year).toEqual(fy.split.year);
    expect(shareOf(50, 210)).toBe("24%");
  });

  it("follows the semesters it is given: one semester alone is that semester's", () => {
    const [fy] = cohortLoads(cards(), ["s2"], TEACHERS);

    expect(fy.semesters.map((semester) => semester.termId)).toEqual(["s2"]);
    expect(fy.split.year.VP).toBe(40);
    expect(fy.split.year.FT).toBe(0);
  });
});

describe("a teacher's status for the budget", () => {
  it("is the department's word where it has given one, the portal's type where not", () => {
    expect(staffStatusOf(TEACHERS[3])).toBe("PHD");
    expect(staffStatusOf(TEACHERS[0])).toBe("FT");
    expect(statusFromPortal("Part-Time")).toBe("PT");
    // Paid by the hour, as a part-timer is.
    expect(statusFromPortal("Local-Professional Assignment")).toBe("PT");
    // Sent from Paris, as a visiting professor is.
    expect(statusFromPortal("Flying-Professional Assignment")).toBe("VP");
    // Known only to the part-time database.
    expect(statusFromPortal("", "part-time")).toBe("PT");
    expect(statusFromPortal("")).toBe("");
    expect(staffStatusOf(null)).toBe("");
  });
});
