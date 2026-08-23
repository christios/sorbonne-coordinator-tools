import { describe, expect, it } from "vitest";

import {
  applyFilters,
  dateFilterFn,
  determineNewOperator,
  invertOperator,
  multiOptionFilterFn,
  numberFilterFn,
  optionFilterFn,
  textFilterFn,
  type FilterColumn,
  type FilterModel,
} from "@/services/tableFilter";

const filter = (over: Partial<FilterModel>): FilterModel => ({
  columnId: "c",
  type: "option",
  operator: "is",
  values: [],
  ...over,
});

describe("option filters", () => {
  it("matches on is, and refuses on is not", () => {
    expect(optionFilterFn("FY", filter({ operator: "is", values: ["FY"] }))).toBe(true);
    expect(optionFilterFn("L1", filter({ operator: "is", values: ["FY"] }))).toBe(false);
    expect(optionFilterFn("FY", filter({ operator: "is not", values: ["FY"] }))).toBe(false);
  });

  it("ignores case, the way the portal writes codes inconsistently", () => {
    expect(optionFilterFn("fy", filter({ operator: "is", values: ["FY"] }))).toBe(true);
  });

  it("lets everything through when nothing has been chosen yet", () => {
    expect(optionFilterFn("FY", filter({ operator: "is", values: [] }))).toBe(true);
  });

  it("answers any of and none of over several values", () => {
    const anyOf = filter({ operator: "is any of", values: ["FY", "L1"] });
    expect(optionFilterFn("L1", anyOf)).toBe(true);
    expect(optionFilterFn("L2", anyOf)).toBe(false);
    expect(optionFilterFn("L2", filter({ operator: "is none of", values: ["FY", "L1"] }))).toBe(true);
  });
});

describe("multi-option filters", () => {
  const held = ["a", "b"];

  it("separates any-of from all-of", () => {
    expect(multiOptionFilterFn(held, filter({ type: "multiOption", operator: "include any of", values: ["b", "z"] }))).toBe(true);
    expect(multiOptionFilterFn(held, filter({ type: "multiOption", operator: "include all of", values: ["b", "z"] }))).toBe(false);
    expect(multiOptionFilterFn(held, filter({ type: "multiOption", operator: "include all of", values: ["a", "b"] }))).toBe(true);
  });

  it("excludes on any and on all", () => {
    expect(multiOptionFilterFn(held, filter({ type: "multiOption", operator: "exclude if any of", values: ["b"] }))).toBe(false);
    expect(multiOptionFilterFn(held, filter({ type: "multiOption", operator: "exclude if all", values: ["a", "z"] }))).toBe(true);
  });
});

describe("text filters", () => {
  it("contains and does not contain, trimmed and case-folded", () => {
    expect(textFilterFn("Amira Haddad", filter({ type: "text", operator: "contains", values: [" amira "] }))).toBe(true);
    expect(textFilterFn("Amira Haddad", filter({ type: "text", operator: "does not contain", values: ["karim"] }))).toBe(true);
  });

  it("treats an empty search as no filter at all", () => {
    expect(textFilterFn("Amira", filter({ type: "text", operator: "contains", values: ["   "] }))).toBe(true);
  });
});

describe("number filters", () => {
  it("compares, and reads a range in either order", () => {
    expect(numberFilterFn(5, filter({ type: "number", operator: "is greater than", values: ["3"] }))).toBe(true);
    expect(numberFilterFn(5, filter({ type: "number", operator: "is between", values: ["9", "1"] }))).toBe(true);
    expect(numberFilterFn(12, filter({ type: "number", operator: "is not between", values: ["1", "9"] }))).toBe(true);
  });
});

describe("date filters", () => {
  const seen = "2026-08-22T14:30:00+00:00";

  it("compares whole days, not moments", () => {
    // The same day at a different hour is still "is", which is the point of the day cast.
    expect(dateFilterFn(seen, filter({ type: "date", operator: "is", values: ["2026-08-22T02:00:00Z"] }))).toBe(true);
    expect(dateFilterFn(seen, filter({ type: "date", operator: "is before", values: ["2026-08-23"] }))).toBe(true);
    expect(dateFilterFn(seen, filter({ type: "date", operator: "is on or after", values: ["2026-08-22"] }))).toBe(true);
  });

  it("reads a range in either order, and its negation", () => {
    expect(dateFilterFn(seen, filter({ type: "date", operator: "is between", values: ["2026-09-01", "2026-08-01"] }))).toBe(true);
    expect(dateFilterFn(seen, filter({ type: "date", operator: "is not between", values: ["2026-08-01", "2026-08-10"] }))).toBe(true);
  });

  it("refuses a row whose date cannot be read rather than letting it through", () => {
    expect(dateFilterFn("", filter({ type: "date", operator: "is", values: ["2026-08-22"] }))).toBe(false);
  });
});

describe("operators moving with the number of values", () => {
  it("becomes plural when a second value is chosen", () => {
    expect(determineNewOperator("option", ["FY"], ["FY", "L1"], "is")).toBe("is any of");
    expect(determineNewOperator("option", ["FY"], ["FY", "L1"], "is not")).toBe("is none of");
    expect(determineNewOperator("date", ["a"], ["a", "b"], "is")).toBe("is between");
  });

  it("falls back to singular when only one is left", () => {
    expect(determineNewOperator("option", ["FY", "L1"], ["FY"], "is any of")).toBe("is");
  });

  it("leaves the operator alone when the count does not cross one", () => {
    expect(determineNewOperator("option", ["FY", "L1"], ["L2", "L3"], "is none of")).toBe("is none of");
    expect(determineNewOperator("option", ["FY"], ["L1"], "is not")).toBe("is not");
  });

  it("inverts both ways", () => {
    expect(invertOperator("option", "is")).toBe("is not");
    expect(invertOperator("option", "is not")).toBe("is");
    expect(invertOperator("text", "contains")).toBe("does not contain");
  });
});

describe("applying several filters at once", () => {
  type Row = { id: string; year: string; name: string; seen: string };
  const rows: Row[] = [
    { id: "A1", year: "FY", name: "Amira", seen: "2026-08-22" },
    { id: "A2", year: "L1", name: "Karim", seen: "2026-07-01" },
    { id: "A3", year: "FY", name: "Nadia", seen: "2026-08-22" },
  ];
  const columns: FilterColumn<Row>[] = [
    { id: "year", displayName: "Year", type: "option", accessor: (row) => row.year },
    { id: "name", displayName: "Student", type: "text", accessor: (row) => row.name },
    { id: "seen", displayName: "Last seen", type: "date", accessor: (row) => row.seen },
  ];

  it("requires every filter to pass", () => {
    const kept = applyFilters(rows, columns, [
      filter({ columnId: "year", operator: "is", values: ["FY"] }),
      filter({ columnId: "name", type: "text", operator: "contains", values: ["nad"] }),
    ]);

    expect(kept.map((row) => row.id)).toEqual(["A3"]);
  });

  it("ignores a filter with no values, so a half-built chip hides nothing", () => {
    expect(applyFilters(rows, columns, [filter({ columnId: "year", values: [] })])).toHaveLength(3);
  });

  it("ignores a filter naming a column that is no longer shown", () => {
    expect(applyFilters(rows, columns, [filter({ columnId: "gone", values: ["x"] })])).toHaveLength(3);
  });
});
