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
  it("lays the year out as the department's table, marking what is still to validate", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(false));
    page();

    const lama = (await screen.findByRole("button", { name: "Lama Tarsissi" })).closest("tr") as HTMLElement;
    // PhD 10, HoD 42, total 52, owed 140.
    expect(within(lama).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["Lama TarsissiHoD", "10", "42", "52", "140"]);
    expect(within(lama).getByText("10").getAttribute("title")).toBe("Declared, to be validated with SAFIR");
    expect(screen.getByText(/1 research figure to validate/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Grace Younes" }).closest("tr") as HTMLElement).textContent).toContain("Not declared yet");
    // Reading only: no rules to change.
    expect(screen.queryByRole("button", { name: /Rules/ })).toBeNull();
  });

  it("lets an administrator validate a research figure and set the department's own", async () => {
    vi.spyOn(reductions, "fetchReductionYear").mockResolvedValue(YEAR(true));
    const save = vi.spyOn(reductions, "saveDepartmentReductions").mockResolvedValue(sheetOf({}, {}));
    page();

    fireEvent.click(await screen.findByRole("button", { name: "Lama Tarsissi" }));
    expect(await screen.findByText(/“Two theses”/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "PhD students validated with SAFIR" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Head of department" }), { target: { value: "hod" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith("2026-2027", "t-lama", {
        phd: { amount: 2, detail: "", validated: true },
        hod: { amount: 1, detail: "hod", validated: false },
      }),
    );
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

    expect(await screen.findByRole("button", { name: "Lama Tarsissi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Rules/ })).toBeNull();
  });
});
