import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_LAYOUT,
  loadLayout,
  moveColumn,
  optionsFor,
  reconcileLayout,
  resizeColumn,
  saveLayout,
  toggleColumn,
  visibleColumns,
  widthOf,
  STUDENT_COLUMNS,
} from "@/services/studentColumns";
import type { StudentRow } from "@/services/rosterView";

const row = (over: Partial<StudentRow> = {}): StudentRow => ({
  studentId: "A001",
  name: "Amira Haddad",
  yearLevel: "FY",
  major: "Mathematics",
  email: "a001@psuad.ac.ae",
  status: "in_portal",
  cohortId: null,
  cohortName: "",
  firstSeenAt: "2026-08-01T09:00:00+00:00",
  lastSeenAt: "2026-08-22T09:00:00+00:00",
  isNew: false,
  changes: [],
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe("the stored arrangement", () => {
  it("starts with the everyday columns shown and the rest put away", () => {
    expect(visibleColumns(DEFAULT_LAYOUT).map((column) => column.id)).toEqual([
      "status",
      "name",
      "studentId",
      "yearLevel",
      "major",
      "cohortName",
    ]);
  });

  it("survives a round trip through storage", () => {
    saveLayout(toggleColumn(DEFAULT_LAYOUT, "email"));

    expect(visibleColumns(loadLayout()).map((column) => column.id)).toContain("email");
  });

  it("keeps a column added since the layout was written", () => {
    // An old layout naming only three columns must not hide everything added later.
    const repaired = reconcileLayout({ order: ["studentId", "name", "status"], hidden: [], widths: {} });

    expect(repaired.order).toHaveLength(STUDENT_COLUMNS.length);
    expect(repaired.order.slice(0, 3)).toEqual(["studentId", "name", "status"]);
  });

  it("drops a column the code no longer has", () => {
    const repaired = reconcileLayout({ order: ["studentId", "vanished"], hidden: ["vanished"], widths: { vanished: 90 } });

    expect(repaired.order).not.toContain("vanished");
    expect(repaired.hidden).not.toContain("vanished");
    expect(repaired.widths.vanished).toBeUndefined();
  });

  it("refuses to hide a column the row cannot be read without", () => {
    expect(toggleColumn(DEFAULT_LAYOUT, "studentId").hidden).not.toContain("studentId");
    expect(reconcileLayout({ hidden: ["studentId"] }).hidden).not.toContain("studentId");
  });

  it("ignores a stored width narrower than the column can be", () => {
    const column = STUDENT_COLUMNS.find((candidate) => candidate.id === "major")!;

    expect(reconcileLayout({ widths: { major: 10 } }).widths.major).toBe(column.minWidth);
    expect(widthOf(resizeColumn(DEFAULT_LAYOUT, "major", 5), column)).toBe(column.minWidth);
  });

  it("falls back to the default when storage holds nonsense", () => {
    window.localStorage.setItem("scen-student-columns:v1", "not json");

    expect(visibleColumns(loadLayout())).toHaveLength(6);
  });
});

describe("moving a column", () => {
  it("shifts it one place, in either direction", () => {
    const moved = moveColumn(DEFAULT_LAYOUT, "name", -1);

    expect(moved.order.slice(0, 2)).toEqual(["name", "status"]);
    expect(moveColumn(moved, "name", 1).order.slice(0, 2)).toEqual(["status", "name"]);
  });

  it("does nothing at either end rather than wrapping around", () => {
    const first = DEFAULT_LAYOUT.order[0];
    const last = DEFAULT_LAYOUT.order[DEFAULT_LAYOUT.order.length - 1];

    expect(moveColumn(DEFAULT_LAYOUT, first, -1)).toBe(DEFAULT_LAYOUT);
    expect(moveColumn(DEFAULT_LAYOUT, last, 1)).toBe(DEFAULT_LAYOUT);
  });
});

describe("the values a column offers to the filter bar", () => {
  it("lists each distinct value once, labelled the way the cell reads", () => {
    const rows = [row(), row({ studentId: "A002", status: "not_in_portal" }), row({ studentId: "A003" })];
    const status = STUDENT_COLUMNS.find((column) => column.id === "status")!;

    expect(optionsFor(rows, status)).toEqual([
      { value: "in_portal", label: "In portal" },
      { value: "not_in_portal", label: "Not in portal" },
    ]);
  });

  it("leaves out the blanks, which are not a value anybody filters for", () => {
    const cohort = STUDENT_COLUMNS.find((column) => column.id === "cohortName")!;

    expect(optionsFor([row(), row({ cohortName: "L1" })], cohort)).toEqual([{ value: "L1", label: "L1" }]);
  });
});
