import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FillBlock } from "@/components/FillBlock";
import * as roster from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";

const COHORT: database.Cohort = {
  id: "cohort-1",
  name: "Foundation Year",
  term: "S1 2026-27",
  notes: "",
  program: "",
  yearLevel: "",
  memberCount: 3,
  scopeCount: 1,
  createdAt: "",
  updatedAt: "",
};

const student = (studentId: string): database.Student => ({
  studentId,
  status: "in_portal",
  cohortId: "cohort-1",
  cohortName: "Foundation Year",
  cohortSince: "",
  firstSeenAt: "",
  lastSeenAt: "",
  groups: [],
});

const TD: database.CatalogueScope = {
  id: "scope-td",
  code: "TD",
  name: "Tutorials",
  note: "",
  courses: [],
  groups: [
    { id: "td-1", label: "1", capacity: 2, note: "", program: "", assigned: 1, crns: {} },
    { id: "td-2", label: "2", capacity: 2, note: "", program: "Physics", assigned: 0, crns: {} },
  ],
};

function show(clashes: Parameters<typeof FillBlock>[0]["clashes"] = []) {
  const onFilled = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <FillBlock open cohort={COHORT} scope={TD} clashes={clashes} onClose={() => {}} onFilled={onFilled} />
    </QueryClientProvider>,
  );
  return onFilled;
}

beforeEach(() => {
  // A1 already sits in TD 1; A2 and A3 are in the cohort and not yet in TD; B9 is somebody else's.
  vi.spyOn(database, "fetchStudents").mockResolvedValue([
    student("A1"),
    student("A2"),
    student("A3"),
    { ...student("B9"), cohortId: "cohort-2" },
  ]);
  vi.spyOn(database, "fetchAssignments").mockResolvedValue({ A1: { "scope-td": "td-1" }, A3: { "scope-rdns": "rdns-8" } });
  vi.spyOn(roster, "namesHeld").mockResolvedValue({ A2: "Amira Haddad", A3: "Bilal Saleh" });
  vi.spyOn(roster, "fieldHeld").mockImplementation(async (field) =>
    field === "MAJOR_CODE_DESC" ? { A2: "Physics", A3: "Maths" } : field === "FIRST_NAME" ? { A2: "Amira", A3: "Bilal" } : { A2: "Haddad", A3: "Saleh" },
  );
});

afterEach(() => vi.restoreAllMocks());

describe("filling a block", () => {
  it("previews who goes where before anything is written, and then writes exactly that", async () => {
    vi.spyOn(database, "placeStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    const onFilled = show();

    const list = await screen.findByLabelText("Who goes where");
    // Amira is Physics, and TD 2 prefers Physics: she goes there first. Bilal balances to TD 1's empty seat.
    expect(within(list).getByText("Amira Haddad").closest("li")?.textContent).toContain("→ 2 · preferred");
    expect(within(list).getByText("Bilal Saleh").closest("li")?.textContent).toContain("→ 1");
    expect(database.placeStudents).not.toHaveBeenCalled();

    const sizes = screen.getByLabelText("Group sizes after the fill");
    expect(within(sizes).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "GroupNowAfterCapacityPrefers",
      "1122",
      "2012Physics",
    ]);

    fireEvent.click(screen.getByText("Place 2"));
    await waitFor(() => expect(database.placeStudents).toHaveBeenCalledWith("scope-td", { "td-2": ["A2"], "td-1": ["A3"] }));
    expect(onFilled).toHaveBeenCalledWith({ assigned: 2, skipped: [], scopeCode: "TD", unplaced: 0 });
  });

  it("keeps a student out of a group that meets at the same hour as one they hold, and says so", async () => {
    show([
      {
        groups: [
          { id: "rdns-8", scopeId: "scope-rdns", scopeCode: "RDNS", label: "8" },
          { id: "td-1", scopeId: "scope-td", scopeCode: "TD", label: "1" },
        ],
        windows: [],
        students: [],
      },
    ]);

    const list = await screen.findByLabelText("Who goes where");
    // Bilal holds RDNS 8, which clashes with TD 1 — so he goes to TD 2 despite it being the fuller choice now.
    expect(within(list).getByText("Bilal Saleh").closest("li")?.textContent).toContain("→ 2");
  });

  it("will not fill while the timetable's word on clashes is not in", async () => {
    show(null);

    await screen.findByLabelText("Who goes where");
    expect(screen.getByText(/could not be reached/)).toBeTruthy();
    expect((screen.getByText("Place 2") as HTMLButtonElement).disabled).toBe(true);
  });
});
