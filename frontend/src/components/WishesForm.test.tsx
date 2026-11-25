import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tourPace } from "@/components/FormTour";
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
const box = () => screen.getByRole("dialog", { name: /^(Hard|Soft) constraint · / });
/** Done in a block's box: a constraint given a reason first, if it has none (it needs one). */
const done = () => {
  const why = within(box()).getByRole("textbox") as HTMLInputElement;
  if (why.getAttribute("aria-required") === "true" && !why.value) fireEvent.change(why, { target: { value: "A reason" } });
  fireEvent.click(within(box()).getByRole("button", { name: "Done" }));
};
/** A hard constraint every week, with its reason. */
const block = (id: string, days: number[], from: number, to: number, comment = ""): WishBlock => ({
  id,
  kind: "constraint",
  days,
  from,
  to,
  repeat: "all",
  week: "",
  comment,
});
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
      expect(said(day, clock)).toContain("constraint, whole semester");
    }
    expect(said("Tuesday", "17:00")).toContain("fine");
    expect(said("Monday", "14:00")).toContain("fine");
    const opened = screen.getByRole("dialog", { name: "Hard constraint · Tue–Thu 14:00–17:00 · whole semester" });
    expect(within(opened).getByRole("radio", { name: /^Whole semester Every week, first to last/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Clear" })).toBeNull();
  });

  // Several weeks walked through: well under a second alone, more on a busy machine.
  it("repeats a block that week only, or from that week on, as chosen, and shows it on those weeks", { timeout: 20_000 }, () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: /^This week only/ }));
    done();
    expect(said("Tuesday", "14:00")).toContain("constraint, this week only");

    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(said("Tuesday", "14:00")).toContain("fine");
    stroke(["Monday", "09:00"]);
    fireEvent.click(within(box()).getByRole("radio", { name: /^Every week starting Week 2/ }));
    done();
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(said("Monday", "09:00")).toContain("every week starting 18 Jan");
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    expect(said("Monday", "09:00")).toContain("fine");
  });

  it("makes a whole day a constraint for that week only from the day's name, to say why", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Thursday 14 Jan: a hard constraint all day, this week only" }));
    const day = screen.getByRole("dialog", { name: "Hard constraint · Thu 14 Jan, whole day" });
    expect(within(day).getByRole("radio", { name: /^This week only/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(within(day).getByRole("textbox"), { target: { value: "Conference" } });
    done();
    const list = screen.getByLabelText("Summary of constraints and preferences");
    expect(list.textContent).toContain("Thu 14 Jan, whole day");
    expect(list.textContent).toContain("One week only");
    expect(list.textContent).toContain("“Conference”");
  });

  it("is marked from the keyboard too, and a marked hour opens its block from there", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    // Enter or Space on a cell is a click with no pointer behind it.
    fireEvent.click(cell("Monday", "09:00"));
    expect(screen.getByRole("dialog", { name: "Hard constraint · Mon 09:00–10:00 · whole semester" })).toBeTruthy();
    done();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(cell("Monday", "09:00"));
    expect(screen.getByRole("dialog", { name: "Hard constraint · Mon 09:00–10:00 · whole semester" })).toBeTruthy();
  });

  it("makes every block a constraint first, turned to a preference in its box: no buttons above the calendar", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    expect(screen.queryByRole("radiogroup", { name: "Mark as" })).toBeNull();
    stroke(["Monday", "09:00"]);
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Mon 09:00–10:00 · whole semester");
    fireEvent.click(within(box()).getByRole("radio", { name: "Soft constraint" }));
    done();
    expect(said("Monday", "09:00")).toContain("soft constraint, whole semester");
  });

  it("makes a whole week a constraint for that week only from its Whole week button", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    fireEvent.click(screen.getByRole("button", { name: "Week 2 · 18 Jan–22 Jan: a hard constraint all week, this week only" }));
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Mon 18 Jan–Fri 22 Jan, whole week");
    fireEvent.change(within(box()).getByRole("textbox"), { target: { value: "Leave" } });
    done();
    for (const day of ["Monday", "Wednesday", "Friday"]) expect(said(day, "10:00")).toContain("constraint, this week only");
    expect(screen.getByRole("button", { name: /a hard constraint all week, this week only$/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "The week before" }));
    expect(said("Monday", "10:00")).toContain("fine");
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
    fireEvent.click(screen.getByRole("button", { name: "Show Hard constraint · Tue 19 Jan, 14:00–15:00" }));
    expect(screen.getByRole("table", { name: "Week 2 · 18 Jan–22 Jan" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Hard constraint · Tue 19 Jan, 14:00–15:00" })).toBeTruthy();
    done();
    fireEvent.click(screen.getByRole("button", { name: "Remove Hard constraint · Tue 19 Jan, 14:00–15:00" }));
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).toContain("Nothing marked");
  });

  it("is marked to the quarter hour with finer cells, and opens an answer fine enough to show it", () => {
    const { unmount } = render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "15 min" }));
    stroke(["Tuesday", "14:15"], ["Tuesday", "14:30"]);
    expect(screen.getByRole("dialog", { name: "Hard constraint · Tue 14:15–14:45 · whole semester" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Friday 15 Jan: a hard constraint all day, this week only" }));
    done();
    expect(screen.getByLabelText("Hard constraints: 4 of 3 hours a week")).toBeTruthy();

    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    expect(screen.getByRole("region", { name: "Limits on their week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Mornings, please" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    // Not sent: back on the calendar, where the reason goes.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("4 hours a week of hard constraints, over the 3");
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
    expect(within(box()).getByRole("alert").textContent).toBe("A hard constraint needs a reason.");
    expect(within(box()).getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    // The switch fills its row, its two halves sharing it.
    for (const half of within(within(box()).getByRole("radiogroup", { name: "Hard or soft constraint" })).getAllByRole("radio")) {
      expect(half.className).toContain("flex-1");
    }
    fireEvent.click(within(box()).getByRole("radio", { name: "Soft constraint" }));
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
    expect(screen.getByText(/Each hard constraint needs a reason/)).toBeTruthy();
    const opened = screen.getByRole("dialog", { name: "Hard constraint · Tue 14:00–16:00 · whole semester" });
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
    expect(screen.getByRole("textbox", { name: "Maximum days on campus per week: comment" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("holds each limit as a preference unless made a constraint, with why", () => {
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([], { limits: { maxDays: 3 } })} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    const kind = screen.getByRole("radiogroup", { name: "Maximum days on campus per week: hard or soft" });
    expect(within(kind).getByRole("radio", { name: "Soft constraint" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(kind).getByRole("radio", { name: "Hard constraint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Maximum days on campus per week: comment" }), { target: { value: "Childcare" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ submit: false, limitKinds: { maxDays: "constraint" }, comments: { maxDays: "Childcare" } }),
    );
  });

  it("says on the Limits page what each limit means, and what Preference and Constraint do", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} voice="you" />);
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    const page = screen.getByRole("region", { name: "Limits on your week" });
    expect(page.textContent).toContain("All optional. Leave No limit on any that doesn’t matter.");
    expect(page.textContent).toContain("Soft constraintThe timetable respects it if it can.");
    expect(page.textContent).toContain("Hard constraintThe timetable must respect it. Say why.");
    for (const [name, help] of [
      ["Maximum days on campus per week", "How many days a week you can come in to teach."],
      ["Maximum teaching hours per day", "How many hours of class you can teach in one day."],
      ["Maximum hours of class in a row", "How many hours of class back to back, with no break between them."],
      ["Preferred day off", "A weekday with no classes for you."],
    ]) {
      expect(page.textContent).toContain(`${name}${help}`);
    }
  });

  it("heads the summary's two lists, and draws each date as a link that opens its block", () => {
    const block: WishBlock = { id: "b", kind: "constraint", days: [2], from: 14, to: 16, repeat: "all", week: "", comment: "School run" };
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([block])} onSave={() => {}} />);
    const summary = screen.getByLabelText("Summary of constraints and preferences");
    expect(summary.textContent).toContain("Click a date to open it on the calendar and change it.");
    expect(within(summary).getByRole("heading", { name: /^Hard constraints 1/ })).toBeTruthy();
    expect(within(summary).getByRole("heading", { name: /^Soft constraints 0/ })).toBeTruthy();
    const date = within(summary).getByRole("button", { name: /^Show Hard constraint · Tue 14:00–16:00/ });
    expect(date.className).toContain("underline");
    expect(summary.textContent).toContain("Whole semester");
    fireEvent.click(date);
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Tue 14:00–16:00 · whole semester");
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

  it("sums up a day marked in strokes as a whole day, and the same hours on several days as one line", () => {
    const blocks = [
      block("mon", [1], 10, 12, "School run"),
      block("thu", [4], 10, 12, "School run"),
      block("am", [2], 8, 12, "Lab"),
      block("pm", [2], 12, 19, "Lab"),
    ];
    const onSave = vi.fn();
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer(blocks)} onSave={onSave} />);
    const list = screen.getByLabelText("Summary of constraints and preferences");
    const lines = within(list).getAllByRole("listitem");
    expect(lines.map((line) => line.textContent)).toEqual(["Mon, Thu 10:00–12:00Whole semester“School run”", "Tue whole dayWhole semester“Lab”"]);
    // The blocks themselves are as they were made.
    expect(said("Tuesday", "10:00")).toContain("hard constraint, whole semester");
    // × on a line takes off every block it holds.
    fireEvent.click(within(list).getByRole("button", { name: "Remove Hard constraint · Mon, Thu 10:00–12:00 · whole semester" }));
    expect(said("Monday", "10:00")).toContain("fine");
    expect(said("Thursday", "10:00")).toContain("fine");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("offers Whole semester alone in Week 1, where every week starting it would be the same", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Monday", "09:00"]);
    expect(within(box()).getByRole("radio", { name: /^Whole semester/ })).toBeTruthy();
    expect(within(box()).getByRole("radio", { name: /^This week only/ })).toBeTruthy();
    expect(within(box()).queryByRole("radio", { name: /^Every week starting/ })).toBeNull();
    done();
    // From Week 2 on, starting there is a choice of its own.
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    fireEvent.click(cell("Monday", "09:00"));
    expect(within(box()).getByRole("radio", { name: /^Every week starting Week 2/ })).toBeTruthy();
  });

  it("reads a block kept as every week from Week 1 as one of the whole semester, unchanged", () => {
    const onDirtyChange = vi.fn();
    const block: WishBlock = { id: "b", kind: "constraint", days: [1], from: 9, to: 10, repeat: "from", week: "2027-01-11", comment: "Run" };
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([block])} onSave={() => {}} onDirtyChange={onDirtyChange} />);
    expect(said("Monday", "09:00")).toContain("constraint, whole semester");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("refuses a block over another's hours and names it, but lets a week's own block stand over the usual week", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    done();
    stroke(["Tuesday", "15:00"], ["Tuesday", "17:00"]);
    expect(screen.getByRole("alert").textContent).toBe("That overlaps Tue 14:00–16:00 (Whole semester). Change or remove that block first.");
    expect(screen.queryByRole("dialog", { name: /^Hard constraint · / })).toBeNull();
    expect(said("Tuesday", "17:00")).toContain("fine");
    // A day away over it is that week's own: allowed, and on top that week.
    fireEvent.click(screen.getByRole("button", { name: "Tuesday 12 Jan: a hard constraint all day, this week only" }));
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Tue 12 Jan, whole day");
    // Made to repeat, it would cover the usual Tuesday afternoon: that choice is off, and says why.
    const whole = within(box()).getByRole("radio", { name: /^Whole semester/ }) as HTMLButtonElement;
    expect(whole.disabled).toBe(true);
    expect(whole.textContent).toContain("Overlaps Tue 14:00–16:00 (Whole semester)");
    done();
    expect(said("Tuesday", "15:00")).toContain("constraint, this week only");
  });

  it("lets a block of the whole semester go under one that starts later, which stays on top from its week", () => {
    // Miklos, 25 Nov 2026: away every day from a week on, and mornings rather not, the whole semester.
    const away: WishBlock = { ...block("away", [1, 2, 3, 4, 5], 8, 19, "Leaves"), repeat: "from", week: "2027-01-18" };
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={answer([away])} onSave={() => {}} />);
    stroke(["Monday", "08:00"], ["Friday", "09:00"]);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Mon–Fri 08:00–10:00 · whole semester");
    fireEvent.click(within(box()).getByRole("radio", { name: "Soft constraint" }));
    done();
    expect(said("Monday", "08:00")).toContain("soft constraint, whole semester");
    // From its week, the block that starts later is the one that counts.
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(said("Monday", "08:00")).toContain("hard constraint, every week starting 18 Jan");
    expect(said("Friday", "15:00")).toContain("hard constraint, every week starting 18 Jan");
    // Made to start when the mornings do, it would meet them: that choice is off, and says why.
    fireEvent.click(cell("Monday", "08:00"));
    const whole = within(box()).getByRole("radio", { name: /^Whole semester/ }) as HTMLButtonElement;
    expect(whole.disabled).toBe(true);
    expect(whole.textContent).toContain("Overlaps Mon–Fri 08:00–10:00 (Whole semester)");
  });

  it("takes a week's whole days into a whole week marked over them, reasons and all", () => {
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Thursday 14 Jan: a hard constraint all day, this week only" }));
    fireEvent.change(within(box()).getByRole("textbox"), { target: { value: "Conference" } });
    done();
    fireEvent.click(screen.getByRole("button", { name: "Week 1 · 11 Jan–15 Jan: a hard constraint all week, this week only" }));
    expect((within(box()).getByRole("textbox") as HTMLInputElement).value).toBe("Conference");
    done();
    const list = screen.getByLabelText("Summary of constraints and preferences");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).toContain("Mon 11 Jan–Fri 15 Jan, whole week");
    // A day of it marked again would lie inside it: refused.
    fireEvent.click(screen.getByRole("button", { name: "Monday 11 Jan: a hard constraint all day, this week only" }));
    expect(screen.getByRole("alert").textContent).toBe("That overlaps Mon 11 Jan–Fri 15 Jan, whole week (One week only). Change or remove that block first.");
  });
});

describe("the guided tour, for a teacher answering through their link", () => {
  // Each card's reading time is its own test, below: here the cards let the reader on at once.
  beforeEach(() => {
    window.localStorage.clear();
    tourPace.scale = 0;
  });
  afterEach(() => {
    tourPace.scale = 1;
  });
  const step = (title: string) => screen.getByRole("dialog", { name: `Guided tour: ${title}` });
  /** A step done says so, and offers Next. */
  const next = (title: string) => {
    const card = step(title);
    expect(within(card).getByText(/^Nicely done/)).toBeTruthy();
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
  /** The tour, as suggested when the form first opens, started: past how it works, on its first step. */
  const begin = () => {
    fireEvent.click(within(step("New here? Take the two-minute tour")).getByRole("button", { name: "Start the tour" }));
    fireEvent.click(within(step("How the tour works")).getByRole("button", { name: "Next" }));
  };
  /** The large "don't fill in the form now", up after a press the step has nothing to do with. */
  const alert = () => screen.getByRole("alertdialog", { name: "Don’t fill in the form now" });
  const backToTour = () => fireEvent.click(within(alert()).getByRole("button", { name: "Back to the tour" }));
  /** How to take the tour again, read. */
  const gotIt = () => fireEvent.click(within(step("Take the tour again")).getByRole("button", { name: "Got it" }));

  it("is suggested the first time, never required, and declined, says how to take it later", () => {
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    const welcome = step("New here? Take the two-minute tour");
    expect(within(welcome).getAllByRole("listitem")).toHaveLength(3);
    expect(welcome.textContent).toContain("Optional: you can fill in and submit the form without it.");
    // Save and Submit never wait for the tour (17 Nov 2026).
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(within(welcome).getByRole("button", { name: "Later" }));
    expect(step("Take the tour again").textContent).toContain("Press Guided tour at the bottom right, any time.");
    expect(step("Take the tour again").textContent).not.toContain("Save draft");
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    // The button floats at the bottom right of the window, outside the form.
    const button = screen.getByRole("button", { name: "Guided tour" });
    expect(button.className).toContain("fixed");
    expect(button.parentElement).toBe(document.body);
    fireEvent.click(button);
    // First, that it is a tour, and that only what its card says works.
    const intro = step("How the tour works");
    expect(intro.textContent).toContain("Only that step works. The rest of the form is locked.");
    // A press on the form: the large alert, which says what to do; back on the card, it shakes.
    fireEvent.mouseDown(cell("Monday", "09:00"));
    expect(alert().textContent).toContain("This is a guided tour. Just follow the steps on the green card.");
    expect(alert().textContent).toContain("Now: press Next on the card.");
    backToTour();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.querySelector("[data-tour-card] .tour-card-shake")).not.toBeNull();
  });

  it("cannot be skipped once started, and asks before it is ended", () => {
    const onCancel = vi.fn();
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} onCancel={onCancel} />);
    begin();
    const first = step("Mark a time");
    expect(within(first).queryByRole("button", { name: "Skip" })).toBeNull();
    expect(within(first).getByText("Your turn")).toBeTruthy();
    // What to do is said once, in the numbered steps: no "Try it" box saying it again.
    expect(within(first).queryByText(/^Try it/)).toBeNull();

    // The X, or Escape, asks first; and says where the tour is taken again.
    fireEvent.click(within(first).getByRole("button", { name: "End the tour" }));
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("You can take it again from Guided tour, bottom right.");
    fireEvent.click(within(sure).getByRole("button", { name: "Keep going" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "End the guided tour?" })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "End the guided tour?" })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    // Ended: how to take it again pops up, the form is free, and the button starts it again.
    fireEvent.click(within(step("Mark a time")).getByRole("button", { name: "End the tour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "End the guided tour?" })).getByRole("button", { name: "End the tour" }));
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    expect(step("How the tour works")).toBeTruthy();
  });

  // The whole tour, step by step: a second alone, more under the full suite's load.
  it("is taught by doing each part with one block only, opened by a click, and clears what was tried at the end", { timeout: 20_000 }, () => {
    // The clock too, for the step that goes on by itself: faked afresh, as faking twice does nothing.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    begin();
    // How to mark, shown.
    expect(document.querySelector("[data-tour-demo]")).not.toBeNull();
    expect(within(step("Mark a time")).getAllByRole("listitem")).toHaveLength(2);

    // Only what the step is about works: not the week arrows, though they are lit; and the card says what does.
    fireEvent.mouseDown(screen.getByRole("button", { name: "The week after" }));
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect(alert().textContent).toContain("Now: drag down over a few hours on any day.");
    backToTour();
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    // Made: the block does not open by itself, while the tour is to teach opening it.
    expect(screen.queryByRole("dialog", { name: /^Hard constraint · / })).toBeNull();
    // Practice, and said so: a band across the window, a line on every card, the block tagged.
    expect(document.querySelector("[data-tour-practice]")?.textContent).toContain("Everything you add during the tour is erased when it ends.");
    expect(step("Mark a time").querySelector("[data-tour-practice-line]")?.textContent).toBe("Practice only · cleared when the tour ends");
    expect(document.querySelector("[data-practice-block]")?.textContent).toBe("Practice");
    expect(document.querySelector("li[data-practice]")?.textContent).toContain("Practice");
    // Said where "Your turn" was, in its place.
    expect(within(step("Mark a time")).queryByText("Your turn")).toBeNull();
    expect(step("Mark a time").querySelector('[data-tour-slot="done"]')?.textContent).toBe("Nicely done. One block is enough.");
    // No second block, from a stroke or a day's name; and a press on the block is nothing yet but
    // a nudge: the card says to press Next, and Next is called for.
    stroke(["Thursday", "10:00"]);
    expect(said("Thursday", "10:00")).toContain("fine");
    fireEvent.click(screen.getByRole("button", { name: /^Friday 15 Jan: a hard constraint all day/ }));
    expect(said("Friday", "10:00")).toContain("fine");
    tap("Tuesday", "14:00");
    expect(screen.queryByRole("dialog", { name: /^Hard constraint · / })).toBeNull();
    expect(alert().textContent).toContain("Now: press Next on the card.");
    backToTour();
    expect(within(step("Mark a time")).getByRole("button", { name: "Next" }).className).toContain("ring-4");
    next("Mark a time");

    expect(document.querySelector('[data-tour-demo="tap"]')).not.toBeNull();
    tap("Tuesday", "15:00");
    // Clicked: said so first, with no Next — the block opens a moment later, and the tour goes on.
    expect(within(step("Open the block")).getByText("Nicely done: opening it…")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /^Hard constraint · / })).toBeNull();
    wait(2000);

    const opened = screen.getByRole("dialog", { name: "Hard constraint · Tue 14:00–16:00 · whole semester" });
    expect(opened.className).toContain("tour-pop-in");
    expect(step("Set the block").textContent).toContain("Your click opened this box.");
    expect(within(step("Set the block")).getAllByRole("listitem")).toHaveLength(4);
    expect(step("Set the block").textContent).toContain("Type a reason. Required for a hard constraint.");
    expect((within(opened).getByRole("button", { name: /Remove/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(opened).getByRole("radio", { name: /^This week only/ }));
    // A constraint is done once it says why.
    fireEvent.click(within(opened).getByRole("button", { name: "Done" }));
    expect(within(box()).getByRole("alert").textContent).toBe("A hard constraint needs a reason.");
    expect(step("Set the block")).toBeTruthy();
    // Said: straight on.
    done();

    expect(within(step("Change the week")).getAllByRole("listitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "The week after" }));
    // The one-week block stays on its week.
    expect(said("Tuesday", "14:00")).toContain("fine");
    // A day away, tried: its Whole day button marks all of it for this week, and its box asks why.
    expect(step("Block a whole day").textContent).toContain("Press Whole day under any day. It blocks that day, this week only.");
    // Drawn as the pill it is on the calendar.
    expect(within(step("Block a whole day")).getByText("Whole day").closest("span")?.className).toContain("rounded-full");
    fireEvent.click(screen.getByRole("button", { name: "Monday 18 Jan: a hard constraint all day, this week only" }));
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Mon 18 Jan, whole day");
    expect(step("Block a whole day")).toBeTruthy();
    done();
    expect(said("Monday", "10:00")).toContain("constraint, this week only");
    // One day is all: another day's button does nothing more.
    // A week away, tried the same way, from Whole week beside the week's name.
    fireEvent.click(screen.getByRole("button", { name: "Tuesday 19 Jan: a hard constraint all day, this week only" }));
    expect(said("Tuesday", "10:00")).toContain("fine");
    expect(step("Block a whole week").textContent).toContain("Press Whole week next to the week.");
    fireEvent.click(screen.getByRole("button", { name: "Week 2 · 18 Jan–22 Jan: a hard constraint all week, this week only" }));
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Mon 18 Jan–Fri 22 Jan, whole week");
    done();
    expect(said("Thursday", "10:00")).toContain("constraint, this week only");
    // The whole week took in the day marked before it: one block for the week now.
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).not.toContain("Mon 18 Jan, whole day");
    // The summary, tried: an entry takes the calendar to its week and opens its box; Done goes on.
    expect(step("Check the summary").textContent).toContain("Click a date, like Tue 14:00–16:00, to open it.");
    fireEvent.click(screen.getByRole("button", { name: "Show Hard constraint · Tue 12 Jan, 14:00–16:00" }));
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect(box().getAttribute("aria-label")).toBe("Hard constraint · Tue 12 Jan, 14:00–16:00");
    done();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    // Back from the limits: to the step about Next, on the calendar, and it stays there until Next is pressed again.
    fireEvent.click(within(step("Set limits")).getByRole("button", { name: "Back" }));
    expect(step("Go to the next page")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Your week" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Limits/ }));
    fireEvent.click(within(step("Set limits")).getByRole("button", { name: "Next" }));

    // The last page, toured too: Next to it, then what its two fields are for.
    expect(step("Go to the last page")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Next: Needs and a note/ }));
    expect(screen.getByRole("region", { name: "Needs and a note" })).toBeTruthy();
    expect(step("Add needs and a note").textContent).toContain("Both are optional. Leave them empty if nothing applies.");
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "Tried in the tour" } });
    fireEvent.click(within(step("Add needs and a note")).getByRole("button", { name: "Next" }));

    // The last step says how to take the tour again, and Finish clears what was tried: no "keep it".
    expect(step("Save or submit").textContent).toContain("Submit sends it to the coordinator.");
    fireEvent.click(within(step("Save or submit")).getByRole("button", { name: "Next" }));
    expect(step("Take the tour again").textContent).toContain("Press Guided tour at the bottom right, any time.");
    expect(within(step("Take the tour again")).queryByRole("button", { name: /Keep it|Clear what I tried/ })).toBeNull();
    fireEvent.click(within(step("Take the tour again")).getByRole("button", { name: "Finish" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(screen.getByRole("table", { name: "Week 1 · 11 Jan–15 Jan" })).toBeTruthy();
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(screen.getByLabelText("Summary of constraints and preferences").textContent).toContain("Nothing marked");
    expect(document.querySelector("[data-tour-practice], [data-practice-block]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Needs and a note" }));
    expect((screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("lets what was tried fade away under a band saying so, then clears it", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
    tourPace.scale = 1;
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    wait(15_000);
    fireEvent.click(within(step("How the tour works")).getByRole("button", { name: "Next" }));
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    fireEvent.click(within(step("Mark a time")).getByRole("button", { name: "End the tour" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "End the guided tour?" })).getByRole("button", { name: "End the tour" }));
    // Not at once: the practice fades first, under a band saying what is going on.
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(document.querySelector("[data-practice-clearing]")?.textContent).toContain("Clearing what you added during the tour…");
    expect(said("Tuesday", "14:00")).toContain("constraint, whole semester");
    expect(cell("Tuesday", "14:00").querySelector("[data-quarter]")?.className).toContain("practice-fade");
    wait(1200);
    expect(document.querySelector("[data-practice-clearing]")).toBeNull();
    expect(said("Tuesday", "14:00")).toContain("fine");
    // Ended early: then how to take it again.
    expect(step("Take the tour again")).toBeTruthy();
  });

  it("goes back a step when asked, without the press on Back counting as the step done", () => {
    // The clock too, for the step that goes on by itself: faked afresh, as faking twice does nothing.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    begin();
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    next("Mark a time");
    tap("Tuesday", "14:00");
    wait(2000);
    // On "Set the block", with the block open: pressing Back leaves the block open.
    const back = within(step("Set the block")).getByRole("button", { name: "Back" });
    fireEvent.pointerDown(back);
    expect(box()).toBeTruthy();
    fireEvent.click(back);
    // Back on "Open a block", the block closed, waiting to be clicked again.
    expect(step("Open the block").textContent).toContain("Click the block you made");
    expect(within(step("Open the block")).queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: /^Hard constraint · / })).toBeNull();
  });

  it("undoes, going back, what was done since the step gone back to began: that step is tried afresh", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    begin();
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    next("Mark a time");
    // Back from step 2 to step 1: the block drawn on step 1 is gone, and step 1 waits for one again.
    fireEvent.click(within(step("Open the block")).getByRole("button", { name: "Back" }));
    expect(said("Tuesday", "14:00")).toContain("fine");
    expect(within(step("Mark a time")).getByText("Your turn")).toBeTruthy();
    stroke(["Thursday", "10:00"]);
    next("Mark a time");
    expect(said("Thursday", "10:00")).toContain("constraint, whole semester");
    expect(said("Tuesday", "14:00")).toContain("fine");

    // A block set in its box, then Back: as it was before it was set.
    tap("Thursday", "10:00");
    wait(2000);
    fireEvent.click(within(box()).getByRole("radio", { name: /^This week only/ }));
    fireEvent.click(within(box()).getByRole("radio", { name: "Soft constraint" }));
    fireEvent.click(within(step("Set the block")).getByRole("button", { name: "Back" }));
    expect(said("Thursday", "10:00")).toContain("constraint, whole semester");
  });

  it("once taken, starts only from its button, and ending it early clears what was tried", () => {
    window.localStorage.setItem("coordinator-tools:preferences-tour", "taken");
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    fireEvent.click(within(step("How the tour works")).getByRole("button", { name: "Next" }));
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    const escaped = vi.fn();
    document.addEventListener("keydown", escaped);
    fireEvent.keyDown(document.body, { key: "Escape" });
    document.removeEventListener("keydown", escaped);
    expect(escaped).not.toHaveBeenCalled();
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).toContain("What you tried during the tour is cleared.");
    fireEvent.click(within(sure).getByRole("button", { name: "End the tour" }));
    // How to take it again says nothing of Save waiting.
    expect(step("Take the tour again").textContent).toContain("at the bottom right");
    expect(step("Take the tour again").textContent).not.toContain("Save draft");
    gotIt();
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect(said("Tuesday", "14:00")).toContain("fine");
  });

  it("holds each card for a reading time that follows how much it asks, before going on", () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 10, 10));
    tourPace.scale = 1;
    render(<WishesForm voice="you" collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    fireEvent.click(within(step("New here? Take the two-minute tour")).getByRole("button", { name: "Start the tour" }));
    const seconds = (title: string) => Number(/next step in (\d+) s/.exec(step(title).textContent ?? "")?.[1]);
    const next = (title: string) => within(step(title)).getByRole("button", { name: "Next" }) as HTMLButtonElement;
    const intro = seconds("How the tour works");
    expect(step("How the tour works").textContent).toContain("Read this card first");
    expect(next("How the tour works").disabled).toBe(true);
    wait((intro - 1) * 1000);
    expect(next("How the tour works").disabled).toBe(true);
    wait(1000);
    expect(next("How the tour works").disabled).toBe(false);
    fireEvent.click(next("How the tour works"));
    // Two short lines to read, against three longer ones: a shorter wait.
    const paint = seconds("Mark a time");
    expect(paint).toBeLessThan(intro);
    // A block made at once: Next waits for the card's own reading time all the same.
    stroke(["Tuesday", "14:00"], ["Tuesday", "15:00"]);
    expect(within(step("Mark a time")).getByText(/^Nicely done/)).toBeTruthy();
    expect(next("Mark a time").disabled).toBe(true);
    wait(paint * 1000);
    expect(next("Mark a time").disabled).toBe(false);
    fireEvent.click(next("Mark a time"));
    // One line, "Click the block you made", against four with two controls once its box is open.
    const opening = seconds("Open the block");
    tap("Tuesday", "14:00");
    wait(opening * 1000);
    wait(2000);
    expect(seconds("Set the block")).toBeGreaterThan(opening + 4);
  });
});

describe("the guided tour, for a coordinator answering for a teacher", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tourPace.scale = 0;
  });
  afterEach(() => {
    tourPace.scale = 1;
  });

  it("is not asked for: no card suggesting it, Save and Submit open at once; Guided tour still starts it", () => {
    // A browser that has never taken it, as a coordinator's often has not.
    render(<WishesForm collection={COLLECTION} calendar={CALENDAR} initial={null} onSave={() => {}} />);
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guided tour" }));
    expect(screen.getByRole("dialog", { name: "Guided tour: How the tour works" })).toBeTruthy();
    // Ended early: nothing pops up to say how to take it again, and nothing waits for it.
    fireEvent.click(screen.getByRole("button", { name: "End the tour" }));
    const sure = screen.getByRole("dialog", { name: "End the guided tour?" });
    expect(sure.textContent).not.toContain("Save and Submit stay off");
    fireEvent.click(within(sure).getByRole("button", { name: "End the tour" }));
    expect(screen.queryByRole("dialog", { name: /^Guided tour/ })).toBeNull();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
