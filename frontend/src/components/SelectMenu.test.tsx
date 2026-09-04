import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

import { SelectMenu } from "./SelectMenu";

/** The menu arms its outside-click listener on the next tick, so tests wait for it. */
async function armed() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
}

/** A pointerdown that carries a target, which jsdom's PointerEvent does not. */
function pointerDownOn(target: Node) {
  fireEvent(target, new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
}

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

  it("closes when the pointer goes down somewhere else", async () => {
    render(
      <div>
        <p>elsewhere</p>
        <SelectMenu label="Year level" value="" onChange={vi.fn()} options={[{ value: "FY", label: "FY" }]} />
      </div>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Year level" }));
    expect(screen.getByRole("listbox", { name: "Year level" })).toBeTruthy();
    await armed();

    pointerDownOn(screen.getByText("elsewhere"));

    expect(screen.queryByRole("listbox", { name: "Year level" })).toBeNull();
  });

  it("closes on an outside click even when it was opened from inside a portal", async () => {
    // The bug this pins: in the sync-settings dialog — itself a portal — Radix's own
    // dismissal never fired, and the menu stayed open however far away you clicked.
    function InADialog() {
      return createPortal(
        <div>
          <p>dialog body</p>
          <SelectMenu label="Year level" value="" onChange={vi.fn()} options={[{ value: "FY", label: "FY" }]} />
        </div>,
        document.body,
      );
    }
    render(<InADialog />);
    fireEvent.click(screen.getByRole("combobox", { name: "Year level" }));
    await armed();

    pointerDownOn(screen.getByText("dialog body"));

    expect(screen.queryByRole("listbox", { name: "Year level" })).toBeNull();
  });

  it("stays open when the pointer goes down on one of its own options", async () => {
    const onChange = vi.fn();
    render(
      <SelectMenu
        label="Aligned PLOs"
        value=""
        onChange={onChange}
        multiple
        options={[{ value: "PLO 1", label: "PLO 1" }, { value: "PLO 2", label: "PLO 2" }]}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Aligned PLOs" }));
    await armed();

    const option = screen.getByRole("option", { name: "PLO 2" });
    pointerDownOn(option);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith("PLO 2");
    expect(screen.getByRole("listbox", { name: "Aligned PLOs" })).toBeTruthy();
  });

  it("does not close itself on the very press that opened it", async () => {
    render(<SelectMenu label="Year level" value="" onChange={vi.fn()} options={[{ value: "FY", label: "FY" }]} />);

    const trigger = screen.getByRole("combobox", { name: "Year level" });
    pointerDownOn(trigger);
    fireEvent.click(trigger);
    await armed();

    expect(screen.getByRole("listbox", { name: "Year level" })).toBeTruthy();
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
      expect(menu.style.minWidth).toBe("var(--radix-popover-trigger-width)");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousInnerHeight });
    }
  });
});

describe("a multi-select says what is chosen", () => {
  const options = [
    { value: "FY", label: "FY" },
    { value: "L1", label: "L1" },
    { value: "L2", label: "L2" },
    { value: "L3", label: "L3" },
    { value: "M1", label: "M1" },
  ];

  it("shows each chosen value as its own pill rather than counting them", () => {
    render(<SelectMenu label="Year" multiple itemNoun="value" value={"FY\nL1"} onChange={() => {}} options={options} />);

    const trigger = screen.getByRole("combobox", { name: "Year" });
    const pills = [...trigger.querySelectorAll("span.rounded-full")].map((pill) => pill.textContent);
    expect(pills).toEqual(["FY", "L1"]);
    expect(screen.queryByText(/values selected/)).toBeNull();
  });

  it("folds the tail into one +N pill once there are more than a few", () => {
    render(<SelectMenu label="Year" multiple itemNoun="value" value={"FY\nL1\nL2\nL3\nM1"} onChange={() => {}} options={options} />);

    const trigger = screen.getByRole("combobox", { name: "Year" });
    const pills = [...trigger.querySelectorAll("span.rounded-full")].map((pill) => pill.textContent);
    expect(pills).toEqual(["FY", "L1", "L2", "+2"]);
    // The whole list is still there for anyone who hovers.
    expect(trigger.querySelector("[title]")?.getAttribute("title")).toContain("FY, L1, L2, L3, M1");
  });
});
