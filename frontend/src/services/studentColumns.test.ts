import { beforeEach, describe, expect, it } from "vitest";

import {
  MIN_WIDTH,
  buildColumns,
  defaultLayout,
  loadLayout,
  moveColumn,
  optionsFor,
  reconcileLayout,
  reorderColumn,
  resizeColumn,
  saveLayout,
  toggleColumn,
  visibleColumns,
  widthOf,
} from "@/services/studentColumns";
import type { StudentRow } from "@/services/rosterView";
import type { PortalColumn, PortalField } from "@/services/scenRosters";

/** What the portal's grid shows — its column picker's list. */
const PORTAL_COLUMNS: PortalColumn[] = [
  { key: "FULL_NAME", label: "Student" },
  { key: "SPRIDEN_ID", label: "Id" },
  { key: "YEARLEVEL_CODE", label: "Year" },
  { key: "MAJOR_CODE_DESC", label: "Major" },
  { key: "PSUAD_EMAIL", label: "E-mail" },
  { key: "ABSENCE_PER", label: "Absence %" },
];

/**
 * What the portal filters by, which is a different list: CAMPUS_CODE is filterable and
 * never shown, and ABSENCE_PER is shown and cannot be filtered.
 */
const FIELDS: PortalField[] = [
  { key: "YEARLEVEL_CODE", label: "Year", options: [{ value: "FY", label: "FY" }] },
  { key: "CAMPUS_CODE", label: "Campus", options: [{ value: "AD", label: "Abu Dhabi" }] },
];

const COLUMNS = buildColumns(PORTAL_COLUMNS, FIELDS);
const LAYOUT = defaultLayout(COLUMNS);

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
  portal: { FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
  isNew: false,
  changes: [],
  groups: [],
  ...over,
});

beforeEach(() => window.localStorage.clear());

describe("the columns the portal offers", () => {
  it("makes a column of every column the portal shows, alongside our own", () => {
    const ids = COLUMNS.map((column) => column.id);

    expect(ids).toContain("portal:ABSENCE_PER");
    expect(ids).toContain("status");
    expect(ids).toContain("cohortName");
  });

  it("offers a column the portal cannot filter by, and not a filter it never shows", () => {
    const ids = COLUMNS.map((column) => column.id);

    // The old list came from the filters, so it offered columns that were always empty
    // and hid ones the pull had carried all along.
    expect(ids).toContain("portal:ABSENCE_PER");
    expect(ids).not.toContain("portal:CAMPUS_CODE");
  });

  it("does not offer the portal's id twice — we already have that column", () => {
    expect(COLUMNS.filter((column) => /id$/i.test(column.id))).toHaveLength(1);
    expect(COLUMNS.map((column) => column.id)).not.toContain("portal:SPRIDEN_ID");
  });

  it("filters a column with a short code table as options, and a bare one as text", () => {
    // A column filters as a set of choices only where the portal offers those choices,
    // which is knowledge that lives in the filters rather than in the column picker.
    expect(COLUMNS.find((column) => column.id === "portal:YEARLEVEL_CODE")?.type).toBe("option");
    expect(COLUMNS.find((column) => column.id === "portal:FULL_NAME")?.type).toBe("text");
  });

  it("still has usable columns before the extension has described the portal", () => {
    const ids = buildColumns([]).map((column) => column.id);

    expect(ids).toContain("portal:FULL_NAME");
    expect(ids).toContain("portal:YEARLEVEL_CODE");
  });

  it("reads a portal column off the row the pull produced", () => {
    const column = COLUMNS.find((candidate) => candidate.id === "portal:MAJOR_CODE_DESC")!;

    expect(column.accessor(row())).toBe("Mathematics");
    expect(column.accessor(row({ portal: {} }))).toBe("");
  });
});

