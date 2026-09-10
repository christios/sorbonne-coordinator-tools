import { describe, expect, it } from "vitest";

import { registrationFamilies } from "@/services/portalLists";

const reg = (crn: string, courseCode: string, title = "") => ({ crn, courseCode, title });

// The register: the tutorials hang from the lecture the course is built around.
const PARENTS: Record<string, string> = { "23223": "22151", "23224": "22151", "23653": "23652" };
const parentOf = (crn: string) => PARENTS[crn] ?? "";

describe("a student's registrations, as the register shapes them", () => {
  it("puts the sections under the row they hang from", () => {
    const families = registrationFamilies(
      [reg("23223", "MATH-001", "Pre-Calculus 1 G.1-TD"), reg("22151", "MATH-001", "Pre-Calculus 1")],
      parentOf,
    );

    expect(families).toHaveLength(1);
    expect(families[0].parent?.crn).toBe("22151");
    expect(families[0].children.map((row) => row.crn)).toEqual(["23223"]);
    expect(families[0].title).toBe("Pre-Calculus 1");
  });

  it("still shows a section whose parent the student is not registered in", () => {
    const [family] = registrationFamilies([reg("23653", "MATH-011", "Algorithms G.1-TD")], parentOf);

    // Nothing to nest under: the section stands on its own rather than disappearing.
    expect(family.parent).toBeNull();
    expect(family.children.map((row) => row.crn)).toEqual(["23653"]);
  });

  it("folds each course's warnings in with it, and keeps one for a course nowhere else", () => {
    const families = registrationFamilies(
      [reg("22151", "MATH-001"), reg("23223", "MATH-001")],
      parentOf,
      [{ courseCode: "MATH-001", kind: "extra" }, { courseCode: "PHYS-105", kind: "missing" }],
    );

    expect(families.map((family) => family.courseCode)).toEqual(["MATH-001", "PHYS-105"]);
    expect(families[0].warnings.map((warning) => warning.kind)).toEqual(["extra"]);
    // A course they are registered in nowhere is still worth a line of its own.
    const physics = families[1];
    expect([physics.parent, physics.children.length]).toEqual([null, 0]);
    expect(physics.warnings.map((warning) => warning.kind)).toEqual(["missing"]);
  });

  it("leaves a course the register has never heard of standing on its own", () => {
    const [family] = registrationFamilies([reg("29999", "SCEN-999", "Something new")], () => "");

    expect([family.parent, family.children.length, family.warnings.length]).toEqual([null, 1, 0]);
  });
});
