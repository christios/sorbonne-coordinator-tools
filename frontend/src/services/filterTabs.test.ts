import { beforeEach, describe, expect, it } from "vitest";

import { fitTab, loadTabs, matchesTab, newTabId, saveTabs, type FilterTab } from "@/services/filterTabs";
import type { FilterModel } from "@/services/tableFilter";

const year = (values: string[]): FilterModel => ({ columnId: "portal:YEARLEVEL_CODE", type: "option", operator: "is any of", values });
const groups = (values: string[]): FilterModel => ({ columnId: "groups", type: "multiOption", operator: "include any of", values });
const SORT = { key: "studentId", ascending: true };

const tab = (filters: FilterModel[], sort = SORT): FilterTab => ({ id: "t1", name: "First years", filters, sort });

beforeEach(() => window.localStorage.clear());

describe("keeping tabs in this browser", () => {
  it("gives them back after the page has been left and returned to", () => {
    saveTabs([tab([year(["FY"])])]);

    expect(loadTabs()).toEqual([tab([year(["FY"])])]);
  });

  it("starts with none", () => {
    expect(loadTabs()).toEqual([]);
  });

  it("drops a misshapen tab and keeps the rest, rather than breaking the strip", () => {
    window.localStorage.setItem(
      "scen-filter-tabs:v1",
      JSON.stringify([tab([year(["FY"])]), { name: "no id" }, { id: "x", name: "no filters", sort: SORT }]),
    );

    expect(loadTabs().map((held) => held.name)).toEqual(["First years"]);
  });

  it("ignores a stored file that is not ours", () => {
    window.localStorage.setItem("scen-filter-tabs:v1", "not json");

    expect(loadTabs()).toEqual([]);
  });

  it("gives a new tab an id nothing else has", () => {
    expect(newTabId([tab([])])).not.toBe("t1");
  });
});

describe("whether the table matches a tab", () => {
  it("matches the same filters in a different order, and the same values in a different order", () => {
    const saved = tab([year(["FY", "L1"]), groups(["TD 1"])]);

    expect(matchesTab(saved, [groups(["TD 1"]), year(["L1", "FY"])], SORT)).toBe(true);
  });

  it("does not match once a filter has been added, removed or changed", () => {
    const saved = tab([year(["FY"])]);

    expect(matchesTab(saved, [year(["FY"]), groups(["TD 1"])], SORT)).toBe(false);
    expect(matchesTab(saved, [], SORT)).toBe(false);
    expect(matchesTab(saved, [year(["L1"])], SORT)).toBe(false);
  });

  it("counts the sort as part of the way of looking", () => {
    const saved = tab([year(["FY"])], { key: "portal:FULL_NAME", ascending: true });

    expect(matchesTab(saved, [year(["FY"])], { key: "portal:FULL_NAME", ascending: false })).toBe(false);
    expect(matchesTab(saved, [year(["FY"])], { key: "portal:FULL_NAME", ascending: true })).toBe(true);
  });
});

describe("a tab from another day", () => {
  it("drops a filter on a column this table no longer has, rather than refusing the tab", () => {
    const saved = tab([year(["FY"]), { columnId: "portal:GONE", type: "text", operator: "contains", values: ["x"] }]);

    const fitted = fitTab(saved, new Set(["portal:YEARLEVEL_CODE", "studentId"]));

    expect(fitted.filters).toEqual([year(["FY"])]);
  });
});
