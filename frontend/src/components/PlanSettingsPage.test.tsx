import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanSettingsPage } from "@/components/PlanSettingsPage";
import * as lists from "@/services/portalLists";
import type { Plan } from "@/services/semesterPlans";
import { breaksOutside, holidayDays, holidayRanges, semesterWeeks, semesterWords, toggleBreak } from "@/services/semesterSettings";
import * as teachers from "@/services/teachers";

const BARE = {
  termCode: "262720",
  semesterId: "plan:262720",
  name: "S2",
  weekOne: "2027-01-11",
  weeks: 14,
  without: [],
  holidays: [],
  periods: [],
  updatedAt: "",
  updatedBy: "",
  series: [],
  classes: [],
  skipped: [],
  sections: [],
} as unknown as Plan;

const page = (plan: Plan, onSave = vi.fn(), onBack = vi.fn()) => {
  vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({});
  vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlanSettingsPage plan={plan} busy={false} error="" onSave={onSave} onBack={onBack} />
    </QueryClientProvider>,
  );
  return { onSave, onBack };
};
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const ramadan = { label: "Ramadan", from: "2027-02-08", to: "2027-03-09", days: [1, 2, 3, 4, 5], blockFrom: "15:00", blockTo: "19:00" };

describe("a holiday of several days", () => {
  it("is kept a day each under its name, and read back as one", () => {
    const days = holidayDays([{ from: "2027-03-30", to: "2027-04-01", label: "Eid al-Fitr" }]);
    expect(days).toEqual([
      { date: "2027-03-30", label: "Eid al-Fitr" },
      { date: "2027-03-31", label: "Eid al-Fitr" },
      { date: "2027-04-01", label: "Eid al-Fitr" },
    ]);
    expect(holidayRanges([...days, { date: "2027-05-01", label: "Labour Day" }])).toEqual([
      { from: "2027-03-30", to: "2027-04-01", label: "Eid al-Fitr" },
      { from: "2027-05-01", to: "2027-05-01", label: "Labour Day" },
    ]);
  });

  it("is entered as a first and a last day on the page", () => {
    const { onSave } = page({ ...BARE, holidays: [{ date: "2027-03-31", label: "Eid al-Fitr" }, { date: "2027-04-01", label: "Eid al-Fitr" }] });
    // Two days of one name in a row: one holiday of two days.
    expect(screen.getAllByRole("button", { name: /Remove holiday/ })).toHaveLength(1);
    expect(screen.getByText(/^2 days/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Eid al-Fitr"), { target: { value: "Eid" } });
    save();
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ holidays: [{ date: "2027-03-31", label: "Eid" }, { date: "2027-04-01", label: "Eid" }] }),
    );
  });
});

