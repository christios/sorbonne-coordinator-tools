import { describe, expect, it } from "vitest";

import {
  changesSince,
  choices,
  countBy,
  filterRows,
  sortRows,
  studentRows,
  NO_FILTERS,
} from "@/services/rosterView";
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
      changed: 0,
    });
  });
});

describe("what changed since the last pull", () => {
  it("names each field that moved, old value first", () => {
    const before = [portalRow("A001", "Amira Haddad", "FY", "Mathematics")];
    const after = [portalRow("A001", "Amira Haddad", "L1", "Physics")];

    expect(changesSince(before, after).get("A001")).toEqual([
      "year FY → L1",
      "major Mathematics → Physics",
    ]);
  });

  it("notices a change of name", () => {
    const changes = changesSince([portalRow("A001", "Amira Haddad")], [portalRow("A001", "Amira Nasser")]);

    expect(changes.get("A001")).toEqual(["name Amira Haddad → Amira Nasser"]);
  });

  it("says nothing about a student who has not moved", () => {
    expect(changesSince(PULL, PULL).size).toBe(0);
  });

  it("treats an arrival as new rather than changed", () => {
    expect(changesSince([portalRow("A001", "Amira Haddad")], PULL).has("A003")).toBe(false);
  });

  it("ignores a field that has become blank, which is a gap not a change", () => {
    const before = [portalRow("A001", "Amira Haddad", "FY")];
    const after = [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "" }];

    expect(changesSince(before, after).size).toBe(0);
  });

  it("shows on the row, and can be filtered and counted", () => {
    const changes = changesSince(
      [portalRow("A001", "Amira Haddad", "FY")],
      [portalRow("A001", "Amira Haddad", "L1")],
    );
    const rows = studentRows(PULL, ["A001"], changes);

    expect(rows.find((row) => row.studentId === "A001")?.changes).toEqual(["year FY → L1"]);
    expect(countBy(rows).changed).toBe(1);
    expect(filterRows(rows, { ...NO_FILTERS, membership: "changed" })).toHaveLength(1);
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
