import { describe, expect, it } from "vitest";

import { bibliographyEntries, deliveryPercentageError, rubricEntries } from "./syllabusContent";

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
