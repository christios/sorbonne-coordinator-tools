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
  it("starts on All students, and a new tab can always be made — even with nothing narrowed", async () => {
    renderStrip();

    expect(screen.getByRole("tab", { name: "All students" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tab")).toHaveLength(1);
    // The one control that makes a tab must never look dead.
    const make = screen.getByRole("button", { name: /New tab/ });
    expect(make.hasAttribute("disabled")).toBe(false);

    fireEvent.click(make);
    fireEvent.change(await screen.findByLabelText("Tab name"), { target: { value: "Scratch" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tab" }));

    expect(await screen.findByRole("tab", { name: /Scratch/ })).toBeTruthy();
    expect(loadTabs()[0]).toMatchObject({ name: "Scratch", filters: [] });
  });

  it("makes a tab from the current filters, named, and remembers it", async () => {
    renderStrip([year(["FY"])]);

    fireEvent.click(screen.getByRole("button", { name: /New tab/ }));
    fireEvent.change(await screen.findByLabelText("Tab name"), { target: { value: "First years" } });
    fireEvent.click(screen.getByRole("button", { name: "Create tab" }));

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

  it("keeps whatever is changed while a tab is open, the way a tab works anywhere", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);
    const { rerender } = render(
      <FilterTabs filters={[year(["FY"])]} sort={SORT} columnIds={COLUMNS} onApply={vi.fn()} />,
    );
    fireEvent.click(await screen.findByRole("tab", { name: /First years/ }));

    // Narrowed further while open: the tab now holds two filters, with nothing pressed.
    rerender(
      <FilterTabs
        filters={[year(["FY"]), { columnId: "groups", type: "multiOption", operator: "include any of", values: ["TD 1"] }]}
        sort={SORT}
        columnIds={COLUMNS}
        onApply={vi.fn()}
      />,
    );

    expect(loadTabs()[0].filters).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Update/ })).toBeNull();
  });

  it("does not touch a tab that is not open", async () => {
    saveTabs([{ id: "t1", name: "First years", filters: [year(["FY"])], sort: SORT }]);

    // On All students, narrowing the table changes nothing stored.
    render(<FilterTabs filters={[year(["L1"])]} sort={SORT} columnIds={COLUMNS} onApply={vi.fn()} />);

    expect(loadTabs()[0].filters).toEqual([year(["FY"])]);
  });
});
