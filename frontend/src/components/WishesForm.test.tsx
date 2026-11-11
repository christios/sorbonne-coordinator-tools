import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WishesForm } from "@/components/WishesForm";
import type { WishCalendar, WishCollection, Wishes } from "@/services/teacherWishes";

const COLLECTION: WishCollection = {
  termCode: "262720",
  deadline: "2026-12-10",
  message: "",
  days: [1, 2, 3, 4, 5],
  firstHour: 8,
  lastHour: 19,
  mustQuota: 2,
  cantCap: 3,
  openedAt: "",
  openedBy: "",
};

const cell = (day: string, clock: string) => screen.getByRole("button", { name: new RegExp(`^${day} ${clock}: `) });
const said = (day: string, clock: string) => cell(day, clock).getAttribute("aria-label") ?? "";
/** A stroke from one cell to another, let go at the end. */
const stroke = (day: string, from: string, to: string) => {
  fireEvent.pointerDown(cell(day, from));
  if (to !== from) fireEvent.pointerOver(cell(day, to));
  fireEvent.pointerUp(window);
};
/** A press and a release on a painted cell, without moving: it opens that block. */
const openBlock = (day: string, clock: string) => {
  fireEvent.pointerDown(cell(day, clock));
  fireEvent.pointerUp(window);
  return screen.getByRole("dialog");
};