describe("the stored arrangement", () => {
  it("starts with the everyday columns shown and the rest put away", () => {
    expect(visibleColumns(LAYOUT, COLUMNS).map((column) => column.id)).toEqual([
      "status",
      "portal:FULL_NAME",
      "studentId",
      "portal:YEARLEVEL_CODE",
      "portal:MAJOR_CODE_DESC",
      "cohortName",
      "groups",
    ]);
  });

  it("survives a round trip through storage", () => {
    saveLayout(toggleColumn(LAYOUT, "portal:PSUAD_EMAIL", COLUMNS));

    expect(visibleColumns(loadLayout(COLUMNS), COLUMNS).map((column) => column.id)).toContain(
      "portal:PSUAD_EMAIL",
    );
  });

  it("keeps a column added since the layout was written, but does not show it unasked", () => {
    // The portal gaining a field must not rearrange a table somebody has set up.
    const older = { order: ["status", "studentId", "portal:FULL_NAME"], hidden: [], widths: {} };

    const repaired = reconcileLayout(older, COLUMNS);

    expect(repaired.order).toHaveLength(COLUMNS.length);
    expect(repaired.order.slice(0, 3)).toEqual(["status", "studentId", "portal:FULL_NAME"]);
    expect(repaired.hidden).toContain("portal:ABSENCE_PER");
  });

  it("drops a column the portal no longer offers", () => {
    const repaired = reconcileLayout(
      { order: ["studentId", "portal:GONE"], hidden: ["portal:GONE"], widths: { "portal:GONE": 90 } },
      COLUMNS,
    );

    expect(repaired.order).not.toContain("portal:GONE");
    expect(repaired.hidden).not.toContain("portal:GONE");
    expect(repaired.widths["portal:GONE"]).toBeUndefined();
  });

  it("refuses to hide a column the row cannot be read without", () => {
    expect(toggleColumn(LAYOUT, "studentId", COLUMNS).hidden).not.toContain("studentId");
    expect(reconcileLayout({ hidden: ["studentId"] }, COLUMNS).hidden).not.toContain("studentId");
  });

  it("lets a column be squeezed to a sliver, but not to nothing", () => {
    const column = COLUMNS.find((candidate) => candidate.id === "portal:MAJOR_CODE_DESC")!;

    // No column has a width of its own to defend any more — the only floor is the one
    // that keeps the resize handle catchable.
    expect(widthOf(resizeColumn(LAYOUT, "portal:MAJOR_CODE_DESC", 40, COLUMNS), column)).toBe(40);
    expect(widthOf(resizeColumn(LAYOUT, "portal:MAJOR_CODE_DESC", 5, COLUMNS), column)).toBe(MIN_WIDTH);
    expect(reconcileLayout({ widths: { "portal:MAJOR_CODE_DESC": 10 } }, COLUMNS).widths["portal:MAJOR_CODE_DESC"]).toBe(
      MIN_WIDTH,
    );
  });

  it("falls back to the default when storage holds nonsense", () => {
    window.localStorage.setItem("scen-student-columns:v1", "not json");

    expect(visibleColumns(loadLayout(COLUMNS), COLUMNS)).toHaveLength(7);
  });
});

describe("moving a column", () => {
  it("shifts it one place, in either direction", () => {
    const moved = moveColumn(LAYOUT, "portal:FULL_NAME", -1);

    expect(moved.order.slice(0, 2)).toEqual(["portal:FULL_NAME", "status"]);
    expect(moveColumn(moved, "portal:FULL_NAME", 1).order.slice(0, 2)).toEqual([
      "status",
      "portal:FULL_NAME",
    ]);
  });

  it("does nothing at either end rather than wrapping around", () => {
    const first = LAYOUT.order[0];
    const last = LAYOUT.order[LAYOUT.order.length - 1];

    expect(moveColumn(LAYOUT, first, -1)).toBe(LAYOUT);
    expect(moveColumn(LAYOUT, last, 1)).toBe(LAYOUT);
  });

  it("drops a dragged column in front of the one it was dropped on", () => {
    const dropped = reorderColumn(LAYOUT, "cohortName", "status");

    expect(dropped.order[0]).toBe("cohortName");
    expect(dropped.order).toHaveLength(LAYOUT.order.length);
  });

  it("drags rightwards as well as leftwards", () => {
    const dropped = reorderColumn(LAYOUT, "status", "portal:MAJOR_CODE_DESC");

    expect(dropped.order.indexOf("status")).toBe(dropped.order.indexOf("portal:MAJOR_CODE_DESC") - 1);
  });

  it("leaves the order alone when a column is dropped on itself", () => {
    expect(reorderColumn(LAYOUT, "status", "status")).toBe(LAYOUT);
  });
});

describe("the values a column offers to the filter bar", () => {
  it("lists each distinct value once, labelled the way the cell reads", () => {
    const rows = [row(), row({ studentId: "A002", status: "not_in_portal" }), row({ studentId: "A003" })];
    const status = COLUMNS.find((column) => column.id === "status")!;

    expect(optionsFor(rows, status)).toEqual([
      { value: "in_portal", label: "In portal" },
      { value: "not_in_portal", label: "Not in portal" },
    ]);
  });

  it("leaves out the blanks, which are not a value anybody filters for", () => {
    const cohort = COLUMNS.find((column) => column.id === "cohortName")!;

    expect(optionsFor([row(), row({ cohortName: "L1" })], cohort)).toEqual([
      { value: "L1", label: "L1" },
    ]);
  });
});
