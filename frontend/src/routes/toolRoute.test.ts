import { describe, expect, it } from "vitest";

import { toolFromLocation } from "@/routes/toolRoute";

describe("toolFromLocation", () => {
  it("opens the syllabus builder from a shareable hash link", () => {
    expect(toolFromLocation("/", "#/syllabus")).toBe("syllabus");
  });

  it("continues to support the existing path-style routes", () => {
    expect(toolFromLocation("/roster", "")).toBe("roster");
  });
});
