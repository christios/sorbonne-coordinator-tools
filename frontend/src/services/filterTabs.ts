/**
 * Named arrangements of the Students table, kept so a way of looking is one click away.
 *
 * A coordinator narrows the table the same few ways every week — first years with no
 * group, everyone the last sync brought in, the withdrawn who still hold a seat — and
 * rebuilding the filters each time is the same work each time. A tab holds the filters
 * and the sort, and opening it puts them back.
 *
 * The search box is deliberately not part of a tab: it is what you type to find one
 * student, not a way of looking at all of them.
 *
 * Kept in this browser, like the column layout and the copy presets: a few hundred bytes,
 * and only column ids and values — no student data.
 */

import type { FilterModel } from "@/services/tableFilter";

const KEY = "scen-filter-tabs:v1";

export type TabSort = { key: string; ascending: boolean };

export type FilterTab = {
  id: string;
  name: string;
  filters: FilterModel[];
  sort: TabSort;
};

export function loadTabs(): FilterTab[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const held = JSON.parse(raw) as unknown;
    if (!Array.isArray(held)) return [];
    // A stored file outlives the code that wrote it: anything misshapen is dropped.
    return held.filter(
      (tab): tab is FilterTab =>
        Boolean(tab && typeof tab.id === "string" && typeof tab.name === "string") &&
        Array.isArray(tab.filters) &&
        Boolean(tab.sort && typeof tab.sort.key === "string"),
    );
  } catch {
    return [];
  }
}

export function saveTabs(tabs: FilterTab[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(tabs));
  } catch {
    // A preference that cannot be remembered must never break the table.
  }
}

export function newTabId(existing: FilterTab[]): string {
  const taken = new Set(existing.map((tab) => tab.id));
  let candidate = `tab-${Date.now()}`;
  let suffix = 1;
  while (taken.has(candidate)) candidate = `tab-${Date.now()}-${suffix++}`;
  return candidate;
}

/** The same filters, whatever order they were added in. */
function filterKey(filters: FilterModel[]): string {
  return filters
    .map((filter) => `${filter.columnId}|${filter.type}|${filter.operator}|${[...filter.values].sort().join("")}`)
    .sort()
    .join("");
}

/**
 * Whether the table as it stands is what a tab holds — so the strip can show which tab
 * is open, and whether it has been changed since.
 */
export function matchesTab(tab: FilterTab, filters: FilterModel[], sort: TabSort): boolean {
  return filterKey(tab.filters) === filterKey(filters) && tab.sort.key === sort.key && tab.sort.ascending === sort.ascending;
}

/** Drop the parts of a tab's filters that name columns this table does not have. */
export function fitTab(tab: FilterTab, columnIds: Set<string>): FilterTab {
  return { ...tab, filters: tab.filters.filter((filter) => columnIds.has(filter.columnId)) };
}
