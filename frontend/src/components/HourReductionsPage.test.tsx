import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { HourReductionsPage } from "@/components/HourReductionsPage";
import * as reductions from "@/services/hourReductions";
import type { ReductionItem, ReductionRule, ReductionYear } from "@/services/hourReductions";

vi.mock("@/components/PortalSemesterMenu", () => ({
  usePortalSemester: () => ({ semesters: [], semester: { id: "s1", name: "Semester 1" }, setTermId: () => {}, term: "262710", settled: true }),
  PortalSemesterMenu: () => null,
}));

const RULES: ReductionRule[] = [
  { kind: "phd", group: "safir", label: "PhD students", unit: "students", per: 5, cap: 20, rule: "5 h for each PhD student, up to 20 h." },
  {
    kind: "hod", group: "department", label: "Head of department", unit: "choice", per: 0, cap: null, rule: "",
    options: [{ key: "hod", label: "Department of up to 200 students", hours: 32 }, { key: "hod-200", label: "Department of over 200 students", hours: 42 }],
  },
];
const sheetOf = (phd: Partial<ReductionItem>, hod: Partial<ReductionItem>) => {
  const items: ReductionItem[] = [
    { ...RULES[0], amount: 0, detail: "", hours: 0, state: "", updatedAt: "", updatedBy: "", validatedAt: "", ...phd },
    { ...RULES[1], amount: 0, detail: "", hours: 0, state: "", updatedAt: "", updatedBy: "", validatedAt: "", ...hod },
  ];
  const total = items.reduce((sum, item) => sum + item.hours, 0);
  return { year: "2026-2027", service: 192, items, total, owed: 192 - total, declaredAt: "", declaredBy: "", note: "" };
};
const YEAR = (canChange: boolean, canChangeRules = canChange): ReductionYear => ({
  year: "2026-2027",
  service: 192,
  rules: RULES,
  canChange,
  canChangeRules,
  teachers: [
    {
      teacherId: "t-lama", name: "Lama Tarsissi", fullTime: true, head: true,
      ...sheetOf({ amount: 2, hours: 10, state: "declared" }, { detail: "hod-200", amount: 1, hours: 42, state: "set" }),
      declaredAt: "2026-11-16T09:00:00Z", note: "Two theses",
    },
    { teacherId: "t-grace", name: "Grace Younes", fullTime: true, head: false, ...sheetOf({}, {}) },
  ],
});

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HourReductionsPage />
    </QueryClientProvider>,
  );

beforeEach(() => vi.restoreAllMocks());

describe("Hour reductions, every full-timer's year", () => {
  it("lists every full-timer with each figure in hours and what it is made of", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(false));
    page();

    const lama = (await screen.findByText("Lama Tarsissi")).closest("[role=listitem]") as HTMLElement;
    // PhD: 10 h, made of 2 students, still to validate; HoD 42 h; total 52 h, 140 h owed.
    expect(within(lama).getByLabelText("PhD students, Lama Tarsissi: 10 h, 2 students, declared by the teacher, to validate with SAFIR")).toBeTruthy();
    expect(within(lama).getByText("2 students")).toBeTruthy();
    expect(within(lama).getByLabelText("Head of department, Lama Tarsissi: 42 h, Over 200")).toBeTruthy();
    expect(within(lama).getByText("52 h")).toBeTruthy();
    expect(within(lama).getByText("140 h")).toBeTruthy();
    // The teacher's note and when they declared, on the row itself.
    expect(within(lama).getByText(/“Two theses”/)).toBeTruthy();
    expect(within(lama).getByText(/Declared 16 Nov/)).toBeTruthy();
    expect(screen.getByText(/1 research figure to validate/)).toBeTruthy();
    expect((screen.getByText("Grace Younes").closest("[role=listitem]") as HTMLElement).textContent).toContain("Not declared yet");
    // Reading only: no figure opens, no rules to change.
    expect(screen.queryByRole("button", { name: /^PhD students/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Rules/ })).toBeNull();
  });
});

