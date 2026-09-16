import { describe, expect, it } from "vitest";

import { teachersOfGroup, teachersSaid } from "@/services/groupTeachers";
import {
  EMPTY_REQUEST,
  EMPTY_SECTION,
  type CatalogueGroup,
  type CatalogueScope,
} from "@/services/studentDatabase";

const course = (id: string, code: string) => ({ id, code, name: code, component: "", request: EMPTY_REQUEST });

const set = (courses: ReturnType<typeof course>[], groups: CatalogueGroup[]): CatalogueScope => ({
  id: "td",
  code: "TD",
  name: "Tutorials",
  note: "",
  kind: "shared",
  parentScopeId: "",
  openToAll: false,
  courses,
  groups,
});

const group = (crns: CatalogueGroup["crns"], extra: Partial<CatalogueGroup> = {}): CatalogueGroup => ({
  id: "g1",
  label: "1",
  capacity: 0,
  note: "",
  parentGroupId: "",
  assigned: 0,
  crns,
  ...extra,
});

describe("who teaches a group", () => {
  it("names one teacher per course of the set, in reading order", () => {
    const held = group({
      maths: { ...EMPTY_SECTION, crn: "1", teacher: "Dr Maaz" },
      physics: { ...EMPTY_SECTION, crn: "2", teacher: "Dr Kaur" },
    });

    expect(teachersOfGroup(set([course("maths", "MATH-001"), course("physics", "PHYS-118")], [held]), held, "")).toEqual([
      "Dr Maaz",
      "Dr Kaur",
    ]);
  });

  it("says a teacher once, however many of the set's courses they take", () => {
    const held = group({
      maths: { ...EMPTY_SECTION, crn: "1", teacher: "Dr Maaz" },
      physics: { ...EMPTY_SECTION, crn: "2", teacher: "Dr Maaz" },
    });

    expect(teachersOfGroup(set([course("maths", "MATH-001"), course("physics", "PHYS-118")], [held]), held, "")).toEqual([
      "Dr Maaz",
    ]);
  });

  it("prefers the department's record to whatever the registrar typed", () => {
    // The two disagree constantly: a section carries a written name until somebody joins
    // it to the department's list, and after that the list is the one that is kept right.
    const held = group({ maths: { ...EMPTY_SECTION, crn: "1", teacher: "A. Trabelsi", teacherId: "act-1" } });

    expect(
      teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "", (id) =>
        id === "act-1" ? "Ahlem Trabelsi" : "",
      ),
    ).toEqual(["Ahlem Trabelsi"]);
  });

  it("names both halves of a course handed over at mid-semester", () => {
    const held = group({
      maths: {
        ...EMPTY_SECTION,
        parts: [
          { ...EMPTY_SECTION, crn: "1", teacher: "Dr Maaz" },
          { ...EMPTY_SECTION, crn: "2", teacher: "Dr Kaur" },
        ],
      },
    });

    expect(teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "")).toEqual(["Dr Maaz", "Dr Kaur"]);
  });

  it("reads the sub-row's own sections when the student sits on one", () => {
    // A group with sub-rows can teach one major's students in a different section from
    // another's, so whose teacher it is depends on which sub-row they are placed on.
    const held = group(
      { maths: { ...EMPTY_SECTION, crn: "1", teacher: "Shared lecturer" } },
      { byMajor: { "m-phys": { maths: { ...EMPTY_SECTION, crn: "9", teacher: "Dr Kaur" } } } },
    );

    expect(teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "m-phys")).toEqual(["Dr Kaur"]);
    expect(teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "")).toEqual(["Shared lecturer"]);
  });

  it("says so plainly when nobody is down to teach it", () => {
    const held = group({ maths: { ...EMPTY_SECTION, crn: "1" } });

    expect(teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "")).toEqual([]);
    expect(teachersSaid([])).toBe("no teacher yet");
  });

  it("reads a course the sub-row is not taught as no teacher at all", () => {
    const held = group(
      { maths: { ...EMPTY_SECTION, crn: "1", teacher: "Dr Maaz" } },
      { byMajor: { "m-phys": { maths: { ...EMPTY_SECTION, notTaught: true } } } },
    );

    expect(teachersOfGroup(set([course("maths", "MATH-001")], [held]), held, "m-phys")).toEqual([]);
  });
});
