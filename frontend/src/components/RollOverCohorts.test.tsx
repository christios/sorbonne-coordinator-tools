import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RollOverCohorts, nextSemesterName } from "@/components/RollOverCohorts";
import * as lists from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import type { Cohort } from "@/services/studentDatabase";

const cohort = (id: string, name: string, terms: string[], over: Partial<Cohort> = {}): Cohort =>
  ({ id, name, term: "2026-27", terms, memberCount: 100, follows: "", ...over }) as Cohort;

const L1 = cohort("l1-s1", "L1-S1", ["262710"]);
const L2 = cohort("l2-s1", "L2-S1", ["262710"], { memberCount: 60 });
const SEMESTERS = [
  { id: "hub-s1", name: "Semester 1 2026-27" },
  { id: "plan:262720", name: "Semester 2 2026-27" },
];
const LINKS = { "hub-s1": "262710", "plan:262720": "262720" };

afterEach(() => vi.restoreAllMocks());

function show(cohorts: Cohort[] = [L1, L2], onDone = vi.fn()) {
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue(LINKS);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RollOverCohorts
        from={SEMESTERS[0]}
        fromTerm="262710"
        fromCohorts={cohorts.filter((held) => held.terms.includes("262710"))}
        cohorts={cohorts}
        semesters={SEMESTERS}
        links={LINKS}
        onDone={onDone}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Roll over/ }));
  return onDone;
}

describe("rolling cohorts over into the next semester", () => {
  it("names the cohort it makes as the server does", () => {
    expect(nextSemesterName("L1-S1", "262720")).toBe("L1-S2");
    expect(nextSemesterName("FYS-S1", "262720")).toBe("FYS-S2");
    expect(nextSemesterName("Licence 1", "262720")).toBe("Licence 1 (262720)");
  });

  it("offers the next semester and shows what each cohort becomes", async () => {
    show();

    expect(await screen.findByText("L1-S2")).toBeTruthy();
    expect(screen.getByText("L2-S2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Roll over 2 cohorts" })).toBeTruthy();
  });

  it("rolls over the ticked ones into the chosen semester's portal term, then shows it", async () => {
    const roll = vi.spyOn(database, "rollOverCohort").mockImplementation(async (id) => ({
      cohort: cohort(`${id}-next`, id === "l1-s1" ? "L1-S2" : "L2-S2", ["262720"], { follows: id }),
      added: id === "l1-s1" ? 100 : 59,
      skipped: id === "l1-s1" ? [] : ["A000123"],
    }));
    const onDone = show();

    // Only L1 this time.
    fireEvent.click(await screen.findByRole("checkbox", { name: /L2-S1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Roll over 1 cohort" }));

    await waitFor(() => expect(roll).toHaveBeenCalledTimes(1));
    expect(roll).toHaveBeenCalledWith("l1-s1", "262720");
    expect(await screen.findByText(/100 students added/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Show Semester 2/ }));
    expect(onDone).toHaveBeenCalledWith("plan:262720", "l1-s1-next");
  });

  it("says which students were already in another cohort of that semester", async () => {
    vi.spyOn(database, "rollOverCohort").mockResolvedValue({
      cohort: cohort("x", "L2-S2", ["262720"]),
      added: 59,
      skipped: ["A000123"],
    });
    show([L2]);

    fireEvent.click(await screen.findByRole("button", { name: "Roll over 1 cohort" }));

    expect(await screen.findByText(/1 already in another cohort/)).toBeTruthy();
    expect(screen.getByText("A000123")).toBeTruthy();
  });

  it("takes an L1-S2 made by hand as the one to roll into", async () => {
    show([L1, cohort("by-hand", "L1-S2", ["262720"])]);

    expect(await screen.findByText(/L1-S2 was made by hand: it is linked to L1-S1/)).toBeTruthy();
  });

  it("says when a cohort has been rolled over before, and only adds who is missing", async () => {
    show([L1, cohort("l1-s2", "L1-S2", ["262720"], { follows: "l1-s1" })]);

    expect(await screen.findByText(/L1-S2 is already there: adds whoever/)).toBeTruthy();
  });
});
