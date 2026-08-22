import { describe, expect, it } from "vitest";

import { choices, countBy, filterRows, sortRows, studentRows, NO_FILTERS } from "@/services/rosterView";
import type { RosterRow } from "@/services/scenRosters";

const portalRow = (id: string, name: string, year = "FY", major = "Mathematics"): RosterRow => ({
  SPRIDEN_ID: id,
  FULL_NAME: name,
  YEARLEVEL_CODE: year,
  MAJOR_CODE_DESC: major,
  PSUAD_EMAIL: `${id.toLowerCase()}@psuad.ac.ae`,
});

const PULL = [
  portalRow("A001", "Amira Haddad"),
  portalRow("A002", "Karim Nasser", "L1", "Physics"),
  portalRow("A003", "Nadia Newcomer"),
];

describe("reading a pull against a cohort", () => {
  it("marks a student the cohort holds and the portal still returns as staying", () => {
    const rows = studentRows(PULL, ["A001"]);

    expect(rows.find((row) => row.studentId === "A001")).toMatchObject({
      name: "Amira Haddad",
      membership: "stayed",
    });
  });

  it("marks a student the portal returns but the cohort does not hold as new", () => {
    expect(studentRows(PULL, ["A001"]).find((row) => row.studentId === "A003")?.membership).toBe("new");
  });

  it("keeps a member the portal has dropped, with no name to show", () => {
    const rows = studentRows(PULL, ["A001", "A999"]);

    // Nothing was ever stored about them beyond the id, so there is no name to display.
    expect(rows.find((row) => row.studentId === "A999")).toMatchObject({
      membership: "left",
      name: "",
    });
  });

  it("matches ids case-insensitively, the way the portal writes them", () => {
    expect(studentRows(PULL, ["a001"]).find((row) => row.studentId === "A001")?.membership).toBe("stayed");
  });

  it("ignores a row with no id and never lists anybody twice", () => {
    const rows = studentRows([portalRow("", "No id"), portalRow("A001", "Once"), portalRow("A001", "Twice")], []);

    expect(rows.map((row) => row.studentId)).toEqual(["A001"]);
  });

  it("counts each kind for the filter buttons", () => {
    expect(countBy(studentRows(PULL, ["A001", "A999"]))).toEqual({
      all: 4,
      stayed: 1,
      new: 2,
      left: 1,
    });
  });
});

describe("filtering", () => {
  const rows = studentRows(PULL, ["A001"]);

  it("searches id, name and e-mail", () => {
    expect(filterRows(rows, { ...NO_FILTERS, query: "karim" }).map((row) => row.studentId)).toEqual(["A002"]);
    expect(filterRows(rows, { ...NO_FILTERS, query: "a003" }).map((row) => row.studentId)).toEqual(["A003"]);
    expect(filterRows(rows, { ...NO_FILTERS, query: "@psuad" })).toHaveLength(3);
  });

  it("narrows by year and by major", () => {
    expect(filterRows(rows, { ...NO_FILTERS, yearLevel: "L1" }).map((row) => row.studentId)).toEqual(["A002"]);
    expect(filterRows(rows, { ...NO_FILTERS, major: "Physics" }).map((row) => row.studentId)).toEqual(["A002"]);
  });

  it("narrows by what the pull says about the cohort", () => {
    expect(filterRows(rows, { ...NO_FILTERS, membership: "new" }).map((row) => row.studentId)).toEqual([
      "A002",
      "A003",
    ]);
  });

  it("offers only the values that were actually pulled", () => {
    expect(choices(rows, "yearLevel")).toEqual(["FY", "L1"]);
    expect(choices(rows, "major")).toEqual(["Mathematics", "Physics"]);
  });
});

describe("sorting", () => {
  const rows = studentRows(PULL, ["A001", "A999"]);

  it("puts the work first when sorting by status", () => {
    expect(sortRows(rows, "membership", true).map((row) => row.membership)).toEqual([
      "new",
      "new",
      "left",
      "stayed",
    ]);
  });

  it("sorts by name, and reverses", () => {
    expect(sortRows(rows, "name", true).map((row) => row.name)[3]).toBe("Nadia Newcomer");
    expect(sortRows(rows, "name", false).map((row) => row.name)[0]).toBe("Nadia Newcomer");
  });

  it("sorts ids the way a person reads them", () => {
    expect(sortRows(rows, "studentId", true).map((row) => row.studentId)).toEqual([
      "A001",
      "A002",
      "A003",
      "A999",
    ]);
  });
});
