import { describe, expect, it } from "vitest";

import { bibliographyEntries, deliveryPercentageError, gradedActivities, ploDisplayLabel, rubricEntries, rubricsInUse, sectionParts } from "./syllabusContent";

describe("bibliographyEntries", () => {
  it("preserves a legacy free-text bibliography as one editable entry", () => {
    expect(bibliographyEntries("Author, A. (2024). A reference."))
      .toEqual([{ id: "legacy-resource-0", legacyText: "Author, A. (2024). A reference." }]);
  });

  it("keeps structured entries unchanged", () => {
    expect(bibliographyEntries([{ id: "book-1", authors: "A. Author", title: "A book" }]))
      .toEqual([{ id: "book-1", authors: "A. Author", title: "A book" }]);
  });

  it("groups legacy flat rubric rows under their assessment type", () => {
    expect(rubricEntries([{ id: "row-1", assignment: "Essay", criteria: "Argument", meets: "Clear", exceeds: "Original" }]))
      .toEqual([{ id: "legacy-rubric-0", assignment: "Essay", criteria: [{ id: "row-1", criterion: "Argument", meets: "Clear", exceeds: "Original" }] }]);
  });
});

describe("deliveryPercentageError", () => {
  it("requires completed delivery percentages to total 100", () => {
    expect(deliveryPercentageError("60", "30")).toBe("Face-to-face and online delivery must total 100%.");
    expect(deliveryPercentageError("100", "0")).toBeNull();
    expect(deliveryPercentageError("", "")).toBeNull();
  });

  it("rejects percentages outside the supported range", () => {
    expect(deliveryPercentageError("101", "0")).toBe("Delivery percentages must be between 0 and 100.");
  });
});

describe("ploDisplayLabel", () => {
  it("uses the PLO position as the automatic code and strips legacy prefixes", () => {
    expect(ploDisplayLabel({ id: "plo-1", code: "Old code", outcome: "PLO 1. Explain climate policy." }, 0))
      .toBe("PLO 1: Explain climate policy.");
  });
});

describe("sectionParts", () => {
  const sections = [
    { id: "description", label: "3. Course description and delivery", parts: ["description", "delivery"] },
    { id: "schedule", label: "5. Course schedule" },
  ];

  it("edits every part of a merged section, in document order", () => {
    expect(sectionParts(sections, "description")).toEqual(["description", "delivery"]);
  });

  it("treats a section without parts as editing itself", () => {
    expect(sectionParts(sections, "schedule")).toEqual(["schedule"]);
    expect(sectionParts(sections, "unknown")).toEqual(["unknown"]);
  });
});

describe("rubricsInUse", () => {
  const quiz = { id: "type-quiz", label: "Quiz", payload: { criteria: [{ name: "Accuracy", inadequate: "Poor", meets: "Sound", exceeds: "Excellent" }] } };
  const written = [
    { id: "r1", assignment: "Lab report", criteria: [{ id: "c1", criterion: "Method" }] },
    { id: "r2", assignment: "Essay", criteria: [{ id: "c2", criterion: "Argument" }] },
  ];

  it("shows one rubric per kind of graded activity, as the document prints them", () => {
    const shown = rubricsInUse([{ id: "a1", assessmentTypeId: "type-quiz" }, { id: "a2", type: " lab REPORT " }], written, [quiz]);
    expect(shown.map((rubric) => rubric.label)).toEqual(["Quiz", "Lab report"]);
    expect(shown[0].criteria[0]).toEqual({ name: "Accuracy", inadequate: "Poor", meets: "Sound", exceeds: "Excellent" });
  });

  it("shows nothing when there is nothing graded, whatever was written before", () => {
    expect(rubricsInUse([], written, [quiz])).toEqual([]);
  });
});

describe("gradedActivities", () => {
  it("reads the assessment list on a syllabus written before November 2026", () => {
    expect(gradedActivities({ assessment: { items: [{ id: "a1", type: "Quiz" }] }, schedule: [{ id: "g1", kind: "graded" }] }))
      .toEqual([{ id: "a1", type: "Quiz" }]);
  });

  it("reads the schedule's graded cards once the schedule holds them", () => {
    expect(gradedActivities({
      schemaVersion: 2,
      assessment: { items: [{ id: "old" }] },
      schedule: [{ id: "s1", topic: "Optics" }, { id: "g1", kind: "graded", type: "Quiz" }],
    })).toEqual([{ id: "g1", kind: "graded", type: "Quiz" }]);
  });
});