describe("changing a figure where it stands", () => {
  const open = async (name: RegExp) => fireEvent.click(await screen.findByRole("button", { name }));

  it("validates a teacher's research figures from their row", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockResolvedValue(sheetOf({ amount: 2, hours: 10, state: "validated" }, { detail: "hod-200", amount: 1, hours: 42, state: "set" }));
    page();

    fireEvent.click(await screen.findByRole("button", { name: /Validate it with SAFIR/ }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-2027", "t-lama", { phd: { amount: 2, detail: "", validated: true } }));
  });

  it("validates one figure with the tick in its editor", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockResolvedValue(sheetOf({ amount: 2, hours: 10, state: "validated" }, {}));
    page();

    await open(/^PhD students, Lama Tarsissi/);
    expect(screen.getByText("students =").textContent).toContain("10 h");
    fireEvent.click(screen.getByRole("checkbox", { name: "Validated with SAFIR" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-2027", "t-lama", { phd: { amount: 2, detail: "", validated: true } }));
  });

  it("sets the department's own by choosing an option", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockResolvedValue(sheetOf({ amount: 2, hours: 10, state: "declared" }, { detail: "hod", amount: 1, hours: 32, state: "set" }));
    page();

    await open(/^Head of department, Lama Tarsissi/);
    fireEvent.click(screen.getByRole("radio", { name: /Department of up to 200 students/ }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-2027", "t-lama", { hod: { amount: 1, detail: "hod" } }));
  });

  it("saves a count when the editor closes, and shows the sums at once", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    let answer: (sheet: ReturnType<typeof sheetOf>) => void = () => {};
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockReturnValue(new Promise((resolve) => (answer = resolve)));
    page();

    await open(/^PhD students, Grace Younes/);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Students" }), { target: { value: "3" } });
    // What the count comes to, before it is saved.
    expect(screen.getByText("students =").textContent).toContain("15 h");
    fireEvent.submit(screen.getByRole("spinbutton", { name: "Students" }).closest("form") as HTMLFormElement);

    await waitFor(() => expect(save).toHaveBeenCalledWith("2026-2027", "t-grace", { phd: { amount: 3, detail: "", validated: false } }));
    const grace = screen.getByText("Grace Younes").closest("[role=listitem]") as HTMLElement;
    await waitFor(() => expect(within(grace).getByText("177 h")).toBeTruthy());
    expect(within(grace).getByText("3 students")).toBeTruthy();
    answer(sheetOf({ amount: 3, hours: 15, state: "declared" }, {}));
    expect(await screen.findByText("Saved")).toBeTruthy();
  });

  it("leaves a figure as it was on Cancel", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockResolvedValue(sheetOf({}, {}));
    page();

    await open(/^PhD students, Lama Tarsissi/);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Students" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Done" })).toBeNull());
    expect(save).not.toHaveBeenCalled();
  });

  it("says what the server refused, and for whom", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    vi.spyOn(reductions, "saveDepartmentReductions").mockRejectedValue(new Error("PhD students: give a whole number of students."));
    page();

    await open(/^PhD students, Grace Younes/);
    // A whole-number box will not submit 1.5 itself; a click elsewhere still closes it, and saves.
    fireEvent.change(screen.getByRole("spinbutton", { name: "Students" }), { target: { value: "1.5" } });
    fireEvent.submit(screen.getByRole("spinbutton", { name: "Students" }).closest("form") as HTMLFormElement);

    expect((await screen.findByRole("alert")).textContent).toBe("Grace Younes: PhD students: give a whole number of students.");
  });
});

describe("the hours a rule gives", () => {
  it("counts students up to the cap, and an option by its own hours", () => {
    expect(reductions.hoursOf(RULES[0], 3, "")).toBe(15);
    expect(reductions.hoursOf(RULES[0], 9, "")).toBe(20);
    expect(reductions.hoursOf(RULES[1], 1, "hod-200")).toBe(42);
    expect(reductions.hoursOf({ ...RULES[0], kind: "committees", unit: "committees", per: 3 }, 2, "budget,ethics")).toBe(6);
  });

  it("lets the Head of Department set reductions, but not the rules", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true, false));
    page();

    expect(await screen.findByRole("button", { name: /^PhD students, Lama Tarsissi/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rules/ })).toBeNull();
  });
});
