import { describe, expect, it } from "vitest";

import { presetTriggers, presetsForSchedule } from "@/services/teachingApproach";
import type { CatalogueEntry } from "@/services/syllabusCatalogues";

const preset = (id: string, label: string, payload: Record<string, unknown> = {}): CatalogueEntry =>
  ({ id, label, payload, isRetired: false } as unknown as CatalogueEntry);

describe("section 8 follows from the course schedule", () => {
  it("matches the department's existing texts by their names", () => {
    expect(presetTriggers(preset("a", "Lectures / Cours magistraux")).sessionTypes).toEqual(["CM"]);
    expect(presetTriggers(preset("b", "Problem-solving / TD")).sessionTypes).toEqual(["TD"]);
    expect(presetTriggers(preset("c", "Laboratory / TP")).sessionTypes).toEqual(["TP"]);
    expect(presetTriggers(preset("d", "Project"))).toEqual({ sessionTypes: [], assessmentTypeIds: [], projectByName: true });
  });

  it("prints the texts for the kinds of session and graded activity the schedule has", () => {
    const presets = [
      preset("lectures", "Lectures / Cours magistraux"),
      preset("td", "Problem-solving / TD"),
      preset("tp", "Laboratory / TP"),
      preset("project", "Project"),
      preset("debate", "Debate", { sessionTypes: ["Seminar"] }),
    ];
    const schedule = [
      { id: "s1", topic: "Rays" }, // no type: a lecture
      { id: "s2", sessionType: "TP", topic: "Lenses" },
      { id: "g1", kind: "graded", type: "Project" },
    ];

    expect(presetsForSchedule(presets, schedule).map((item) => item.id)).toEqual(["lectures", "tp", "project"]);
    expect(presetsForSchedule(presets, [{ id: "s3", sessionType: "Seminar" }]).map((item) => item.id)).toEqual(["debate"]);
  });
});
