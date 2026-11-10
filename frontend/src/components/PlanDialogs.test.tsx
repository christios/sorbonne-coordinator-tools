import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanClassDialog, PlanSettingsDialog, ScopeDialog, WeekPicker } from "@/components/PlanDialogs";
import * as lists from "@/services/portalLists";
import type { Plan } from "@/services/semesterPlans";
import * as teachers from "@/services/teachers";
import type { WishTeacher } from "@/services/teacherWishes";

describe("the question a change to a repeating class asks", () => {
  const ask = (week: number, onChoose = vi.fn()) =>
    render(
      <ScopeDialog
        open
        verb="change"
        when="Tuesday 19 Jan"
        week={week}
        firstWeek={1}
        count={14}
        movedApart={2}
        busy={false}
        onChoose={onChoose}
        onClose={() => {}}
      />,
    );

  it("offers this and the following only after the series' first week", () => {
    const { unmount } = ask(1);
    expect(screen.queryByRole("radio", { name: /following/ })).toBeNull();
    unmount();
    ask(3);
    expect(screen.getByRole("radio", { name: /following/ })).toBeTruthy();
  });

  it("says that the whole series puts the classes changed on their own back in line", () => {
    ask(3);
    expect(screen.getByRole("radio", { name: /All classes/ }).textContent).toContain("2 changed on their own will follow");
  });

  it("answers this class unless told otherwise", () => {
    const onChoose = vi.fn();
    ask(3, onChoose);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenCalledWith("one");
    fireEvent.click(screen.getByRole("radio", { name: /following/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenLastCalledWith("following");
  });
});

describe("the weeks a class meets in", () => {
  it("takes the odd weeks in one press, and a week on or off in another", () => {
    const onChange = vi.fn();
    render(<WeekPicker count={6} value={[1, 2]} onChange={onChange} dateOf={() => "11 Jan"} />);
    fireEvent.click(screen.getByRole("button", { name: "Odd weeks" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 5]);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 4]);
  });
});

describe("placing a class", () => {
  it("shows the chosen class's teacher from Groups & CRNs, to be changed there", async () => {
    const plan = {
      termCode: "262720",
      semesterId: "plan:262720",
      name: "S2",
      weekOne: "2027-01-11",
      weeks: 14,
      without: [],
      holidays: [],
      updatedAt: "",
      updatedBy: "",
      series: [],
      classes: [],
      skipped: [],
      sections: [
        {
          id: "s1", crn: "22229", parentCrn: "", courseCode: "MATH-002", title: "Elements of Calculus GA- CM", ue: "",
          component: "CM", programmes: ["FYS"], groupLabel: "GA", teacherName: "Bilal Maaz", hours: 60, hoursSaid: "60CM",
          duration: "1.5", places: [], gone: false, comments: "", position: 0, updatedAt: "", updatedBy: "",
        },
        {
          id: "s2", crn: "22230", parentCrn: "", courseCode: "MATH-002", title: "Elements of Calculus GB- CM", ue: "",
          component: "CM", programmes: ["FYS"], groupLabel: "GB", teacherName: "", hours: 60, hoursSaid: "60CM",
          duration: "", places: [], gone: true, comments: "", position: 1, updatedAt: "", updatedBy: "",
        },
      ],
    } satisfies Plan;
    const onSave = vi.fn();
    render(
      <PlanClassDialog
        open
        plan={plan}
        rooms={[]}
        initial={{ sectionId: "", weekday: 1, startsAt: "08:30", endsAt: "10:00", room: "", teacherName: "", weeks: [1, 2], note: "" }}
        busy={false}
        error=""
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Class" }));
    // A class no longer on Groups & CRNs is not offered.
    expect(screen.queryByText(/GB- CM/)).toBeNull();
    fireEvent.click(await screen.findByText("MATH-002 · Elements of Calculus GA- CM · GA"));
    expect(screen.getByText("Bilal Maaz")).toBeTruthy();
    expect(screen.getByText(/Set on Groups & CRNs/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Bilal Maaz")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Place it" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "s1" }));
  });
});

const BARE: Plan = {
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
  sections: [
    {
      id: "s1", crn: "22229", parentCrn: "", courseCode: "MATH-002", title: "Elements of Calculus GA- CM", ue: "",
      component: "CM", programmes: ["FYS"], groupLabel: "GA", teacherName: "Bilal Maaz", teacherId: "t-bilal", hours: 60,
      hoursSaid: "60CM", duration: "1.5", places: [], gone: false, comments: "", position: 0, updatedAt: "", updatedBy: "",
    },
  ],
};

describe("a class beside its teacher's wishes", () => {
  const bilal = (wishes: WishTeacher["wishes"]): WishTeacher => ({ teacherId: "t-bilal", name: "Bilal Maaz", email: "", wishes });
  const open = (teacher: WishTeacher, weekday: number) =>
    render(
      <PlanClassDialog
        open
        plan={BARE}
        rooms={[]}
        initial={{ sectionId: "s1", weekday, startsAt: "15:00", endsAt: "16:30", room: "", teacherName: "", weeks: [1], note: "" }}
        busy={false}
        error=""
        onSave={() => {}}
        onClose={() => {}}
        wishTeachers={[teacher]}
      />,
    );

  it("folds them to a line, and opens to the list, Musts first, the ones this time breaks marked", () => {
    open(
      bilal({
        status: "submitted", cells: [], limits: { freeDay: 1 }, away: [{ from: "2027-02-01", to: "2027-02-05", reason: "conference" }],
        needs: "A lab", note: "", levels: {}, comments: {}, overCapReason: "", source: "coordinator", submittedAt: "", updatedAt: "", updatedBy: "",
        lines: [
          { key: "freeDay", kind: "freeDay", value: 1, level: "would", comment: "" },
          { key: "cant:14-18:2", kind: "cant", days: [2], from: 14, to: 18, level: "must", comment: "School run" },
        ],
      }),
      2,
    );
    expect(screen.getByText("1 Must · 1 Would like")).toBeTruthy();
    expect(screen.getByText("· 1 broken at this time")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Bilal Maaz's wishes" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    const items = within(screen.getByRole("list", { name: "Bilal Maaz's wishes" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items).toEqual(["MustCan't teach Tue 14:00–18:00 — this time breaks it“School run”", "Would likeMonday free"]);
    expect(screen.getByText(/Away 1 Feb–5 Feb \(conference\)/)).toBeTruthy();
    expect(screen.getByText("Needs: A lab")).toBeTruthy();
  });

  it("says first what goes wrong at the time chosen", () => {
    open(
      bilal({
        status: "submitted", cells: Array.from({ length: 16 }, (_, quarter) => ({ day: 2, hour: 14 + quarter / 4, kind: "cant" as const })), limits: {}, away: [],
        needs: "", note: "", levels: { "cant:14-18:2": "must" }, comments: { "cant:14-18:2": "School run" }, overCapReason: "",
        source: "coordinator", submittedAt: "", updatedAt: "", updatedBy: "",
        lines: [{ key: "cant:14-18:2", kind: "cant", days: [2], from: 14, to: 18, level: "must", comment: "School run" }],
      }),
      2,
    );
    const strip = screen.getByRole("status");
    expect(strip.textContent).toContain("1 problem at this time");
    expect(within(strip).getByText("Must · Bilal Maaz: Can't teach Tue 14:00–18:00 — “School run”")).toBeTruthy();
  });

  it("says when the teacher hasn't answered", () => {
    open(bilal(null), 2);
    expect(screen.getByText(/Bilal Maaz hasn.t given their wishes/)).toBeTruthy();
  });
});

describe("periods that bind everybody", () => {
  const settings = (plan: Plan, onSave = vi.fn()) => {
    vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({});
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlanSettingsDialog open plan={plan} busy={false} error="" onSave={onSave} onClose={() => {}} />
      </QueryClientProvider>,
    );
    return onSave;
  };
  const ramadan = { label: "Ramadan", from: "2027-02-08", to: "2027-03-09", days: [1, 2, 3, 4, 5], blockFrom: "15:00", blockTo: "19:00" };

  it("keeps a semester's periods when it is saved, and lets one go", () => {
    const onSave = settings({ ...BARE, periods: [ramadan] });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ periods: [ramadan] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Ramadan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ periods: [] }));
  });

  it("starts a new one as the working week ending at three, and saves nothing until it is named and dated", () => {
    settings(BARE);
    fireEvent.click(screen.getByRole("button", { name: "Add a period" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Give it a name.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Friday" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Saturday" }).getAttribute("aria-pressed")).toBe("false");
    expect((screen.getByRole("checkbox", { name: "Day ends by" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByPlaceholderText("Ramadan"), { target: { value: "Ramadan" } });
    expect(screen.getByText("Give it a first and a last day.")).toBeTruthy();
  });

  it("takes any of its four rules, ticked, and asks for one at least", () => {
    const onSave = settings({ ...BARE, periods: [{ ...ramadan, blockFrom: "", blockTo: "", endsBy: "15:00", longest: null, dailyMax: null }] });
    fireEvent.click(screen.getByRole("checkbox", { name: "Day ends by" }));
    expect(screen.getByText("Tick at least one rule.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Longest class" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "No classes between" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Most hours a day for a teacher" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        periods: [expect.objectContaining({ endsBy: "", longest: 90, blockFrom: "12:15", blockTo: "12:45", dailyMax: 240 })],
      }),
    );
  });
});
