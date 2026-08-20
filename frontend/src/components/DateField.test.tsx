import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { chooseCalendarPlacement } from "./dateFieldPlacement";
import { DateField } from "./DateField";

describe("DateField", () => {
  it("opens an in-app calendar picker from the compact date control", () => {
    const onChange = vi.fn();
    render(<DateField label="Contract from" value="2026-09-01" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Contract from" });
    expect(trigger.classList.contains("h-9")).toBe(true);

    fireEvent.click(trigger);
    const calendar = screen.getByRole("grid", { name: "Contract from calendar" });
    expect(calendar).toBeTruthy();
    expect(calendar.closest("[data-calendar-placement]")?.getAttribute("data-calendar-placement")).toBe("bottom");
    fireEvent.click(screen.getByRole("gridcell", { name: "Select 15 Sept 2026" }));

    expect(onChange).toHaveBeenCalledWith("2026-09-15");
  });

  it("keeps optional trailing controls inside the shared date field", () => {
    render(<DateField label="Assessment date" value="" onChange={vi.fn()} trailing={<button type="button">History</button>} />);

    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
  });

  it("chooses the only fully visible side for the calendar before opening", () => {
    expect(chooseCalendarPlacement({ availableAbove: 430, availableBelow: 250 })).toEqual({
      side: "top",
      maxHeight: 422,
    });
    expect(chooseCalendarPlacement({ availableAbove: 190, availableBelow: 430 })).toEqual({
      side: "bottom",
      maxHeight: 422,
    });
  });

  it("keeps the selected calendar side after the month changes", () => {
    const onChange = vi.fn();
    render(<DateField label="Contract from" value="2026-09-01" onChange={onChange} />);

    const trigger = screen.getByRole("button", { name: "Contract from" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 700,
      height: 36,
      left: 0,
      right: 280,
      toJSON: () => ({}),
      top: 664,
      width: 280,
      x: 0,
      y: 664,
    });
    const previousInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });

    try {
      fireEvent.click(trigger);
      const calendar = screen.getByRole("grid", { name: "Contract from calendar" });
      const content = calendar.closest("[data-calendar-placement]");
      expect(content?.getAttribute("data-calendar-placement")).toBe("top");

      fireEvent.click(screen.getByRole("button", { name: "Next month" }));
      expect(content?.getAttribute("data-calendar-placement")).toBe("top");
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: previousInnerHeight });
    }
  });
});
