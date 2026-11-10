import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FilterMenu, FilterPills } from "@/components/PanelFilter";

describe("a list's filters behind one button", () => {
  it("offers only what would leave something, and keeps a chosen one to let go", () => {
    const onToggle = vi.fn();
    render(
      <FilterMenu
        options={[
          { value: "over", label: "Over hours", count: 2 },
          { value: "no-crn", label: "No CRN", count: 0 },
          { value: "placed", label: "Fully placed", count: 0 },
        ]}
        chosen={["placed"]}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter: 1 chosen" }));
    expect(screen.getByRole("menuitemcheckbox", { name: /Over hours/ }).textContent).toContain("2");
    expect(screen.queryByRole("menuitemcheckbox", { name: /No CRN/ })).toBeNull();
    expect(screen.getByRole("menuitemcheckbox", { name: /Fully placed/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Over hours/ }));
    expect(onToggle).toHaveBeenCalledWith("over");
  });

  it("chooses a teacher in the same menu, among those with something to show", () => {
    const onChoose = vi.fn();
    render(
      <FilterMenu
        options={[]}
        chosen={[]}
        onToggle={() => {}}
        teachers={{
          options: [
            { value: "t-jad", label: "Jad Tarsissi", count: 3 },
            { value: "t-lama", label: "Lama Tarsissi", count: 0 },
          ],
          chosen: "",
          onChoose,
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByRole("menuitemradio", { name: /Lama/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Jad Tarsissi/ }));
    expect(onChoose).toHaveBeenCalledWith("t-jad");
  });

  it("keeps the shortcut to hand and the others chosen as pills", () => {
    const onShortcut = vi.fn();
    const onRemove = vi.fn();
    render(
      <FilterPills
        shortcut={{ label: "Still to place", count: 12 }}
        on={false}
        onShortcut={onShortcut}
        pills={[{ key: "over", label: "Over hours", onRemove }]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Still to place/ }));
    expect(onShortcut).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop filtering: Over hours" }));
    expect(onRemove).toHaveBeenCalled();
  });
});
