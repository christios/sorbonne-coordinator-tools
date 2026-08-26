import { describe, expect, it } from "vitest";

import {
  changesSince,
  choices,
  countBy,
  filterRows,
  groupLabels,
  sharedCohort,
  shortTerm,
  sortRows,
  studentRows,
  NO_FILTERS,
  type StudentRow,
} from "@/services/rosterView";
import type { RosterRow } from "@/services/scenRosters";
import type { Student } from "@/services/studentDatabase";

const portalRow = (id: string, name: string, year = "FY", major = "Mathematics"): RosterRow => ({
  SPRIDEN_ID: id,
  FULL_NAME: name,
  YEARLEVEL_CODE: year,
  MAJOR_CODE_DESC: major,
  PSUAD_EMAIL: `${id.toLowerCase()}@psuad.ac.ae`,
});

const SYNCED = "2026-08-22T09:00:00+00:00";
const EARLIER = "2026-08-01T09:00:00+00:00";

const student = (studentId: string, over: Partial<Student> = {}): Student => ({
  studentId,
  status: "in_portal",
  cohortId: null,
  cohortName: "",
  firstSeenAt: EARLIER,
  lastSeenAt: SYNCED,
  groups: [],
  ...over,
});

const PULL = [
  portalRow("A001", "Amira Haddad"),
  portalRow("A002", "Karim Nasser", "L1", "Physics"),
  portalRow("A003", "Nadia Newcomer"),
];

const HELD: Student[] = [
  student("A001", { cohortId: "fy", cohortName: "Foundation Year" }),
  student("A002"),
  student("A003", { firstSeenAt: SYNCED }),
];

describe("reading the record against the latest pull", () => {
  it("names a student the pull returned, and leaves the rest of the row to the server", () => {
    const rows = studentRows(HELD, PULL, new Map(), SYNCED);

    expect(rows.find((row) => row.studentId === "A001")).toMatchObject({
      name: "Amira Haddad",
      yearLevel: "FY",
      status: "in_portal",
      cohortName: "Foundation Year",
    });
  });

  it("keeps a student the pull did not return, with no name to show", () => {
    const rows = studentRows([...HELD, student("A999", { status: "not_in_portal" })], PULL);

    // Nothing about them was ever stored beyond the id, so there is no name to display.
    expect(rows.find((row) => row.studentId === "A999")).toMatchObject({
      status: "not_in_portal",
      name: "",
    });
  });

  it("shows every held student when nothing has been pulled in this browser", () => {
    // Clearing the browser drops the names, not the students: the list is the server's.
    const rows = studentRows(HELD, []);

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.name === "")).toBe(true);
    expect(rows.every((row) => row.status === "in_portal")).toBe(true);
  });

  it("never invents a student the server has not been told about", () => {
    // Syncing is what puts somebody on the list; a pull on its own must not.
    expect(studentRows([], PULL)).toEqual([]);
  });

  it("marks a student first seen by the latest sync as new", () => {
    const rows = studentRows(HELD, PULL, new Map(), SYNCED);

    expect(rows.filter((row) => row.isNew).map((row) => row.studentId)).toEqual(["A003"]);
  });

  it("marks nobody as new when this browser has never synced", () => {
    expect(studentRows(HELD, PULL).some((row) => row.isNew)).toBe(false);
  });

  it("ignores a pulled row with no id, and reads a duplicate only once", () => {
    const rows = studentRows([student("A001")], [portalRow("", "No id"), portalRow("A001", "Once"), portalRow("A001", "Twice")]);

    expect(rows.map((row) => row.name)).toEqual(["Once"]);
  });

  it("counts each kind for the filter buttons", () => {
    const held = [...HELD, student("A999", { status: "not_in_portal" })];

    expect(countBy(studentRows(held, PULL, new Map(), SYNCED))).toEqual({
      all: 4,
      in_portal: 3,
      not_in_portal: 1,
      new: 1,
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
    const rows = studentRows(HELD, PULL, changes);

    expect(rows.find((row) => row.studentId === "A001")?.changes).toEqual(["year FY → L1"]);
    expect(countBy(rows).changed).toBe(1);
    expect(filterRows(rows, { ...NO_FILTERS, status: "changed" })).toHaveLength(1);
  });
});

