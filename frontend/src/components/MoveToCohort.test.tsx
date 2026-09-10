import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MoveToCohort } from "@/components/MoveToCohort";
import type { Cohort } from "@/services/studentDatabase";

const COHORTS: Cohort[] = [
  { id: "cohort-1", name: "Foundation Year", term: "2026-27", memberCount: 40 } as Cohort,
  { id: "cohort-2", name: "L1", term: "2026-27", memberCount: 12 } as Cohort,
];

async function choose(option: string | RegExp) {
  const trigger = await screen.findByRole("combobox", { name: "Move to cohort" });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function show(describe_: (cohortId: string | null) => string) {
  render(
    <MoveToCohort
      open
      count={1}
      cohorts={COHORTS}
      describe={describe_}
      busy={false}
      onMove={vi.fn()}
      onNewCohort={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("moving students to another cohort", () => {
  it("says nothing about losing groups when the move costs nothing", async () => {
    // The reported bug. A student in no cohort, joining the cohort whose groups they
    // already hold, loses nothing — the server's DELETE is keyed on the cohort the
    // assignment is filed under, and that is already the destination. The dialog
    // nevertheless announced the loss, every time, in either direction.
    show(() => "");
    await choose(/^L1\b/);

    expect(screen.queryByText(/drops every group/i)).toBeNull();
    expect(screen.queryByText(/would lose/i)).toBeNull();
  });

  it("says what the move costs once a cohort with something to lose is chosen", async () => {
    show((cohortId) => (cohortId === "cohort-2" ? "2 students would lose 5 group placements in Semester 1." : ""));
    await choose(/^L1\b/);

    expect(screen.getByText(/2 students would lose 5 group placements/)).toBeTruthy();
  });

  it("promises nothing before a cohort has been chosen", () => {
    // The consequence depends entirely on the destination, so there is nothing true to
    // say until one is picked.
    show(() => "Somebody would lose something.");

    expect(screen.queryByText(/would lose/i)).toBeNull();
  });

  it("still warns plainly about taking them out of every cohort", async () => {
    show(() => "");
    await choose(/Take them out/);

    expect(screen.getByText(/every group they hold will be given up/i)).toBeTruthy();
  });
});
