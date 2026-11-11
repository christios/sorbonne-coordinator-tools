import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WishesForm } from "@/components/WishesForm";
import type { WishBlock, WishCalendar, WishCollection, Wishes } from "@/services/teacherWishes";

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
/** Three teaching weeks from 11 Jan, the Wednesday of the first a holiday. */
const CALENDAR: WishCalendar = { weekOne: "2027-01-11", weeks: 3, without: [], holidays: [{ date: "2027-01-13", label: "Holiday" }] };

/** A cell of the week shown, by its day and time: "Tuesday 12 Jan 14:00". */
const cell = (day: string, clock: string) => screen.getByRole("button", { name: new RegExp(`^${day} \\d+ \\w+ ${clock}: `) });
const said = (day: string, clock: string) => cell(day, clock).getAttribute("aria-label") ?? "";
/** A stroke from one cell to another, let go at the end. */
const stroke = (from: [string, string], to: [string, string] = from) => {
  fireEvent.pointerDown(cell(...from));
  if (to[0] !== from[0] || to[1] !== from[1]) fireEvent.pointerOver(cell(...to));
  fireEvent.pointerUp(window);
};
const box = () => screen.getByRole("dialog", { name: /^(Constraint|Preference) · / });
/** Done in a block's box: a constraint given a reason first, if it has none (it needs one). */
const done = () => {
  const why = within(box()).getByRole("textbox") as HTMLInputElement;
  if (why.getAttribute("aria-required") === "true" && !why.value) fireEvent.change(why, { target: { value: "A reason" } });
  fireEvent.click(within(box()).getByRole("button", { name: "Done" }));
};
const answer = (blocks: WishBlock[], rest: Partial<Wishes> = {}): Wishes => ({
  status: "draft",
  blocks,
  limits: {},
  limitKinds: {},
  comments: {},
  needs: "",
  note: "",
  lines: [],
  overCapReason: "",
  source: "coordinator",
  submittedAt: "",
  updatedAt: "",
  updatedBy: "",
  ...rest,
});

