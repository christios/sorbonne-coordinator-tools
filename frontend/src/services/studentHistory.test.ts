import { describe, expect, it } from "vitest";

import { type HistoryLine, allows, describeHistory } from "./studentDatabase";

const line = (kind: HistoryLine["kind"], detail: HistoryLine["detail"]): HistoryLine => ({
  id: "1",
  kind,
  detail,
  author: "",
  authorName: "",
  at: "2026-09-13T10:00:00+00:00",
});

describe("describeHistory", () => {
  it("reads a cohort move as where they came from and where they went", () => {
    expect(describeHistory(line("cohort", { from: "", to: "L1-S1" }))).toBe("Added to L1-S1");
    expect(describeHistory(line("cohort", { from: "FYS", to: "L1-S1" }))).toBe("Moved from FYS to L1-S1");
    expect(describeHistory(line("cohort", { from: "FYS", to: "" }))).toBe("Left FYS");
  });

  it("names the set and the group, and the sub-row where the group has them", () => {
    expect(describeHistory(line("placed", { scopeCode: "CM", from: "", to: "1", program: "Mathematics" }))).toBe(
      "CM: placed in 1 (Mathematics)",
    );
    expect(describeHistory(line("placed", { scopeCode: "TD", from: "2", to: "3" }))).toBe("TD: moved from 2 to 3");
    expect(describeHistory(line("removed", { scopeCode: "TD", from: "2", to: "" }))).toBe("TD: taken out of 2");
  });

  it("reads the registrar's changes and the coordinator's approvals", () => {
    expect(describeHistory(line("registered", { crn: "22595", courseCode: "SPAN-601" }))).toBe("Registered in SPAN-601 (22595)");
    expect(describeHistory(line("dropped", { crn: "22595", courseCode: "" }))).toBe("No longer registered in a course (22595)");
    expect(describeHistory(line("approved", { courseCode: "SPAN-601" }))).toBe("SPAN-601 approved outside the groups");
    expect(describeHistory(line("unapproved", { courseCode: "SPAN-601" }))).toBe("Approval of SPAN-601 withdrawn");
  });
});

describe("allows", () => {
  it("covers a course by its whole code or by its subject, the way the register reads the list", () => {
    expect(allows(["SPRT", "ENGL-101"], "sprt-628")).toBe(true);
    expect(allows(["SPRT", "ENGL-101"], "ENGL-101")).toBe(true);
    expect(allows(["SPRT", "ENGL-101"], "ENGL-102")).toBe(false);
    expect(allows(["SPRT"], "")).toBe(false);
  });
});
