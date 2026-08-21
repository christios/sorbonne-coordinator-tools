import { describe, expect, it } from "vitest";

import { toolFromLocation } from "@/routes/toolRoute";

describe("toolFromLocation", () => {
  it("opens the syllabus builder from a shareable hash link", () => {
    expect(toolFromLocation("/", "#/syllabus")).toBe("syllabus");
  });

  it("continues to support the existing path-style routes", () => {
    expect(toolFromLocation("/roster", "")).toBe("roster");
  });

  it("opens the teacher database from its route and redirects legacy requisition links", () => {
    expect(toolFromLocation("/", "#/teachers")).toBe("teachers");
    expect(toolFromLocation("/", "#/requisition")).toBe("teachers");
  });

  it("opens the timetable uploader from either route style", () => {
    expect(toolFromLocation("/", "#/timetables")).toBe("timetables");
    expect(toolFromLocation("/timetables", "")).toBe("timetables");
  });

  it("opens settings, which is reached from the user menu rather than the picker", () => {
    expect(toolFromLocation("/", "#/settings")).toBe("settings");
  });

  it("stays on the app picker for anything it does not know", () => {
    expect(toolFromLocation("/", "#/nonsense")).toBeNull();
  });
});
