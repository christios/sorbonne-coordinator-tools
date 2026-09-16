import { describe, expect, it } from "vitest";

import { detailFromLocation, locationFor, pageFromLocation, toolFromLocation } from "@/routes/toolRoute";

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

describe("what the address names within a page", () => {
  it("reads the screen open inside the page", () => {
    expect(detailFromLocation("#/database/semesters/timetable:term-1")).toBe("timetable:term-1");
  });

  it("says nothing when the address stops at the page", () => {
    expect(detailFromLocation("#/database/semesters")).toBe("");
  });

  it("writes one into the address, and leaves it out when there is none", () => {
    expect(locationFor("database", "semesters", "timetable:term-1")).toBe("/database/semesters/timetable:term-1");
    expect(locationFor("database", "semesters")).toBe("/database/semesters");
    // A screen cannot be named without the page it is on.
    expect(locationFor("database", "", "timetable:term-1")).toBe("/database");
  });
});
