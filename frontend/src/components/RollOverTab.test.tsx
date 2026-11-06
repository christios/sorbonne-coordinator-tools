import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RollOverTab, nextSemesterName } from "@/components/RollOverTab";
import * as lists from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import type { Cohort } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const cohort = (id: string, name: string, terms: string[], over: Partial<Cohort> = {}): Cohort =>
  ({ id, name, term: "2026-27", terms, memberCount: 100, follows: "", ...over }) as Cohort;

const L1 = cohort("l1-s1", "L1-S1", ["262710"]);
const SEMESTERS = [
  { id: "hub-s1", name: "Semester 1 2026-27" },
  { id: "plan:262720", name: "Semester 2 2026-27" },
];
const LINKS = { "hub-s1": "262710", "plan:262720": "262720" };

afterEach(() => vi.restoreAllMocks());

function show(others: Cohort[] = [], onDone = vi.fn(), of: Cohort = L1) {
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue(LINKS);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue(SEMESTERS as never);
  vi.spyOn(database, "fetchCohorts").mockResolvedValue([of, ...others]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RollOverTab cohort={of} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe("rolling a cohort over into the next semester", () => {
  it("names the cohort it makes as the server does", () => {
    expect(nextSemesterName("L1-S1", "262720")).toBe("L1-S2");
    expect(nextSemesterName("FYS-S1", "262720")).toBe("FYS-S2");
    expect(nextSemesterName("Licence 1", "262720")).toBe("Licence 1 (262720)");
  });

  it("offers the next semester and says what the cohort becomes", async () => {
    show();

    expect(await screen.findByText(/A new cohort with L1-S1's settings and rules, and its 100 students/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll over into L1-S2" })).toBeTruthy();
  });

  it("rolls over into the chosen semester's portal term, then shows the cohort it made", async () => {
    const roll = vi.spyOn(database, "rollOverCohort").mockResolvedValue({
      cohort: cohort("l1-s2", "L1-S2", ["262720"], { follows: "l1-s1" }),
      added: 100,
      skipped: [],
    });
    const onDone = show();

    await screen.findByText(/A new cohort with L1-S1's settings/);
    fireEvent.click(screen.getByRole("button", { name: "Roll over into L1-S2" }));

    await waitFor(() => expect(roll).toHaveBeenCalledWith("l1-s1", "262720"));
    expect(await screen.findByText(/100 students added/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show L1-S2" }));
    expect(onDone).toHaveBeenCalledWith("plan:262720", "l1-s2");
  });

  it("says which students were already in another cohort of that semester", async () => {
    vi.spyOn(database, "rollOverCohort").mockResolvedValue({
      cohort: cohort("l1-s2", "L1-S2", ["262720"]),
      added: 99,
      skipped: ["A000123"],
    });
    show();

    await screen.findByText(/A new cohort with L1-S1's settings/);
    fireEvent.click(screen.getByRole("button", { name: "Roll over into L1-S2" }));

    expect(await screen.findByText(/1 already in another cohort/)).toBeTruthy();
    expect(screen.getByText("A000123")).toBeTruthy();
  });

  it("takes an L1-S2 made by hand as the one to roll into", async () => {
    show([cohort("by-hand", "L1-S2", ["262720"])]);

    expect(await screen.findByText(/L1-S2 was made by hand: it is linked to L1-S1/)).toBeTruthy();
  });

  it("says when it has been rolled over before, and only adds who is missing", async () => {
    show([cohort("l1-s2", "L1-S2", ["262720"], { follows: "l1-s1" })]);

    expect(await screen.findByText(/L1-S2 is already there: adds whoever/)).toBeTruthy();
  });

  it("has nowhere to go from the last semester linked", async () => {
    show([], vi.fn(), cohort("l1-s2", "L1-S2", ["262720"]));

    expect(await screen.findByText(/No semester after 262720 is linked/)).toBeTruthy();
  });
});