describe("filtering", () => {
  const rows = studentRows([...HELD, student("A999", { status: "not_in_portal" })], PULL, new Map(), SYNCED);

  it("searches id, name and e-mail", () => {
    expect(filterRows(rows, { ...NO_FILTERS, query: "karim" }).map((row) => row.studentId)).toEqual(["A002"]);
    expect(filterRows(rows, { ...NO_FILTERS, query: "a003" }).map((row) => row.studentId)).toEqual(["A003"]);
    expect(filterRows(rows, { ...NO_FILTERS, query: "@psuad" })).toHaveLength(3);
  });

  it("narrows by year and by major", () => {
    expect(filterRows(rows, { ...NO_FILTERS, yearLevel: "L1" }).map((row) => row.studentId)).toEqual(["A002"]);
    expect(filterRows(rows, { ...NO_FILTERS, major: "Physics" }).map((row) => row.studentId)).toEqual(["A002"]);
  });

  it("narrows by what the last sync found", () => {
    expect(filterRows(rows, { ...NO_FILTERS, status: "not_in_portal" }).map((row) => row.studentId)).toEqual([
      "A999",
    ]);
    expect(filterRows(rows, { ...NO_FILTERS, status: "new" }).map((row) => row.studentId)).toEqual(["A003"]);
  });

  it("narrows by cohort, and to the students not in one yet", () => {
    expect(filterRows(rows, { ...NO_FILTERS, cohort: "fy" }).map((row) => row.studentId)).toEqual(["A001"]);
    expect(filterRows(rows, { ...NO_FILTERS, cohort: "none" }).map((row) => row.studentId)).toEqual([
      "A002",
      "A003",
      "A999",
    ]);
  });

  it("offers only the values that were actually pulled", () => {
    expect(choices(rows, "yearLevel")).toEqual(["FY", "L1"]);
    expect(choices(rows, "major")).toEqual(["Mathematics", "Physics"]);
  });
});

describe("sorting", () => {
  const rows = studentRows([...HELD, student("A999", { status: "not_in_portal" })], PULL);

  it("groups by what the last sync found", () => {
    expect(sortRows(rows, "status", true).map((row) => row.status)).toEqual([
      "in_portal",
      "in_portal",
      "in_portal",
      "not_in_portal",
    ]);
  });

  it("sorts by name, and reverses", () => {
    expect(sortRows(rows, "name", true).map((row) => row.name)[3]).toBe("Nadia Newcomer");
    expect(sortRows(rows, "name", false).map((row) => row.name)[0]).toBe("Nadia Newcomer");
  });

  it("sorts by cohort, keeping the students without one together", () => {
    expect(sortRows(rows, "cohortName", false).map((row) => row.cohortName)[0]).toBe("Foundation Year");
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

describe("the cohort a selection shares", () => {
  const row = (studentId: string, cohortId: string | null) =>
    ({ studentId, cohortId }) as StudentRow;

  it("is the cohort when every selected student is in it", () => {
    const rows = [row("A1", "c1"), row("A2", "c1"), row("A3", "c2")];
    expect(sharedCohort(rows, new Set(["A1", "A2"]))).toBe("c1");
  });

  it("is nothing when the selection spans two cohorts", () => {
    // There is no block list that answers for both, so the control has to decline.
    const rows = [row("A1", "c1"), row("A2", "c2")];
    expect(sharedCohort(rows, new Set(["A1", "A2"]))).toBeNull();
  });

  it("is nothing when a selected student is in no cohort at all", () => {
    const rows = [row("A1", "c1"), row("A2", null)];
    expect(sharedCohort(rows, new Set(["A1", "A2"]))).toBeNull();
    expect(sharedCohort(rows, new Set(["A2"]))).toBeNull();
  });

  it("is nothing when nothing is selected", () => {
    expect(sharedCohort([row("A1", "c1")], new Set())).toBeNull();
  });
});

describe("the blocks a student sits in", () => {
  const at = (termId: string, scopeCode: string, groupLabel: string) => ({ termId, scopeCode, groupLabel });

  it("says the block and the group, the way a coordinator says them", () => {
    expect(groupLabels([at("t1", "TD", "1"), at("t1", "CM", "2")])).toEqual(["TD 1", "CM 2"]);
  });

  it("names the semester once a student is in more than one", () => {
    // "TD 1" and "TD 3" side by side read as a contradiction until the semester is said.
    const labels = groupLabels([at("t1", "TD", "1"), at("t2", "TD", "3")], {
      t1: "Physics & Maths — First Year, Semester 1",
      t2: "Physics & Maths — First Year, Semester 2",
    });
    expect(labels).toEqual(["Semester 1 · TD 1", "Semester 2 · TD 3"]);
  });

  it("leaves the semester out when there is only one, because it adds nothing", () => {
    const labels = groupLabels([at("t1", "TD", "1")], { t1: "Physics & Maths — Semester 1" });
    expect(labels).toEqual(["TD 1"]);
  });

  it("falls back to the block alone when the semester has no name here", () => {
    expect(groupLabels([at("t1", "TD", "1"), at("t2", "CM", "2")], {})).toEqual(["TD 1", "CM 2"]);
  });

  it("shortens the registrar's title to the part that fits a cell", () => {
    expect(shortTerm("Physics & Maths — First Year, Semester 2")).toBe("Semester 2");
    expect(shortTerm("Languages")).toBe("Languages");
  });
});