describe("the weeks without classes", () => {
  it("are weeks of the semester: a break pushes the weeks after it on", () => {
    const weeks = semesterWeeks("2027-01-11", 3, ["2027-01-20"]);
    expect(weeks).toEqual([
      { monday: "2027-01-11", number: 1 },
      { monday: "2027-01-18", number: null },
      { monday: "2027-01-25", number: 2 },
      { monday: "2027-02-01", number: 3 },
    ]);
    expect(toggleBreak(["2027-01-18"], "2027-01-18")).toEqual([]);
    expect(toggleBreak([], "2027-01-25")).toEqual(["2027-01-25"]);
    expect(breaksOutside("2027-01-11", 3, ["2027-06-07"])).toEqual(["2027-06-07"]);
    expect(semesterWords("2027-01-11", 3, ["2027-01-18"])).toBe(
      "Week 1 starts Mon 11 Jan 2027 · 3 teaching weeks · 1 break · last week ends Fri 5 Feb 2027",
    );
  });

  it("are pressed on the page, and Week 1 is not one", () => {
    const { onSave } = page(BARE);
    const weeks = within(screen.getByRole("group", { name: "The semester's weeks" }));
    expect((weeks.getByRole("button", { name: /^Week 1, 11 Jan/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(weeks.getByRole("button", { name: "Week 3, 25 Jan: make it a break" }));
    expect(weeks.getByRole("button", { name: "Break, week of 25 Jan: teach this week again" }).getAttribute("aria-pressed")).toBe("true");
    // The 14 teaching weeks now end a week later.
    expect(weeks.getByRole("button", { name: "Week 14, 19 Apr: make it a break" })).toBeTruthy();
    save();
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ without: ["2027-01-25"] }));
  });
});

describe("periods that bind everybody", () => {
  it("are a line each, folded, and open to be edited", () => {
    page({ ...BARE, periods: [ramadan] });
    expect(screen.getByRole("button", { name: "Edit Ramadan" }).textContent).toContain("8 Feb – 9 Mar");
    expect(screen.getByRole("button", { name: "Edit Ramadan" }).textContent).toContain("none 15:00–19:00");
    expect(screen.queryByPlaceholderText("Ramadan")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Ramadan" }));
    expect(screen.getByPlaceholderText("Ramadan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    expect(screen.queryByPlaceholderText("Ramadan")).toBeNull();
  });

  it("keep a semester's periods when it is saved, and let one go", () => {
    const { onSave } = page({ ...BARE, periods: [ramadan, { ...ramadan, label: "Exams", from: "2027-05-03", to: "2027-05-14" }] });
    fireEvent.click(screen.getByRole("button", { name: "Remove Exams" }));
    save();
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ periods: [ramadan] }));
  });

  it("copy one to make another like it", () => {
    const { onSave } = page({ ...BARE, periods: [ramadan] });
    fireEvent.click(screen.getByRole("button", { name: "Copy Ramadan" }));
    // The copy opens, to be given its own dates.
    expect(screen.getByDisplayValue("Ramadan (copy)")).toBeTruthy();
    save();
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ periods: [ramadan, { ...ramadan, label: "Ramadan (copy)" }] }));
  });

  it("start a new one as the working week ending at three, and save nothing until it is named and dated", () => {
    page(BARE);
    fireEvent.click(screen.getByRole("button", { name: "Add a period" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("Give it a name.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Friday" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Saturday" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("checkbox", { name: "Day ends by" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Ramadan"), { target: { value: "Ramadan" } });
    expect(screen.getAllByText("Give it a first and a last day.").length).toBeGreaterThan(0);
    // Save says why it waits.
    expect(screen.getByRole("status").textContent).toContain("Ramadan: give it a first and a last day.");
  });

  it("take any of their four rules, ticked, and ask for one at least", () => {
    const { onSave } = page({ ...BARE, periods: [{ ...ramadan, blockFrom: "", blockTo: "", endsBy: "15:00", longest: null, dailyMax: null }] });
    fireEvent.click(screen.getByRole("button", { name: "Edit Ramadan" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Day ends by" }));
    expect(screen.getAllByText("Tick at least one rule.").length).toBeGreaterThan(0);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Longest class" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "No classes between" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Most hours a day for a teacher" }));
    save();
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        periods: [expect.objectContaining({ endsBy: "", longest: 90, blockFrom: "12:15", blockTo: "12:45", dailyMax: 240 })],
      }),
    );
  });

  it("are searched by name once there are many", () => {
    const many = Array.from({ length: 8 }, (_, at) => ({ ...ramadan, label: `Exam day ${at + 1}`, from: `2027-05-0${at + 1}`, to: `2027-05-0${at + 1}` }));
    page({ ...BARE, periods: many });
    fireEvent.change(screen.getByPlaceholderText("Search periods"), { target: { value: "day 3" } });
    expect(screen.getAllByRole("button", { name: /^Edit Exam day/ }).map((button) => button.getAttribute("aria-label"))).toEqual(["Edit Exam day 3"]);
  });
});

describe("leaving the page", () => {
  it("goes straight back with nothing changed, and asks first with changes", () => {
    const { onBack } = page(BARE);
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Semesters" }));
    expect(onBack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Week 3, 25 Jan: make it a break" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Semesters" }));
    expect(screen.getByRole("dialog", { name: "Discard your changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
