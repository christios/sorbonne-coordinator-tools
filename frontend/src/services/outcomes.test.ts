import { describe, expect, it } from "vitest";

import { alignablePlos, catalogueCloRows, expectedPloIds, mappingEntryFor, unalignedPloIds } from "./outcomes";
import type { CatalogueEntry } from "./syllabusCatalogues";

const entry = (id: string, category: CatalogueEntry["category"], label: string, payload: Record<string, unknown> = {}, isRetired = false): CatalogueEntry => ({
  id, category, parentId: "programme-physics", label, payload, sortOrder: 0, isRetired, retiredAt: null, revision: 1, createdAt: "2026-11-10T00:00:00Z", updatedAt: "2026-11-10T00:00:00Z",
});

const plos = [
  entry("plo-1", "plos", "PLO 1"),
  entry("plo-2", "plos", "PLO 2"),
  entry("plo-3", "plos", "PLO 3"),
  entry("plo-4", "plos", "PLO 4", {}, true),
];
const mapping = [entry("map-118", "curriculum-mapping", "PHYS 118", { ploIds: ["plo-3", "plo-1", "plo-4"] })];

describe("aligning CLOs to the curriculum mapping", () => {
  it("finds the course in the mapping whatever the code's punctuation", () => {
    expect(mappingEntryFor(mapping, "PHYS-118")?.id).toBe("map-118");
    expect(mappingEntryFor(mapping, "PHYS-119")).toBeUndefined();
  });

  it("offers only the current PLOs the mapping expects of the course", () => {
    expect(alignablePlos(plos, mappingEntryFor(mapping, "PHYS-118")).map((plo) => plo.id)).toEqual(["plo-1", "plo-3"]);
  });

  it("offers every current PLO of the programme for a course the mapping does not list yet", () => {
    expect(alignablePlos(plos, undefined).map((plo) => plo.id)).toEqual(["plo-1", "plo-2", "plo-3"]);
  });

  it("lists the expected PLOs no CLO is aligned to yet, whichever way the ids were stored", () => {
    const expected = expectedPloIds(mappingEntryFor(mapping, "PHYS-118"));
    expect(unalignedPloIds(expected, [{ ploIds: "plo-3" }, { ploIds: ["plo-4"] }])).toEqual(["plo-1"]);
    expect(unalignedPloIds(expected, [{ ploIds: "plo-1\nplo-3\nplo-4" }])).toEqual([]);
  });
});

describe("the Head of Department's outcomes, as a syllabus shows them", () => {
  it("quotes each aligned PLO and competency as code and outcome, keeping their ids", () => {
    const programmePlos = [entry("plo-1", "plos", "PLO 1", { code: "PLO 1", outcome: "Model." })];
    const competencies = [entry("c-1", "competencies", "C1", { code: "C1", outcome: "Reason." })];
    const mapped = entry("map", "curriculum-mapping", "PHYS-118", { clos: [{ id: "hod-1", clo: "Trace rays.", ploIds: ["plo-1", "gone"], skillIds: ["c-1"] }] });

    expect(catalogueCloRows(mapped, programmePlos, competencies)).toEqual([
      { id: "hod-1", clo: "Trace rays.", plo: "PLO 1: Model.", ploIds: "plo-1", skills: "C1: Reason.", skillIds: "c-1" },
    ]);
    expect(catalogueCloRows(undefined, programmePlos, competencies)).toEqual([]);
  });
});