describe("a teacher's wishes, filled in", () => {
  beforeEach(() => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
  });
  it("paints every hour a quick drag passes over, and opens the block it made when let go", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    // Straight from 14:00 to 17:00: the pointer never stopped on 15:00 or 16:00.
    stroke("Tuesday", "14:00", "17:00");
    for (const clock of ["14:00", "15:00", "16:00", "17:00"]) expect(said("Tuesday", clock)).toContain("can't teach");
    expect(said("Tuesday", "18:00")).toContain("fine");
    const block = screen.getByRole("dialog", { name: "Can't teach Tue 14:00–18:00" });
    expect(block.textContent).toContain("One preference: the whole block");
  });

  it("opens nothing after clearing", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    stroke("Tuesday", "14:00", "15:00");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("radio", { name: "Clear" }));
    stroke("Tuesday", "14:00", "14:00");
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is painted from the keyboard too, and a painted hour opens its block from there", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    // Enter or Space on a cell is a click with no pointer behind it.
    fireEvent.click(cell("Monday", "09:00"));
    expect(said("Monday", "09:00")).toContain("can't teach");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(cell("Monday", "09:00"));
    expect(screen.getByRole("dialog", { name: "Can't teach Mon 09:00–10:00" })).toBeTruthy();
  });

  it("says what a click does over a painted block, and lights all of it", async () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    fireEvent.click(cell("Tuesday", "14:00"));
    fireEvent.click(cell("Thursday", "14:00"));
    fireEvent.pointerOver(cell("Tuesday", "14:00"));
    const bubble = await screen.findByRole("tooltip");
    expect(bubble.textContent).toContain("Click to set Must / Would like, comment or remove");
    expect(bubble.textContent).toContain("on Tue and Thu: one preference");
    // Both days of the block are lit, not only the hour under the pointer.
    for (const day of ["Tuesday", "Thursday"]) {
      expect(cell(day, "14:00").querySelector("[data-quarter]")?.className).toContain("brightness");
    }
  });

  it("says on the week itself how much a block matters and why, and keeps both", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    stroke("Tuesday", "14:00", "17:00");
    expect(said("Tuesday", "15:00")).toContain("a Would like");

    const block = screen.getByRole("dialog");
    fireEvent.click(within(block).getByRole("radio", { name: "Must" }));
    fireEvent.change(within(block).getByPlaceholderText("Why it matters (optional)"), { target: { value: "School run" } });
    fireEvent.click(within(block).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Drawn solid now, as a Must.
    expect(said("Tuesday", "14:00")).toContain("a Must");
    expect(screen.getByLabelText("1 of 2 Musts used")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ levels: { "cant:14-18:2": "must" }, comments: { "cant:14-18:2": "School run" }, submit: false }),
    );
    // Kept to the quarter: four quarters an hour.
    expect(onSave.mock.calls[0][0].cells).toHaveLength(16);
  });

  it("is painted to the quarter hour with finer cells", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("radio", { name: "15 min" }));
    stroke("Wednesday", "12:15", "12:30");
    expect(screen.getByRole("dialog", { name: "Can't teach Wed 12:15–12:45" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave.mock.calls[0][0].cells).toEqual([
      { day: 3, hour: 12.25, kind: "cant" },
      { day: 3, hour: 12.5, kind: "cant" },
    ]);
  });

  it("opens an answer painted to the quarter with cells fine enough to show it", () => {
    const initial = {
      status: "draft" as const, cells: [{ day: 3, hour: 12.5, kind: "cant" as const }], limits: {}, away: [], needs: "", note: "",
      levels: {}, comments: {}, lines: [], overCapReason: "", source: "coordinator", submittedAt: "", updatedAt: "", updatedBy: "",
    };
    render(<WishesForm collection={COLLECTION} initial={initial} onSave={() => {}} />);
    expect(screen.getByRole("radio", { name: "15 min" }).getAttribute("aria-checked")).toBe("true");
    expect(said("Wednesday", "12:30")).toContain("can't teach");
  });

  it("takes a whole block away from its pop-over", () => {
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    stroke("Thursday", "10:00", "11:00");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Remove the whole block" }));
    expect(said("Thursday", "10:00")).toContain("fine");
    expect(said("Thursday", "11:00")).toContain("fine");
  });

  it("keeps to the Must quota across the week and the limits, and asks why past the can't-teach cap", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={onSave} />);
    // Four blocks at four different hours: four wishes (the same hours on two days would be one).
    for (const [day, clock] of [["Monday", "09:00"], ["Wednesday", "11:00"], ["Friday", "13:00"], ["Thursday", "16:00"]] as const) {
      fireEvent.click(cell(day, clock));
    }
    fireEvent.click(within(openBlock("Monday", "09:00")).getByRole("radio", { name: "Must" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(within(openBlock("Wednesday", "11:00")).getByRole("radio", { name: "Must" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Two of two used: a third block waits until one is let go.
    const third = openBlock("Friday", "13:00");
    expect((within(third).getByRole("radio", { name: "Must" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(third).getByText(/All 2 Musts are used/)).toBeTruthy();
    fireEvent.click(within(third).getByRole("button", { name: "Done" }));

    // Four hours can't be taught, over the cap of three: not without a reason.
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/Say why 4 hours can't be taught/)).toBeTruthy();
    // A draft is kept as it stands.
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
  });

  it("tells whoever holds it when it has changed, and when it is back as it was", () => {
    const onDirtyChange = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(cell("Monday", "09:00"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(openBlock("Monday", "09:00")).getByRole("button", { name: "Remove the whole block" }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("time away, marked week by week", () => {
  beforeEach(() => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
  });
  // Week by week opens on the first teaching week still to come: from here, Week 1.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 10));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const CALENDAR: WishCalendar = { weekOne: "2027-01-11", weeks: 3, without: [], holidays: [{ date: "2027-01-13", label: "Holiday" }] };
  /** A cell of a single week, by its day and date: "Tuesday 12 Jan 14:00". */
  const dated = (day: string, clock: string) => screen.getByRole("button", { name: new RegExp(`^${day} ${clock}: `) });

  it("paints the hours away on the week's own dates, a whole day from its name, and saves them with their hours", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole("radio", { name: "Week by week" }));
    // The first teaching week still to come; its dates on the days, a holiday not to be painted.
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan: time away" })).toBeTruthy();
    expect((dated("Wednesday 13 Jan", "10:00") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.pointerDown(dated("Tuesday 12 Jan", "14:00"));
    fireEvent.pointerOver(dated("Tuesday 12 Jan", "15:00"));
    fireEvent.pointerUp(window);
    expect(dated("Tuesday 12 Jan", "15:00").getAttribute("aria-label")).toContain("away");
    // Let go, the day opens to say why.
    const tuesday = screen.getByRole("dialog", { name: "Away Tuesday 12 Jan" });
    expect(tuesday.textContent).toContain("14:00–16:00");
    fireEvent.change(within(tuesday).getByRole("textbox"), { target: { value: "Doctor" } });
    fireEvent.click(within(tuesday).getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Thursday 14 Jan: mark away all day" }));
    const thursday = screen.getByRole("dialog", { name: "Away Thursday 14 Jan" });
    expect(thursday.textContent).toContain("All day");
    fireEvent.change(within(thursday).getByRole("textbox"), { target: { value: "Conference" } });
    fireEvent.click(within(thursday).getByRole("button", { name: "Done" }));

    // The usual week is not touched: back on it, nothing is painted.
    fireEvent.click(screen.getByRole("radio", { name: "Every week" }));
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(screen.getByLabelText("Time away").textContent).toContain("Tue 12 Jan, 14:00–16:00");

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        cells: [],
        away: [
          { from: "2027-01-12", to: "2027-01-12", reason: "Doctor", start: 14, end: 16 },
          { from: "2027-01-14", to: "2027-01-14", reason: "Conference" },
        ],
      }),
    );
  });

  it("opens an answer's time away on its week, and takes it off from the list", () => {
    const onSave = vi.fn();
    const onDirtyChange = vi.fn();
    const answer = {
      status: "draft", cells: [], limits: {}, away: [{ from: "2027-01-18", to: "2027-01-22", reason: "Leave" }], needs: "", note: "",
      levels: {}, comments: {}, lines: [], overCapReason: "", source: "coordinator", submittedAt: "", updatedAt: "", updatedBy: "",
    } as Wishes;
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer} onSave={onSave} onDirtyChange={onDirtyChange} />);
    // A week of leave reads as one stretch, and opening it changes nothing.
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Mon 18 Jan–Fri 22 Jan" }));
    expect(screen.getByRole("table", { name: "Week 2 · 18 Jan–22 Jan: time away" })).toBeTruthy();
    expect(dated("Monday 18 Jan", "09:00").getAttribute("aria-label")).toContain("away");

    fireEvent.click(screen.getByRole("button", { name: "Not away Mon 18 Jan–Fri 22 Jan" }));
    expect(dated("Monday 18 Jan", "09:00").getAttribute("aria-label")).toContain("not away");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ away: [] }));
  });
});

describe("the guided tour", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  const step = (title: string) => screen.getByRole("dialog", { name: `Guided tour: ${title}` });
  /** A step done says so, and offers Next: nothing moves on by itself. */
  const next = (title: string) => {
    const card = step(title);
    expect(within(card).getByText("Nicely done")).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Next" }));
  };
  /** The clock moved on, for a step that goes on by itself. */
  const wait = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** A press and a release on a painted cell: it opens its block. */
  const tap = (day: string, clock: string) => {
    fireEvent.pointerDown(cell(day, clock));
    fireEvent.pointerUp(window);
  };
  it("starts by itself the first time, cannot be skipped, holds the form, and asks before it is ended", () => {
    const onCancel = vi.fn();
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} onCancel={onCancel} />);
    const first = step("Paint the week");
    expect(first.textContent).toContain("Before you start");
    expect(within(first).queryByRole("button", { name: "Skip" })).toBeNull();
    expect(within(first).getByText("Try it to go on")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);

    // The X, or Escape, asks first; and says the form waits for the tour.
    fireEvent.click(within(first).getByRole("button", { name: "End the tour" }));
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("Save and Submit stay off until the tour is taken to its end");
    fireEvent.click(within(sure).getByRole("button", { name: "Keep going" }));
    expect(step("Paint the week")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "End the guided tour?" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "End the guided tour?" })).toBeNull();
    expect(step("Paint the week")).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();

    // Ended: the form still waits, and the button starts it again.
    fireEvent.click(within(first).getByRole("button", { name: "End the tour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "End the guided tour?" })).getByRole("button", { name: "End the tour" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    expect(step("Paint the week")).toBeTruthy();
  });

  it("is taught by doing each part, the block opened by a click, and clears what was tried if asked", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    // How to paint, shown, and the brushes as their buttons look.
    expect(document.querySelector('[data-tour-demo]')).not.toBeNull();
    expect(within(step("Paint the week")).getByText("Can't teach").closest("span")?.className).toContain("rounded-full");

    stroke("Tuesday", "14:00", "15:00");
    // Painted: the block does not open by itself, while the tour is to teach opening it — nor
    // when clicked, before the step that teaches it.
    expect(screen.queryByRole("dialog", { name: "Can't teach Tue 14:00–16:00" })).toBeNull();
    // A press on it changes nothing, not even the tour's card while it is held.
    fireEvent.pointerDown(cell("Tuesday", "14:00"));
    expect(within(step("Paint the week")).getByText("Nicely done")).toBeTruthy();
    expect(within(step("Paint the week")).getByRole("button", { name: "Next" })).toBeTruthy();
    fireEvent.pointerUp(window);
    fireEvent.click(cell("Tuesday", "15:00"), { detail: 0 });
    expect(screen.queryByRole("dialog", { name: "Can't teach Tue 14:00–16:00" })).toBeNull();
    expect(within(step("Paint the week")).getByText("Nicely done")).toBeTruthy();
    next("Paint the week");

    expect(step("Open a block").textContent).toContain("Click the block you painted");
    expect(document.querySelector('[data-tour-demo="tap"]')).not.toBeNull();
    tap("Tuesday", "15:00");
    // Clicked: said so first, with no Next — the block opens a moment later, and the tour goes on.
    expect(within(step("Open a block")).getByText("Nicely done: opening it…")).toBeTruthy();
    expect(within(step("Open a block")).queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Can't teach Tue 14:00–16:00" })).toBeNull();
    wait(2000);

    const block = screen.getByRole("dialog", { name: "Can't teach Tue 14:00–16:00" });
    expect(block.className).toContain("tour-pop-in");
    expect(step("How much it matters").textContent).toContain("Your click opened this box.");
    expect(step("How much it matters").textContent).toContain("Comment box");
    // The block cannot be removed while the tour is about it.
    expect((within(block).getByRole("button", { name: /Remove the whole block/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(block).getByRole("radio", { name: "Must" }));
    // Done pressed: straight on, with no "Nicely done" and no Next.
    fireEvent.click(within(block).getByRole("button", { name: "Done" }));

    expect(step("Away on some dates?")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Week by week" }));
    expect(step("Mark the time away")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /: mark away all day$/ })[0]);
    fireEvent.click(within(screen.getByRole("dialog", { name: /^Away / })).getByRole("button", { name: "Done" }));
    // Done: the light takes in the list of time away, the day marked in it.
    expect(step("Your time away").textContent).toContain("Every time away shows in this list");
    expect(step("Your time away").textContent).toContain("You can switch between Every weekWeek by week at any time.");
    expect(screen.getByLabelText("Time away").textContent).toMatch(/[A-Z][a-z]{2} \d+ [A-Z][a-z]{2}/);
    fireEvent.click(within(step("Your time away")).getByRole("button", { name: "Next" }));
    fireEvent.click(within(step("Limits and needs")).getByRole("button", { name: "Next" }));

    // At the end the form is free, and what was tried can go.
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(step("Save or submit")).getByRole("button", { name: "Clear what I tried" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(screen.queryByLabelText("Time away")).toBeNull();
    expect(screen.getByRole("radio", { name: "Every week" }).getAttribute("aria-checked")).toBe("true");
  });

  it("goes back a step when asked, without the press on Back counting as the step done", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    stroke("Tuesday", "14:00", "15:00");
    next("Paint the week");
    tap("Tuesday", "14:00");
    wait(2000);
    // On "How much it matters", with the block open: pressing Back leaves the block open.
    const back = within(step("How much it matters")).getByRole("button", { name: "Back" });
    fireEvent.pointerDown(back);
    expect(screen.getByRole("dialog", { name: "Can't teach Tue 14:00–16:00" })).toBeTruthy();
    expect(within(step("How much it matters")).queryByText("Nicely done")).toBeNull();
    fireEvent.click(back);
    // Back on "Open a block", the block closed, waiting to be clicked again.
    expect(step("Open a block").textContent).toContain("Click the block you painted");
    expect(within(step("Open a block")).queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Can't teach Tue 14:00–16:00" })).toBeNull();
  });

  it("once taken, starts only from its button, and ending it early clears what was tried", () => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
    render(<WishesForm collection={COLLECTION} initial={null} onSave={() => {}} />);
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    stroke("Tuesday", "14:00", "15:00");
    const escaped = vi.fn();
    document.addEventListener("keydown", escaped);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", escaped);
    expect(escaped).not.toHaveBeenCalled();
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("What you tried during the tour is cleared.");
    fireEvent.click(within(sure).getByRole("button", { name: "End the tour" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(said("Tuesday", "14:00")).toContain("fine");
  });
});
