import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaceInBlock } from "@/components/PlaceInBlock";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "cohort-1",
  name: "Foundation Year",
  term: "S1 2026-27",
  notes: "",
  majors: [], terms: [],
  yearLevel: "",
  memberCount: 239,
  scopeCount: 3,
  createdAt: "",
  updatedAt: "",
};

const CATALOGUE: database.Catalogue = {
  scopes: [
    {
      id: "scope-td",
      code: "TD",
      name: "Tutorials",
      note: "",
      kind: "shared", parentScopeId: "",
      courses: [],
      groups: [
        { id: "group-1", label: "1", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 20, crns: {} },
        { id: "group-2", label: "2", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} },
      ],
    },
  ],
};

function show(studentIds = ["A00025735", "A00026351"]) {
  const onPlaced = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlaceInBlock
        open
        cohort={COHORT}
        studentIds={studentIds}
        onClose={vi.fn()}
        onPlaced={onPlaced}
      />
    </QueryClientProvider>,
  );
  return onPlaced;
}

const pick = async (label: string, option: string | RegExp) => {
  // Each picker waits on the one before it — the blocks cannot be listed until the
  // semester's catalogue has arrived — so wait for it to open rather than for a fixed time.
  await waitFor(() =>
    expect((screen.getByRole("combobox", { name: label }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Physics & Maths — Semester 1" } as timetables.TimetableTerm,
    { id: "term-2", name: "Physics & Maths — Semester 2" } as timetables.TimetableTerm,
  ]);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue(CATALOGUE);
});

afterEach(() => vi.restoreAllMocks());

describe("placing students in a block", () => {
  it("says how many are being placed, and into which cohort", () => {
    show();

    expect(screen.getByText(/Place 2 students in a block/)).toBeTruthy();
    expect(screen.getByText(/Foundation Year/)).toBeTruthy();
  });

  it("asks for the semester before the block, because a block belongs to one", async () => {
    show();

    // "TD" in one semester is not "TD" in the next, so there is nothing to offer yet.
    expect(screen.getByText(/Choose a semester first/)).toBeTruthy();

    await pick("Semester", "Physics & Maths — Semester 1");
    await waitFor(() => expect(database.fetchCatalogue).toHaveBeenCalledWith("cohort-1", "term-1"));
  });

  it("places the selection in the chosen group", async () => {
    const assign = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    const onPlaced = show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    fireEvent.click(screen.getByRole("button", { name: /Place 2/ }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith("scope-td", ["A00025735", "A00026351"], "group-2");
    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
  });

  it("can take students out of a block, which is not the same as leaving them alone", async () => {
    const assign = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    const onPlaced = show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Take them out of this block/);
    fireEvent.click(screen.getByRole("button", { name: /Take them out/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("scope-td", expect.any(Array), null));
    // The report has to know it was a removal, or the page says "2 students placed".
    expect(onPlaced).toHaveBeenCalledWith(expect.objectContaining({ removed: true }));
  });

  it("forgets the block and group when the semester changes", async () => {
    // The bug this pins: block and group ids belong to one semester. Left standing, a
    // semester switch would place students into the semester they stopped looking at.
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    expect((screen.getByRole("button", { name: /Place 2/ }) as HTMLButtonElement).disabled).toBe(false);

    await pick("Semester", "Physics & Maths — Semester 2");

    expect((screen.getByRole("button", { name: /Place 2/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: "Block" }).textContent).toContain("Which block");
  });

  it("says so when the cohort has no blocks in that semester yet", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
    show();

    await pick("Semester", "Physics & Maths — Semester 1");

    expect(await screen.findByText(/has no blocks in this semester yet/)).toBeTruthy();
  });
});
