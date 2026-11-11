import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WeekTimeline, type GridEditing } from "@/components/WeekTimeline";
import type { CalendarCourse, PlacedSession } from "@/services/weekSchedule";

const COURSE: CalendarCourse = {
  crn: "22229", code: "MATH-002", title: "Elements of Calculus", label: "MATH-002", group: "GA", staff: "Bilal Maaz",
  tone: "solid", color: "#1f4e79", openable: true,
};
const BROKEN = "Constraint · Bilal Maaz: Tue 14:00–18:00 · every week — “School run”\nPreference · Bilal Maaz: At most 2 days on campus";
const SESSION: PlacedSession = {
  crn: "22229", date: "2027-01-12", start: "15:00", end: "16:30", room: "5.111", clashes: false, wish: { level: "must", said: BROKEN },
};
const DRAG = "application/x-plan-section";

const week = (editing: Partial<GridEditing> = {}) =>
  render(
    <WeekTimeline
      weekStart={new Date(2027, 0, 11)}
      sessions={[SESSION]}
      courses={new Map([["22229", COURSE]])}
      today="2027-01-01"
      widthZoom={1}
      heightZoom={1}
      editing={{ onDraw: () => {}, onMove: () => {}, onOpen: () => {}, ...editing }}
    />,
  );

describe("a class on the plan's week", () => {
  it("says the class on its hover, and the wishes it breaks in its flag's bubble", async () => {
    const { container } = week();
    const box = container.querySelector("[data-box]") as HTMLElement;
    expect(box.getAttribute("title")).toContain("MATH-002");
    expect(box.getAttribute("title")).not.toContain("Constraint");
    const flag = container.querySelector("[data-flag]") as HTMLElement;
    expect(flag.getAttribute("title")).toBeNull();
    fireEvent.focus(flag);
    const bubble = await screen.findByRole("tooltip");
    expect(bubble.textContent).toContain("Breaks a constraint and a preference");
    expect(bubble.textContent).toContain("Tue 14:00–18:00 · every week — “School run”");
    expect(bubble.textContent).toContain("At most 2 days on campus");
  });

  it("shows where a class dragged in would land, at its own length, red where it would clash", async () => {
    const judge = vi.fn(() => ({ worst: "must" as const, label: "Clash", said: "Same teacher as PHYS-126 · CM" }));
    const { container } = week({
      dropType: DRAG,
      onDrop: () => {},
      // An hour long, whatever the usual block.
      dropSlot: (slot) => ({ ...slot, end: `${String(Number(slot.start.slice(0, 2)) + 1).padStart(2, "0")}${slot.start.slice(2)}` }),
      judge,
    });
    const tuesday = screen.getByLabelText(/Tue.*drag along the hours to place a class/);
    const over = createEvent.dragOver(tuesday, { dataTransfer: { types: [DRAG], getData: () => "" } });
    Object.defineProperty(over, "clientX", { value: 40 });
    fireEvent(tuesday, over);
    const ghost = container.querySelector("[data-ghost]") as HTMLElement;
    expect(ghost.getAttribute("data-ghost")).toBe("must");
    expect(ghost.textContent).toMatch(/^(\d\d):(\d\d)–\d\d:\2· Clash$/);
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ date: "2027-01-12" }), null);
    // And what is wrong there, in the ⓘ's bubble beside it.
    expect((await screen.findByRole("tooltip")).textContent).toContain("Same teacher as PHYS-126 · CM");

    // Gone once the drag ends, wherever it ends.
    fireEvent(window, new Event("dragend"));
    expect(container.querySelector("[data-ghost]")).toBeNull();
  });
});
