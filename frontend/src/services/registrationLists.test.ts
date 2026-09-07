import { describe, expect, it } from "vitest";

import { fromGroups, fromPortal, reconcile, tally } from "@/services/registrationLists";

const PLACEMENTS = [
  {
    scope: { id: "s-cm", code: "CM" },
    group: { label: "Mathematics" },
    crns: [
      { courseCode: "MATH-100", crn: "22134" },
      { courseCode: "PHYS-118", crn: "22150" },
      // A section the group has no CRN for is not a CRN they hold.
      { courseCode: "MATH-113", crn: "" },
    ],
  },
  { scope: { id: "s-lang", code: "LANG" }, group: { label: "A1.5-G1" }, crns: [{ courseCode: "SCEN-101", crn: "23305" }] },
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
    // And the group of ours it came from.
    expect(lines.find((line) => line.crn === "22150")?.from).toBe("CM Mathematics");
  });

  it("counts what agrees and what is on one side only", () => {
    expect(tally(reconcile(PLACEMENTS, REGISTRATIONS))).toEqual({ agree: 2, onlyOurs: 1, onlyPortal: 1 });
    expect(tally(reconcile([], []))).toEqual({ agree: 0, onlyOurs: 0, onlyPortal: 0 });
  });
});
