import { describe, expect, it } from "vitest";

import { aiOption, aiOptions, aiOptionsInUse, aiPolicySummary, courseAiFallback, templatePermittedUse } from "./aiPolicy";

describe("AI policy per graded activity", () => {
  it("names the template's options whatever the case or spacing", () => {
    expect(aiOption("  ai   prohibited ")).toBe("AI Prohibited");
    expect(aiOption("Something else")).toBe("");
  });

  it("lists the options in use in the template's order, an older course policy standing in for a missing one", () => {
    const activities = [{ aiPolicy: "Other (Specify)" }, {}, { ai: "AI Prohibited" }];
    expect(aiOptionsInUse(activities, "AI Required")).toEqual(["AI Prohibited", "AI Required", "Other (Specify)"]);
    expect(aiOptionsInUse([{}])).toEqual([]);
  });

  it("prints Other with the activity's own words in the 9.1 summary", () => {
    expect(aiPolicySummary({ aiPolicy: "Other (Specify)", aiOtherText: "Sources only" })).toBe("Other: Sources only");
    expect(aiPolicySummary({}, "AI Prohibited")).toBe("AI Prohibited");
  });

  it("matches a use worded the builder's old way to the template's box", () => {
    expect(templatePermittedUse("Language editing")).toBe("Language editing (grammar, spelling, style, and readability)");
    expect(templatePermittedUse("Structuring or organising ideas")).toBe("Structuring or organizing ideas");
  });

  it("falls back to the template's labels and uses before the catalogue loads", () => {
    const options = aiOptions([]);
    expect(options.map((option) => option.row)).toEqual([1, 2, 3, 4, 5]);
    expect(options[1].permittedUses).toContain("Language editing (grammar, spelling, style, and readability)");
  });

  it("lets a converted syllabus's activities stand on their own, without the old course-wide policy", () => {
    expect(courseAiFallback({ assessment: { aiPolicy: "AI Prohibited" } })).toBe("AI Prohibited");
    expect(courseAiFallback({ schemaVersion: 2, assessment: { aiPolicy: "AI Prohibited" } })).toBe("");
  });
});
