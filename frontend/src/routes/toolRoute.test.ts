import { describe, expect, it } from "vitest";

import { locationFor, pageFromLocation, toolFromLocation } from "@/routes/toolRoute";

describe("which application the address names", () => {
  it("reads it from the hash", () => {
    expect(toolFromLocation("/", "#/database")).toBe("database");
  });

  it("still reads it when a page follows", () => {
    expect(toolFromLocation("/", "#/database/groups")).toBe("database");
  });

  it("keeps the links people saved when timetables was its own application", () => {
    expect(toolFromLocation("/", "#/timetables")).toBe("database");
    expect(toolFromLocation("/", "#/timetables/semesters")).toBe("database");
  });

  it("knows nothing of an address that names no application", () => {
    expect(toolFromLocation("/", "#/nonsense")).toBeNull();
    expect(toolFromLocation("/", "")).toBeNull();
  });
});

describe("which page within it", () => {
  it("reads the second part", () => {
    expect(pageFromLocation("#/database/groups")).toBe("groups");
  });

  it("says nothing when the address names only the application", () => {
    // "" rather than a guess: the caller knows its own default.
    expect(pageFromLocation("#/database")).toBe("");
  });

  it("is not confused by trailing or doubled slashes", () => {
    expect(pageFromLocation("#/database/")).toBe("");
    expect(pageFromLocation("#//database//groups")).toBe("groups");
  });
});

describe("writing the address", () => {
  it("names the page when there is one", () => {
    expect(locationFor("database", "semesters")).toBe("/database/semesters");
  });

  it("names only the application otherwise", () => {
    expect(locationFor("database")).toBe("/database");
  });
});
