import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FilterTabs } from "@/components/FilterTabs";
import { loadTabs, saveTabs } from "@/services/filterTabs";
import type { FilterModel } from "@/services/tableFilter";

const year = (values: string[]): FilterModel => ({ columnId: "portal:YEARLEVEL_CODE", type: "option", operator: "is any of", values });
const SORT = { key: "studentId", ascending: true };
const COLUMNS = new Set(["studentId", "portal:YEARLEVEL_CODE", "groups"]);

function renderStrip(filters: FilterModel[] = [], sort = SORT) {
  const onApply = vi.fn();
  render(<FilterTabs filters={filters} sort={sort} columnIds={COLUMNS} onApply={onApply} />);
  return onApply;
}

beforeEach(() => window.localStorage.clear());

describe("the filter tabs", () => {
  it("starts on All students, with nothing else until something is saved", () => {
    renderStrip();

    expect(screen.getByRole("tab", { name: "All students" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    // Nothing to save when nothing is narrowed.
    expect(screen.getByRole("button", { name: /Save as tab/ }).hasAttribute("disabled")).toBe(true);
  });

  it("saves the current filters as a named tab, and remembers it", async () => {
    renderStrip([year(["FY"])]);

    fireEvent.click(screen.getByRole("button", { name: /Save as tab/ }));
    fireEvent.change(await screen.findByLabelText("Tab name"), { target: { value: "First years" } });
    fireEvent.click(screen.getByRole("button", { name: "Save tab" }));

    expect(await screen.findByRole("tab", { name: /First years/ })).toBeTruthy();
    expect(loadTabs()[0]).toMatchObject({ name: "First years", filters: [year(["FY"])], sort: SORT });
  });

  it("puts a tab's filters and sort back when opened", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: { key: "groups", ascending: false } }]);
    const onApply = renderStrip();

    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));

    expect(onApply).toHaveBeenCalledWith([year(["FY"])], { key: "groups", ascending: false });
  });

  it("goes back to everyone when All students is chosen", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);
    const onApply = renderStrip([year(["FY"])]);
    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));

    fireEvent.click(screen.getByRole("tab", { name: "All students" }));

    expect(onApply).toHaveBeenLastCalledWith([], { key: "studentId", ascending: true });
  });

  it("leaves out a filter on a column this table does not have", async () => {
    saveTabs([
      {
        id: "t1",
        name: "Old",
        filters: [year(["FY"]), { columnId: "portal:GONE", type: "text", operator: "contains", values: ["x"] }],
        sort: SORT,
      },
    ]);
    const onApply = renderStrip();

    fireEvent.click(await screen.findByRole("tab", { name: /Old/ }));

    expect(onApply.mock.calls[0][0]).toEqual([year(["FY"])]);
  });

  it("renames a tab", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);
    renderStrip([year(["FY"])]);
    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));

    fireEvent.click(screen.getByRole("button", { name: "Rename First years" }));
    fireEvent.change(await screen.findByLabelText("Tab name"), { target: { value: "FY" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect(await screen.findByRole("tab", { name: /^FY/ })).toBeTruthy();
    expect(loadTabs()[0].name).toBe("FY");
  });

  it("deletes a tab, after asking, and goes back to everyone", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);
    const onApply = renderStrip([year(["FY"])]);
    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));

    fireEvent.click(screen.getByRole("button", { name: "Delete First years" }));
    fireEvent.click(await screen.findByRole("button", { name: /Delete tab/ }));

    expect(screen.queryByRole("tab", { name: /First years/ })).toBeNull();
    expect(loadTabs()).toEqual([]);
    expect(onApply).toHaveBeenLastCalledWith([], { key: "studentId", ascending: true });
  });

  it("offers to update a tab once the table has drifted from it", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);
    // Opened, then narrowed further: the table now holds two filters.
    const { rerender } = render(
      <FilterTabs filters={[year(["FY"])]} sort={SORT} columnIds={COLUMNS} onApply={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));
    expect(screen.queryByRole("button", { name: /Update First years/ })).toBeNull();

    rerender(
      <FilterTabs
        filters={[year(["FY"]), { columnId: "groups", type: "multiOption", operator: "include any of", values: ["TD 1"] }]}
        sort={SORT}
        columnIds={COLUMNS}
        onApply={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Update First years/ }));
    expect(loadTabs()[0].filters).toHaveLength(2);
  });
});
