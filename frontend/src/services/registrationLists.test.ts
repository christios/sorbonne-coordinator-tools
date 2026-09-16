import { describe, expect, it } from "vitest";

import { excusedLine, fromGroups, fromPortal, reconcile, tally } from "@/services/registrationLists";

const PLACEMENTS = [
  {
    scope: { id: "s-cm", code: "CM" },
    group: { label: "Mathematics" },
    crns: [
      { courseId: "c-math100", courseCode: "MATH-100", crn: "22134", courseName: "Mathematics 1" },
      { courseId: "c-phys118", courseCode: "PHYS-118", crn: "22150", courseName: "Geometric Optics" },
      // A section the group has no CRN for is not a CRN they hold.
      { courseId: "c-math113", courseCode: "MATH-113", crn: "" },
    ],
  },
  {
    scope: { id: "s-lang", code: "LANG" },
    group: { label: "A1.5-G1" },
    crns: [{ courseId: "c-scen101", courseCode: "SCEN-101", crn: "23305" }],
  },
];

const REGISTRATIONS = [
  { crn: "22134", courseCode: "MATH-100", title: "Mathematics 1 CM", status: "in_portal" },
  { crn: "23305", courseCode: "SCEN-101", title: "French A1.5", status: "in_portal" },
  { crn: "23421", courseCode: "SCEN-101", title: "French A0", status: "in_portal" },
  // Withdrawn is not a registration.
  { crn: "99999", courseCode: "MATH-999", title: "Gone", status: "not_in_portal" },
];

describe("the two lists", () => {
  it("takes ours from the groups, and skips a section with no CRN", () => {
    expect(fromGroups(PLACEMENTS).map((line) => [line.crn, line.courseCode, line.from])).toEqual([
      ["22134", "MATH-100", "CM Mathematics"],
      ["22150", "PHYS-118", "CM Mathematics"],
      ["23305", "SCEN-101", "LANG A1.5-G1"],
    ]);
  });

  it("takes the portal's from the registrations, and leaves the withdrawn out", () => {
    expect(fromPortal(REGISTRATIONS).map((line) => line.crn)).toEqual(["22134", "23305", "23421"]);
  });

  it("puts them together so the difference is a column, not a comparison", () => {
    const lines = reconcile(PLACEMENTS, REGISTRATIONS);

    expect(lines.map((line) => [line.crn, line.courseCode, line.ours, line.portal])).toEqual([
      ["22134", "MATH-100", true, true],
      ["22150", "PHYS-118", true, false],
      ["23305", "SCEN-101", true, true],
      ["23421", "SCEN-101", false, true],
    ]);
    // A CRN both sides have keeps the registrar's name for it.
    expect(lines.find((line) => line.crn === "22134")?.title).toBe("Mathematics 1 CM");
    // A CRN only we have is still named — by us, since the registrar has nothing to say.
    expect(lines.find((line) => line.crn === "22150")?.title).toBe("Geometric Optics");
    // A placement that never said a name stays blank rather than inventing one.
    expect(lines.find((line) => line.crn === "23305")?.title).toBe("French A1.5");
    // And the group of ours it came from.
    expect(lines.find((line) => line.crn === "22150")?.from).toBe("CM Mathematics");
  });

  it("counts what agrees and what is on one side only", () => {
    expect(tally(reconcile(PLACEMENTS, REGISTRATIONS))).toEqual({ agree: 2, onlyOurs: 1, onlyPortal: 1, exempt: 0 });
    expect(tally(reconcile([], []))).toEqual({ agree: 0, onlyOurs: 0, onlyPortal: 0, exempt: 0 });
  });

  it("keeps the course a CRN of ours came from, and leaves it blank on the registrar's own", () => {
    const lines = reconcile(PLACEMENTS, REGISTRATIONS);

    expect(lines.find((line) => line.crn === "22150")?.courseId).toBe("c-phys118");
    // 23421 is a section only the registrar has; we have no course to name for it.
    expect(lines.find((line) => line.crn === "23421")?.courseId).toBe("");
  });
});

describe("a course the student does not take", () => {
  const EXCUSED = new Set(["c-phys118"]);

  it("is not a fault when the registrar has not registered them for it", () => {
    const optics = reconcile(PLACEMENTS, REGISTRATIONS).find((line) => line.crn === "22150");

    expect(optics && excusedLine(optics, EXCUSED)).toBe(true);
  });

  it("counts apart from the missing, so the number that reads as work is the work", () => {
    /*
     * Geometric Optics used to be counted among "not registered" and drawn in red on a
     * student who had been excused from it, which asks a coordinator to chase a
     * registration that must never be made.
     */
    expect(tally(reconcile(PLACEMENTS, REGISTRATIONS), EXCUSED)).toEqual({
      agree: 2,
      onlyOurs: 0,
      onlyPortal: 1,
      exempt: 1,
    });
  });

  it("says nothing about a CRN the registrar does have them in", () => {
    // An exemption they are registered against anyway is the register check's business —
    // it has a verdict for exactly that — and not this table's.
    const held = reconcile(PLACEMENTS, REGISTRATIONS).find((line) => line.crn === "22134");

    expect(held && excusedLine(held, new Set(["c-math100"]))).toBe(false);
  });

  it("says nothing about a CRN only the registrar has", () => {
    const theirs = reconcile(PLACEMENTS, REGISTRATIONS).find((line) => line.crn === "23421");

    expect(theirs && excusedLine(theirs, new Set([""]))).toBe(false);
  });
});
