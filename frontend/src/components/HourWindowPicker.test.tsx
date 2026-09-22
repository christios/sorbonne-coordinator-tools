import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HourWindowPicker } from "@/components/HourWindowPicker";
import { WHOLE_SEMESTER, windowForPeriod, windowForRange } from "@/services/hourWindow";

function open(window = WHOLE_SEMESTER, onChange = vi.fn()) {
  render(<HourWindowPicker window={window} periods={["2026-09-15", "2026-08-15"]} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "What to count" }));
  return onChange;
}

/** A day's square, which is labelled by its own date. */
const square = (day: string) => screen.getByRole("button", { name: day });

describe("choosing what to count", () => {
  it("offers the semester's pay periods by name", () => {
    open();

    expect(screen.getByText("15 Sep – 14 Oct 2026")).toBeTruthy();
    expect(screen.getByText("15 Aug – 14 Sep 2026")).toBeTruthy();
  });

  it("takes a period in one press", () => {
    const onChange = open();

    fireEvent.click(screen.getByText("15 Sep – 14 Oct 2026"));

    expect(onChange).toHaveBeenCalledWith(windowForPeriod("2026-09-15"));
  });

  it("takes any two dates, in either order", () => {
    const onChange = open();

    fireEvent.click(square("2026-09-19"));
    fireEvent.click(square("2026-09-03"));

    expect(onChange.mock.calls[0][0]).toMatchObject({ from: "2026-09-03", to: "2026-09-19" });
  });
});

describe("while a range is being drawn", () => {
  it("shows what it would be, following the pointer", () => {
    open();
    fireEvent.click(square("2026-09-03"));

    fireEvent.mouseEnter(square("2026-09-07"));

    // Between the held day and the pointer, so the range is visible before it is taken.
    expect(square("2026-09-05").className).toContain("#eef4fa");
    expect(square("2026-09-07").className).toContain("#1f4e79");
    // Beyond the pointer, nothing.
    expect(square("2026-09-09").className).not.toContain("#eef4fa");
  });

  it("follows the pointer backwards too", () => {
    open();
    fireEvent.click(square("2026-09-20"));

    fireEvent.mouseEnter(square("2026-09-16"));

    expect(square("2026-09-18").className).toContain("#eef4fa");
  });

  it("says which end it is waiting for", () => {
    open();
    expect(screen.getByText(/Press the day it starts on/)).toBeTruthy();

    fireEvent.click(square("2026-09-03"));

    expect(screen.getByText("And the day it ends on.")).toBeTruthy();
  });
});

describe("what the control shows as chosen", () => {
  it("draws a range on the calendar, so it can be seen before it is changed", () => {
    open(windowForRange("2026-09-15", "2026-10-14"));

    expect(square("2026-09-15").className).toContain("#1f4e79");
    expect(square("2026-09-20").className).toContain("#eef4fa");
  });

  it("leaves the calendar blank when a named period is chosen, and ticks the period", () => {
    // Two things looking selected at once leaves no way to tell which one the control
    // would act on.
    open(windowForPeriod("2026-09-15"));

    expect(square("2026-09-20").className).not.toContain("#eef4fa");
    expect(square("2026-09-15").className).not.toContain("#1f4e79");
  });

  it("ticks no period once a range is drawn over the same dates", () => {
    const { container } = render(
      <HourWindowPicker window={windowForRange("2026-09-15", "2026-10-14")} periods={["2026-09-15"]} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "What to count" }));

    expect(container.ownerDocument.body.querySelectorAll(".font-semibold.text-\\[\\#1f4e79\\]").length).toBe(0);
  });
});
