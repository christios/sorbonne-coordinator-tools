import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RollOverTab } from "@/components/RollOverTab";
import * as lists from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import type { Cohort } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const SEMESTERS = [
  { id: "plan:262720", name: "Semester 2 2026-27" },
  { id: "hub-s1", name: "Semester 1 2026-27" },
];
const LINKS = { "hub-s1": "262710", "plan:262720": "262720" };

const l1 = (memberCounts: Record<string, number>): Cohort =>
  ({ id: "l1", name: "L1", term: "2026-27", terms: ["262710"], memberCount: 109, memberCounts }) as Cohort;

afterEach(() => vi.restoreAllMocks());

function show(cohort: Cohort, onDone = vi.fn()) {
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue(LINKS);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue(SEMESTERS as never);
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue([
    { cohort, scopes: [{ termId: "hub-s1" }, { termId: "hub-s1" }, { termId: "plan:262720" }] },
  ] as never);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RollOverTab cohort={cohort} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe("a cohort's semesters, and rolling it over", () => {
  it("lists each semester of its year with what it holds there, in the portal's order", async () => {
    show(l1({ "hub-s1": 109 }));

    const list = await screen.findByRole("region", { name: "L1's semesters" });
    await waitFor(() =>
      expect([...list.querySelectorAll("li")].map((row) => row.textContent)).toEqual([
        "Semester 1 2026-27109 students · 2 sets",
        "Semester 2 2026-270 students · 1 set",
      ]),
    );
  });

  it("copies the first semester's students into the next one, then shows them there", async () => {
    const roll = vi.spyOn(database, "rollOverCohort").mockResolvedValue({
      cohort: l1({ "hub-s1": 109, "plan:262720": 109 }),
      added: 109,
      skipped: [],
    });
    const onDone = show(l1({ "hub-s1": 109 }));

    fireEvent.click(await screen.findByRole("button", { name: "Roll over into Semester 2 2026-27" }));

    await waitFor(() => expect(roll).toHaveBeenCalledWith("l1", "hub-s1", "plan:262720"));
    expect(await screen.findByText(/109 students added/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show L1 in Semester 2 2026-27" }));
    expect(onDone).toHaveBeenCalledWith("plan:262720", "l1");
  });

  it("says when the next semester already holds some, and names who was elsewhere", async () => {
    vi.spyOn(database, "rollOverCohort").mockResolvedValue({ cohort: l1({}), added: 3, skipped: ["A000123"] });
    show(l1({ "hub-s1": 109, "plan:262720": 105 }));

    expect(await screen.findByText(/L1 already holds 105 students in Semester 2 2026-27/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Roll over into Semester 2 2026-27" }));
    expect(await screen.findByText(/1 already in another cohort there/)).toBeTruthy();
    expect(screen.getByText("A000123")).toBeTruthy();
  });

  it("has nobody to roll over before it holds any students", async () => {
    show(l1({}));

    expect(await screen.findByText(/L1 holds no students yet/)).toBeTruthy();
  });
});
