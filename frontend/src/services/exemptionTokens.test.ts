import { describe, expect, it } from "vitest";

import { exemptGroupWarnings } from "@/services/discrepancies";
import { exemptionTokens } from "@/services/exemptionTokens";
import { EMPTY_SECTION, type CatalogueScope, type CohortCatalogue } from "@/services/studentDatabase";

const scope = (id: string, code: string, courses: { id: string; code: string }[], crns: Record<string, string>, openToAll = false) =>
  ({
    id,
    code,
    openToAll,
    courses: courses.map((course) => ({ ...course, name: course.code })),
    groups: [{ id: `${id}-1`, label: "1", crns: Object.fromEntries(Object.entries(crns).map(([courseId, crn]) => [courseId, { ...EMPTY_SECTION, crn }])) }],
  }) as unknown as CatalogueScope;

const CM = scope("cm", "CM", [{ id: "cm-phys", code: "PHYS-125" }], { "cm-phys": "22135" });
const MTP = scope("mtp", "MTP", [{ id: "mtp-phys", code: "PHYS-125" }], { "mtp-phys": "23639" });
const LANG = scope("lang", "LANG", [{ id: "fr", code: "SCEN-101" }], { fr: "24301" }, true);
const CARDS = [
  { cohort: { id: "l1", name: "L1-S1", term: "" }, scopes: [CM, MTP] },
  { cohort: { id: "fys", name: "FYS-S1", term: "" }, scopes: [LANG] },
] as unknown as CohortCatalogue[];
const exemption = (studentId: string, courseId: string, courseCode: string, scopeCode: string, reason = "") => ({
  studentId, courseId, courseCode, scopeId: "", scopeCode, termId: "", reason,
});

describe("the Exempt from column", () => {
  it("says the course and why, and names the part when it is one set's alone", () => {
    const tokens = exemptionTokens(
      [exemption("A1", "fr", "SCEN-101", "LANG", "LEA track"), exemption("A1", "mtp-phys", "PHYS-125", "MTP")],
      () => "l1",
      CARDS,
    );
    expect(tokens.get("A1")).toEqual(["PHYS-125 (MTP)", "SCEN-101 · LEA track"]);
  });

  it("names no part when every set of theirs that carries the course is exempt", () => {
    const tokens = exemptionTokens(
      [exemption("A1", "cm-phys", "PHYS-125", "CM"), exemption("A1", "mtp-phys", "PHYS-125", "MTP", "Repeater")],
      () => "l1",
      CARDS,
    );
    expect(tokens.get("A1")).toEqual(["PHYS-125 · Repeater"]);
  });
});

describe("a group they are exempt from every course of", () => {
  it("is a warning on their row, and one course of it taken is none", () => {
    const placed = { A1: { mtp: "mtp-1", cm: "cm-1" } };
    const warnings = exemptGroupWarnings([CM, MTP], placed, [exemption("A1", "mtp-phys", "PHYS-125", "MTP")]);
    expect(warnings.map((warning) => warning.label)).toEqual(["exempt from all of MTP 1"]);
    expect(exemptGroupWarnings([CM, MTP], placed, [])).toEqual([]);
  });
});
