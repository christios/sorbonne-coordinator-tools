import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./SelectMenu";

describe("SelectMenu", () => {
  it("shows its options in the branded menu and returns the selected value", () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Starting point" value="" onChange={onChange} placeholder="Blank syllabus" options={[{ value: "", label: "Blank syllabus" }, { value: "source", label: "2025-2026 — Climate Change Law" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Starting point" }));
    expect(screen.getByRole("listbox", { name: "Starting point" })).toBeTruthy();

    fireEvent.click(screen.getByRole("option", { name: "2025-2026 — Climate Change Law" }));
    expect(onChange).toHaveBeenCalledWith("source");
  });

  it("allows several PLOs to be selected without closing the menu", () => {
    const onChange = vi.fn();
    render(<SelectMenu label="Aligned PLOs" value="PLO 1" onChange={onChange} multiple options={[{ value: "PLO 1", label: "PLO 1: First outcome" }, { value: "PLO 2", label: "PLO 2: Second outcome" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Aligned PLOs" }));
    fireEvent.click(screen.getByRole("option", { name: "PLO 2: Second outcome" }));

    expect(onChange).toHaveBeenCalledWith("PLO 1\nPLO 2");
    expect(screen.getByRole("listbox", { name: "Aligned PLOs" })).toBeTruthy();
  });

  it("places the chevron at the control edge unless a trailing control occupies that space", () => {
    const { container, rerender } = render(
      <SelectMenu label="Move syllabus" value="unfiled" onChange={vi.fn()} options={[{ value: "unfiled", label: "Unfiled" }]} />,
    );

    expect(container.querySelector("button")?.getAttribute("class")).toContain("pr-10");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("right-3");

    rerender(
      <SelectMenu label="Field with history" value="unfiled" onChange={vi.fn()} options={[{ value: "unfiled", label: "Unfiled" }]} trailing={<span>History</span>} />,
    );

    expect(container.querySelector("button")?.getAttribute("class")).toContain("pr-20");
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("right-10");
  });

  it("filters a searchable shared menu instead of falling back to a native select", () => {
    render(<SelectMenu label="Course catalogue" value="" onChange={vi.fn()} searchable options={[{ value: "1", label: "Physics — PHY-101 · CRN 21939" }, { value: "2", label: "Mathematics — MAT-101 · CRN 21940" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Course catalogue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search Course catalogue" }), { target: { value: "physics" } });

    expect(screen.getByRole("option", { name: "Physics — PHY-101 · CRN 21939" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Mathematics — MAT-101 · CRN 21940" })).toBeNull();
  });

  it("matches searchable options when punctuation in a course code is omitted", () => {
    render(<SelectMenu label="Course catalogue" value="" onChange={vi.fn()} searchable required options={[{ value: "1", label: "A Digital History Grp1 — RMAS-304", searchText: "23442" }]} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Course catalogue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search Course catalogue" }), { target: { value: "rmas 304" } });

    expect(screen.getByRole("combobox", { name: "Course catalogue" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("option", { name: "A Digital History Grp1 — RMAS-304" })).toBeTruthy();
  });

  it("ports a long request menu above a constrained editor workspace instead of clipping it", () => {
    const { container } = render(
      <SelectMenu label="Job title" value="" onChange={vi.fn()} options={[
        { value: "lecturer", label: "Part Time Lecturer" },
        { value: "researcher", label: "Researcher" },
        { value: "assistant", label: "Research Assistant" },
        { value: "teaching", label: "Teaching Assistant" },
        { value: "support", label: "Research Support Assistant" },
        { value: "administrative", label: "Administrative Role - PT" },
      ]} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Job title" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 780,
      height: 40,
      left: 0,
      right: 320,
      toJSON: () => ({}),
      top: 740,
      width: 320,
      x: 0,
      y: 740,
    });
    const previousInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });

    try {
      fireEvent.click(trigger);
      const menu = screen.getByRole("listbox", { name: "Job title" });

      expect(container.contains(menu)).toBe(false);
      expect(menu.closest("[data-select-menu-placement]")?.getAttribute("data-select-menu-placement")).toBe("top");
      expect(menu.style.width).toBe("var(--radix-popover-trigger-width)");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousInnerHeight });
    }
  });
});
