import { describe, expect, it } from "vitest";

import { hashFor, sameScreen, screenFromHash } from "@/services/syllabusRoute";

describe("the syllabus builder's place in the address", () => {
  it("reads back every screen it writes", () => {
    for (const screen of [
      { view: "library" },
      { view: "catalogues" },
      { view: "catalogues", section: "curriculum-mapping" },
      { view: "editor", id: "1d8f2c4e-0000-4000-8000-000000000001" },
      { view: "editor", id: "1d8f2c4e-0000-4000-8000-000000000001", section: "learningOutcomes" },
      { view: "comparison", id: "1d8f2c4e-0000-4000-8000-000000000001" },
    ] as const) {
      expect(screenFromHash(hashFor(screen))).toEqual(screen);
    }
  });

  it("opens the library when the address names nothing within the builder", () => {
    expect(screenFromHash("#/syllabus")).toEqual({ view: "library" });
    expect(screenFromHash("")).toEqual({ view: "library" });
  });

  it("treats a change of section as the same screen", () => {
    expect(sameScreen({ view: "editor", id: "a", section: "schedule" }, { view: "editor", id: "a", section: "assessment" })).toBe(true);
    expect(sameScreen({ view: "editor", id: "a" }, { view: "editor", id: "b" })).toBe(false);
    expect(sameScreen({ view: "editor", id: "a" }, { view: "comparison", id: "a" })).toBe(false);
  });
});