// The form opens on the first teaching week still to come: from here, Week 1.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a teacher's week, marked block by block", () => {
  beforeEach(() => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
  });

  it("shows one teaching week at a time, with its dates, a holiday not to be marked", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect((cell("Wednesday", "10:00") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(screen.getByRole("table", { name: "Week 2 · 18 Jan–22 Jan" })).toBeTruthy();
  });

  it("makes one block of a stroke down the hours and across the days, every week, and opens it to choose how it repeats", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    // Straight from Tuesday 14:00 to Thursday 16:00: one rectangle.
    stroke(["Tuesday", "14:00"], ["Thursday", "16:00"]);
    for (const [day, clock] of [
      ["Tuesday", "14:00"],
      ["Thursday", "16:00"],
      ["Tuesday", "16:00"],
    ]) {
      expect(said(day, clock)).toContain("constraint, every week");
    }
    expect(said("Tuesday", "17:00")).toContain("fine");
    expect(said("Monday", "14:00")).toContain("fine");
    const opened = screen.getByRole("dialog", { name: "Constraint · Tue, Wed, Thu 14:00–17:00 · every week" });
    expect(within(opened).getByRole("radio", { name: /^Every week The whole semester/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Clear" })).toBeNull();
  });

  it("repeats a block that week only, or from that week on, as chosen, and shows it on those weeks", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: /^This week only/ }));
    done();
    expect(said("Tuesday", "14:00")).toContain("constraint, this week only");

    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(said("Tuesday", "14:00")).toContain("fine");
    stroke(["Monday", "09:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: /^Every week from Week 2/ }));
    done();
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(said("Monday", "09:00")).toContain("every week from 18 Jan");
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    expect(said("Monday", "09:00")).toContain("fine");
  });

  it("makes a whole day a constraint for that week only from the day's name, to say why", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Thursday 14 Jan: a constraint all day, this week only" }));
    const day = screen.getByRole("dialog", { name: "Constraint · Thu 14 Jan, all day" });
    expect(within(day).getByRole("radio", { name: /^This week only/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(day).getByRole("textbox"), { target: { value: "Conference" } });
    done();
    const list = screen.getByLabelText("Summary of constraints and preferences");
    expect(list.textContent).toContain("Thu 14 Jan, all day");
    expect(list.textContent).toContain("One week only");
    expect(list.textContent).toContain("“Conference”");
  });

  it("is marked from the keyboard too, and a marked hour opens its block from there", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    // Enter or Space on a cell is a click with no pointer behind it.
    fireEvent.click(cell("Monday", "09:00"));
    expect(screen.getByRole("dialog", { name: "Constraint · Mon 09:00–10:00 · every week" })).toBeTruthy();
    done();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(cell("Monday", "09:00"));
    expect(screen.getByRole("dialog", { name: "Constraint · Mon 09:00–10:00 · every week" })).toBeTruthy();
  });

  it("turns a block from a constraint to a preference in its box, and marks with either", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Monday", "09:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: "Preference" }));
    done();
    expect(said("Monday", "09:00")).toContain("preference, every week");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Mark as" })).getByRole("radio", { name: "Preference" }));
    stroke(["Friday", "10:00"]);
    expect(screen.getByRole("dialog", { name: "Preference · Fri 10:00–11:00 · every week" })).toBeTruthy();
  });

  it("says what a click does over a block, and lights all of it", async () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Tuesday", "14:00"], ["Thursday", "14:00"]);
    done();
    fireEvent.pointerOver(cell("Tuesday", "14:00"));
    const bubble = await screen.findByRole("tooltip");
    expect(bubble.textContent).toContain("Click to choose how it repeats, comment or remove");
    // Every day of the block is lit, not only the hour under the pointer.
    for (const day of ["Tuesday", "Thursday"]) {
      expect(cell(day, "14:00").querySelector("[data-quarter]")?.className).toContain("brightness");
    }
  });

  it("lists every block under the calendar, shows one from the list on its week, and takes one off", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    stroke(["Tuesday", "14:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: /^This week only/ }));
    done();
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    fireEvent.click(screen.getByRole("button", { name: "Show Constraint · Tue 19 Jan, 14:00–15:00" }));
    expect(screen.getByRole("table", { name: "Week 2 · 18 Jan–22 Jan" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Constraint · Tue 19 Jan, 14:00–15:00" })).toBeTruthy();
    done();
    fireEvent.click(screen.getByRole("button", { name: "Remove Constraint · Tue 19 Jan, 14:00–15:00" }));
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).toContain("Nothing marked");
  });

  it("is marked to the quarter hour with finer cells, and opens an answer fine enough to show it", () => {
    const { unmount } = render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "15 min" }));
    stroke(["Tuesday", "14:15"], ["Tuesday", "14:30"]);
    expect(screen.getByRole("dialog", { name: "Constraint · Tue 14:15–14:45 · every week" })).toBeTruthy();
    unmount();
    const block: WishBlock = { id: "b", kind: "constraint", days: [2], from: 14.25, to: 15, repeat: "all", week: "", comment: "" };
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([block])} onSave={() => {}} />);
    expect(screen.getByRole("radio", { name: "15 min" }).getAttribute("aria-checked")).toBe("true");
  });

  it("is three pages, Submit on the last, and asks why past the hours of constraints a week", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={onSave} />);
    // Four hours every week, over the three: a day of one week does not count.
    stroke(["Monday", "08:00"], ["Monday", "11:00"]);
    done();
    fireEvent.click(screen.getByRole("button", { name: "Friday 15 Jan: a constraint all day, this week only" }));
    done();
    expect(screen.getByLabelText("Constraints: 4 of 3 hours a week")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    expect(screen.getByRole("region", { name: "Limits on their week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Mornings, please" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    // Not sent: back on the calendar, where the reason goes.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("4 hours a week of constraints, over the 3");
    fireEvent.change(screen.getByRole("textbox", { name: /say why, for the coordinator/ }), { target: { value: "Lab weeks" } });
    fireEvent.click(screen.getByRole("button", { name: "Needs and a note" }));
    expect((screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe("Mornings, please");
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        submit: true,
        overCapReason: "Lab weeks",
        note: "Mornings, please",
        blocks: [
          expect.objectContaining({ kind: "constraint", days: [1], from: 8, to: 12, repeat: "all", week: "" }),
          expect.objectContaining({ kind: "constraint", days: [5], from: 8, to: 19, repeat: "once", week: "2027-01-11" }),
        ],
      }),
    );
  });

  it("asks a constraint why before its box is done, and not a preference", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Monday", "09:00"]);
    expect(within(box()).getByText("· required")).toBeTruthy();
    fireEvent.click(within(box()).getByRole("button", { name: "Done" }));
    expect(within(box()).getByRole("alert").textContent).toBe("A constraint needs a reason.");
    expect(within(box()).getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    // The switch fills its row, its two halves sharing it.
    for (const half of within(within(box()).getByRole("radiogroup", { name: "Constraint or preference" })).getAllByRole("radio")) {
      expect(half.className).toContain("flex-1");
    }
    fireEvent.click(within(box()).getByRole("radio", { name: "Preference" }));
    expect(within(box()).getByText("· optional")).toBeTruthy();
    fireEvent.click(within(box()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is submitted only once every constraint says why: the first without is opened to say it", () => {
    const onSave = vi.fn();
    const bare: WishBlock = { id: "b", kind: "constraint", days: [2], from: 14, to: 16, repeat: "all", week: "", comment: "" };
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([bare])} onSave={onSave} />);
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).toContain("Reason needed");
    // A draft may wait for it.
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ submit: false }));
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Each constraint needs a reason/)).toBeTruthy();
    const opened = screen.getByRole("dialog", { name: "Constraint · Tue 14:00–16:00 · every week" });
    expect(within(opened).getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(within(opened).getByRole("textbox"), { target: { value: "School run" } });
    fireEvent.click(within(opened).getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Needs and a note" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ submit: true, blocks: [expect.objectContaining({ comment: "School run" })] }));
  });

  it("asks a limit made a constraint why, on Submit, on its page", () => {
    const onSave = vi.fn();
    render(
      <WishesForm
        collection={COLLECTION}
        calendar={CALENDAR}
        initial={answer([], { limits: { maxDays: 3 }, limitKinds: { maxDays: "constraint" } })}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs/ }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Most days on campus: comment" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("holds each limit as a preference unless made a constraint, with why", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([], { limits: { maxDays: 3 } })} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    const kind = screen.getByRole("radiogroup", { name: "Most days on campus: constraint or preference" });
    expect(within(kind).getByRole("radio", { name: "Preference" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(kind).getByRole("radio", { name: "Constraint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Most days on campus: comment" }), { target: { value: "Childcare" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ submit: false, limitKinds: { maxDays: "constraint" }, comments: { maxDays: "Childcare" } }),
    );
  });

  it("tells whoever holds it when it has changed, and when it is back as it was", () => {
    const onDirtyChange = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} onDirtyChange={onDirtyChange} />);
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    stroke(["Monday", "09:00"]);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(within(box()).getByRole("button", { name: /Remove/ }));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("the guided tour", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  const step = (title: string) => screen.getByRole("dialog", { name: `Guided tour: ${title}` });
  /** A step done says so, and offers Next. */
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
  /** A press and a release on a marked cell: it opens its block. */
  const tap = (day: string, clock: string) => {
    fireEvent.pointerDown(cell(day, clock));
    fireEvent.pointerUp(window);
  };
  /** The tour, as suggested when the form first opens, started. */
  const begin = () => fireEvent.click(within(step("New here? Take the one-minute tour")).getByRole("button", { name: "Start the tour" }));
  /** How to take the tour again, read. */
  const gotIt = () => fireEvent.click(within(step("Take the tour again")).getByRole("button", { name: "Got it" }));

  it("is suggested the first time, and declined, says how to take it later while the form waits for it", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    const welcome = step("New here? Take the one-minute tour");
    expect(within(welcome).getAllByRole("listitem")).toHaveLength(3);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(welcome).getByRole("button", { name: "Later" }));
    expect(step("Take the tour again").textContent).toContain("Save draft and Submit open once it is finished");
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    expect(step("Mark a time")).toBeTruthy();
  });

  it("cannot be skipped, holds the form, and asks before it is ended", () => {
    const onCancel = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} onCancel={onCancel} />);
    begin();
    const first = step("Mark a time");
    expect(within(first).queryByRole("button", { name: "Skip" })).toBeNull();
    expect(within(first).getByText("Your turn")).toBeTruthy();
    // What to do is said once, in the numbered steps: no "Try it" box saying it again.
    expect(within(first).queryByText(/^Try it/)).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);

    // The X, or Escape, asks first; and says the form waits for the tour.
    fireEvent.click(within(first).getByRole("button", { name: "End the tour" }));
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("Save and Submit stay off until the tour is taken to its end");
    fireEvent.click(within(sure).getByRole("button", { name: "Keep going" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "End the guided tour?" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "End the guided tour?" })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    // Ended: how to take it again pops up, the form still waits, and the button starts it again.
    fireEvent.click(within(step("Mark a time")).getByRole("button", { name: "End the tour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "End the guided tour?" })).getByRole("button", { name: "End the tour" }));
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    expect(step("Mark a time")).toBeTruthy();
  });

  it("is taught by doing each part with one block only, opened by a click, and clears what was tried if asked", () => {
    // The clock too, for the step that goes on by itself: faked afresh, as faking twice does nothing.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    begin();
    // How to mark, shown, and the kinds as their buttons look.
    expect(document.querySelector("[data-tour-demo]")).not.toBeNull();
    expect(within(step("Mark a time")).getByText("Constraint").closest("span")?.className).toContain("rounded-full");

    // Only what the step is about works: not the week arrows, though they are lit.
    fireEvent.mouseDown(screen.getByRole("button", { name: "The week after" }));
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect(within(step("Mark a time")).getByRole("status").textContent).toContain("only what this step asks for works");
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    // Made: the block does not open by itself, while the tour is to teach opening it.
    expect(screen.queryByRole("dialog", { name: /^Constraint · / })).toBeNull();
    expect(step("Mark a time").textContent).toContain("One block is enough for the tour");
    // No second block, from a stroke or a day's name; and a press on the block is nothing yet.
    stroke(["Thursday", "10:00"]);
    expect(said("Thursday", "10:00")).toContain("fine");
    fireEvent.click(screen.getByRole("button", { name: /^Friday 15 Jan: a constraint all day/ }));
    expect(said("Friday", "10:00")).toContain("fine");
    tap("Tuesday", "14:00");
    expect(screen.queryByRole("dialog", { name: /^Constraint · / })).toBeNull();
    next("Mark a time");

    expect(document.querySelector('[data-tour-demo="tap"]')).not.toBeNull();
    tap("Tuesday", "15:00");
    // Clicked: said so first, with no Next — the block opens a moment later, and the tour goes on.
    expect(within(step("Open a block")).getByText("Nicely done: opening it…")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /^Constraint · / })).toBeNull();
    wait(2000);

    const opened = screen.getByRole("dialog", { name: "Constraint · Tue 14:00–16:00 · every week" });
    expect(opened.className).toContain("tour-pop-in");
    expect(step("How it repeats").textContent).toContain("Your click opened this box.");
    expect(within(step("How it repeats")).getAllByRole("listitem")).toHaveLength(3);
    expect(step("How it repeats").textContent).toContain("Say why: a constraint needs a reason");
    expect((within(opened).getByRole("button", { name: /Remove/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(opened).getByRole("radio", { name: /^This week only/ }));
    // A constraint is done once it says why.
    fireEvent.click(within(opened).getByRole("button", { name: "Done" }));
    expect(within(box()).getByRole("alert").textContent).toBe("A constraint needs a reason.");
    expect(step("How it repeats")).toBeTruthy();
    // Said: straight on.
    done();

    expect(step("Move between weeks")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    // The one-week block stays on its week.
    expect(said("Tuesday", "14:00")).toContain("fine");
    // A day away, tried: its Whole day button marks all of it for this week, and its box asks why.
    expect(step("Away for a day?").textContent).toContain("Press Whole day under a day’s name");
    fireEvent.click(screen.getByRole("button", { name: "Monday 18 Jan: a constraint all day, this week only" }));
    expect(box().getAttribute("aria-label")).toBe("Constraint · Mon 18 Jan, all day");
    expect(step("Away for a day?")).toBeTruthy();
    done();
    expect(said("Monday", "10:00")).toContain("constraint, this week only");
    // One day is all: another day's button does nothing more.
    fireEvent.click(screen.getByRole("button", { name: "Tuesday 19 Jan: a constraint all day, this week only" }));
    expect(said("Tuesday", "10:00")).toContain("fine");
    expect(step("Summary of constraints and preferences").textContent).toContain("Click one to go to its week");
    fireEvent.click(within(step("Summary of constraints and preferences")).getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    fireEvent.click(within(step("Limits on their week")).getByRole("button", { name: "Next" }));

    // Near the end the form is free; the last step says how to take the tour again, and what was tried can go.
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(step("Save or submit")).getByRole("button", { name: "Next" }));
    expect(step("Take the tour again").textContent).toContain("Press Guided tour, top right");
    fireEvent.click(within(step("Take the tour again")).getByRole("button", { name: "Clear what I tried" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).toContain("Nothing marked");
  });

  it("goes back a step when asked, without the press on Back counting as the step done", () => {
    // The clock too, for the step that goes on by itself: faked afresh, as faking twice does nothing.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    begin();
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    next("Mark a time");
    tap("Tuesday", "14:00");
    wait(2000);
    // On "How it repeats", with the block open: pressing Back leaves the block open.
    const back = within(step("How it repeats")).getByRole("button", { name: "Back" });
    fireEvent.pointerDown(back);
    expect(box()).toBeTruthy();
    fireEvent.click(back);
    // Back on "Open a block", the block closed, waiting to be clicked again.
    expect(step("Open a block").textContent).toContain("Click the block you made");
    expect(within(step("Open a block")).queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /^Constraint · / })).toBeNull();
  });

  it("once taken, starts only from its button, and ending it early clears what was tried", () => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    const escaped = vi.fn();
    document.addEventListener("keydown", escaped);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", escaped);
    expect(escaped).not.toHaveBeenCalled();
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("What you tried during the tour is cleared.");
    fireEvent.click(within(sure).getByRole("button", { name: "End the tour" }));
    // Taken before: how to take it again says nothing of Save waiting.
    expect(step("Take the tour again").textContent).toContain("whenever you want it");
    expect(step("Take the tour again").textContent).not.toContain("Save draft");
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(said("Tuesday", "14:00")).toContain("fine");
  });
});
