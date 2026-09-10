import { describe, expect, it } from "vitest";

import type { RegisterCheck } from "@/services/portalLists";
import { warningsByCrn, worstOf, WORDS } from "@/services/registerWarnings";

const EMPTY = {
  gone: [], arrived: [], unregistered: [], teacherDiffers: [], teacherUnnamed: [],
  collides: [], settledCollisions: [], swept: true,
} as unknown as RegisterCheck;

const report = (over: Partial<RegisterCheck>) => ({ ...EMPTY, ...over }) as RegisterCheck;

describe("what is wrong with each CRN", () => {
  it("puts every kind on the CRN it is about", () => {
    const found = warningsByCrn(
      report({
        gone: [{ id: "1", termCode: "262710", crn: "22151", courseCode: "MATH-001", usedBy: 2 }],
        unregistered: [{ crn: "23652", courseCode: "MATH-011" }],
        teacherDiffers: [{ crn: "23223", courseCode: "MATH-001", groupLabel: "1", ours: "Wafaa Ahmed", theirs: "Wafa Ahmed", planning: "named" }],
        collides: [{ ourCrn: "23302", ourCourse: "SCEN-101", weekday: "Tue", startsAt: "16:30", endsAt: "18:00", dates: 14, minutes: 90, theirs: [{ crn: "20581", courseCode: "ENGL-604" }], students: ["A1"] }],
      } as unknown as Partial<RegisterCheck>),
    );

    expect([...found.keys()].sort()).toEqual(["22151", "23223", "23302", "23652"]);
    expect(found.get("22151")?.[0].text).toContain("2 card row(s) use it");
    expect(found.get("23302")?.[0].text).toBe("Tue 16:30–18:00 against ENGL-604");
  });

  it("gathers everything wrong with one CRN onto it, worst first", () => {
    // A section can be several things at once, and the row shows the worst of them first
    // because that is what its colour is taken from.
    const found = warningsByCrn(
      report({
        teacherUnnamed: [{ crn: "22151", courseCode: "MATH-001", groupLabel: "A", ours: "", theirs: "Bilal Maaz", planning: "unplanned" }],
        gone: [{ id: "1", termCode: "262710", crn: "22151", courseCode: "MATH-001", usedBy: 0 }],
      } as unknown as Partial<RegisterCheck>),
    );

    expect(found.get("22151")?.map((warning) => warning.kind)).toEqual(["gone", "teacherUnnamed"]);
    expect(worstOf(found.get("22151") ?? [])).toBe("gone");
  });

  it("leaves the CRNs we have not taken in out of it entirely", () => {
    /*
     * "New in the portal, not registered" is by definition about a CRN with no row in this
     * table. It stays above it, with the button that takes it in.
     */
    const found = warningsByCrn(
      report({ arrived: [{ id: "9", termCode: "262710", crn: "99999", courseCode: "PHYS-303", title: "", teacherName: "" }] } as unknown as Partial<RegisterCheck>),
    );

    expect(found.size).toBe(0);
  });

  it("says nothing at all about a register nobody has checked", () => {
    expect(warningsByCrn(undefined).size).toBe(0);
    expect(worstOf([])).toBe("");
  });

  it("gives every kind a word, because the column is filtered by it", () => {
    // A count cannot be filtered to "which rows have a teacher disagreement".
    for (const kind of ["gone", "unregistered", "teacherDiffers", "teacherUnnamed", "collides"] as const) {
      expect(WORDS[kind]).toBeTruthy();
    }
  });
});
