import { describe, expect, it } from "vitest";

import { bibliographyEntries, contactHours, deliveryPercentageError, fysComponentRows, gradedActivities, ploDisplayLabel, rubricEntries, rubricsInUse, sectionParts } from "./syllabusContent";

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

describe("fysComponentRows", () => {
  it("fills the Foundation Year form's rows from the graded cards, as the document does", () => {
    const rows = fysComponentRows([
      { component: "continuous:In class assignment", description: "Quiz on functions", weight: "10", cloNumbers: ["1"] },
      { component: "continuous:In class assignment", description: "Quiz on limits", weight: "10", cloNumbers: ["1", "2"] },
      { component: "final", description: "Written exam", weight: "50", cloNumbers: ["1", "2", "3"] },
    ]);

    expect(rows.continuous[0]).toEqual({ component: "In class assignment", description: "Quiz on functions\nQuiz on limits", clos: "CLO 1, CLO 2", weight: "20%" });
    expect(rows.final).toEqual([{ description: "Written exam", clos: "CLO 1, CLO 2, CLO 3", weight: "50%" }]);
    expect(rows.laboratory.map((row) => row.description)).toEqual(["", ""]);
  });
});

describe("the contact hours the document prints", () => {
  it("adds up the sessions' lengths by type, as the server does", () => {
    const content = {
      identification: { contactHours: { Lectures: "99" } },
      schedule: [
        { id: "a", sessionType: "CM", duration: "1.5" },
        { id: "b", duration: "1,5" },
        { id: "c", sessionType: "TD", duration: "2" },
        { id: "d", sessionType: "TP", duration: "3" },
        { id: "e", sessionType: "Workshop", duration: "2" },
        { id: "f", sessionType: "Seminar", duration: "1" },
        { id: "g", sessionType: "Other", duration: "0.5" },
        { id: "h", sessionType: "TD" },
        { id: "exam", kind: "graded", duration: "3" },
      ],
    };

    expect(contactHours(content)).toEqual({ Lectures: "3", Tutorials: "2", Workshops: "2", Seminars: "1", Laboratory: "3", Other: "0.5" });
  });

  it("keeps a syllabus's typed hours while none of its sessions has a length", () => {
    const content = { identification: { contactHours: { Lectures: "8", Tutorials: "10", Laboratory: "12" } }, schedule: [{ id: "a", sessionType: "CM" }] };

    expect(contactHours(content)).toEqual({ Lectures: "8", Tutorials: "10", Workshops: "", Seminars: "", Laboratory: "12", Other: "" });
  });
});

