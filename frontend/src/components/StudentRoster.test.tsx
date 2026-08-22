import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentRoster } from "@/components/StudentRoster";
import * as rosters from "@/services/scenRosters";
import { forgetRosters } from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";

const COHORTS: database.Cohort[] = [
  {
    id: "cohort-1",
    name: "Foundation Year",
    term: "S1 2026-27",
    notes: "",
    memberCount: 1,
    scopeCount: 3,
    createdAt: "",
    updatedAt: "",
  },
];

const SAVED: database.SavedSearch = {
  id: "search-1",
  name: "SCEN — First Year",
  description: "",
  filter: { YEARLEVEL_CODE: ["FY"] },
  expectedCount: 3,
  createdAt: "",
  updatedAt: "",
  updatedBy: "coordinator@sorbonne.ae",
};

const SCHEMA: rosters.PortalSchema = {
  ok: true,
  source: "built-in",
  fields: [
    { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY", label: "FY" }], verified: true },
  ],
  term: { code: "262710", label: "First Semester 2026-2027" },
  harvestedAt: null,
  error: "",
};

const PORTAL: rosters.PortalRoster = {
  presetId: "scen-fy",
  name: "SCEN — First Year",
  count: 3,
  expect: 3,
  warning: null,
  fetchedAt: Date.now(),
  rows: [
    { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
    { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" },
    { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
  ],
};

function renderRoster() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentRoster cohorts={COHORTS} />
    </QueryClientProvider>,
  );
}

async function pull() {
  // The saved searches arrive asynchronously; selecting one before it exists does nothing.
  await screen.findByRole("option", { name: SAVED.name });
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: SAVED.id } });
  fireEvent.click(screen.getByRole("button", { name: /pull from portal/i }));
  await screen.findByText(/3 students pulled/i);
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  // The roster lives in this browser now, so each test starts with an empty store.
  forgetRosters();
  vi.spyOn(database, "fetchMembers").mockResolvedValue([
    { studentId: "A001", addedAt: "", addedBy: "", groups: {} },
    { studentId: "A999", addedAt: "", addedBy: "", groups: {} },
  ]);
  vi.spyOn(database, "fetchSavedSearches").mockResolvedValue([SAVED]);
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA);
  vi.spyOn(rosters, "pullFilter").mockResolvedValue(PORTAL);
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetRosters();
});

describe("StudentRoster", () => {
  it("shows the cohort's own ids before anything is pulled", async () => {
    renderRoster();

    expect(await screen.findByText("A001")).toBeTruthy();
    expect(screen.getAllByText("Left").length).toBeGreaterThan(0);
  });

  it("names the students once the extension answers, and flags the new ones", async () => {
    renderRoster();
    await pull();

    expect(within(rowFor("Amira Haddad")).getByText("In the cohort")).toBeTruthy();
    expect(within(rowFor("Nadia Newcomer")).getByText("New")).toBeTruthy();
  });

  it("keeps a member the portal has dropped, with no name", async () => {
    renderRoster();
    await pull();

    const gone = screen.getByText("A999").closest("tr") as HTMLElement;
    expect(within(gone).getByText("Left")).toBeTruthy();
    expect(within(gone).getByText(/not in today's pull/)).toBeTruthy();
  });

  it("filters by a search, and by year", async () => {
    renderRoster();
    await pull();

    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "karim" } });
    expect(screen.queryByText("Amira Haddad")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "L1" } });
    expect(screen.getByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();
  });

  it("sends only ids when students are added in bulk", async () => {
    const add = vi.spyOn(database, "addMembers").mockResolvedValue(2);
    renderRoster();
    await pull();

    fireEvent.click(screen.getByLabelText("Select Karim Nasser"));
    fireEvent.click(screen.getByLabelText("Select Nadia Newcomer"));
    fireEvent.click(screen.getByRole("button", { name: /Add 2 to Foundation Year/ }));

    await waitFor(() => expect(add).toHaveBeenCalled());
    const [cohortId, ids] = add.mock.calls[0];
    expect(cohortId).toBe("cohort-1");
    expect([...ids].sort()).toEqual(["A002", "A003"]);
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Karim");
  });

  it("selects everyone shown, respecting the filter", async () => {
    const add = vi.spyOn(database, "addMembers").mockResolvedValue(1);
    renderRoster();
    await pull();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "L1" } });

    fireEvent.click(screen.getByLabelText("Select everyone shown"));
    fireEvent.click(screen.getByRole("button", { name: /Add 1 to Foundation Year/ }));

    await waitFor(() => expect(add).toHaveBeenCalled());
    expect(add.mock.calls[0][1]).toEqual(["A002"]);
  });

  it("offers to remove only students the cohort actually holds", async () => {
    const remove = vi.spyOn(database, "removeMembers").mockResolvedValue(1);
    renderRoster();
    await pull();

    fireEvent.click(screen.getByLabelText("Select Amira Haddad"));
    fireEvent.click(screen.getByLabelText("Select Nadia Newcomer"));
    fireEvent.click(screen.getByRole("button", { name: /Remove 1/ }));

    await waitFor(() => expect(remove).toHaveBeenCalled());
    expect(remove.mock.calls[0][1]).toEqual(["A001"]);
  });

  it("sorts by a column when its header is clicked", async () => {
    renderRoster();
    await pull();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));

    const names = screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
    expect(names[names.length - 1]).toContain("Nadia Newcomer");
  });

  it("still shows the roster after the page has been left and come back to", async () => {
    // The bug this pins: the pull lived in component state, so changing page lost it.
    const { unmount } = renderRoster();
    await pull();
    unmount();

    renderRoster();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(screen.getByText(/pulled just now/)).toBeTruthy();
    // And without pulling again — one round trip to the portal, not one per page change.
    expect(rosters.pullFilter).toHaveBeenCalledTimes(1);
  });

  it("marks what the portal now says differently, against the previous pull", async () => {
    renderRoster();
    await pull();

    vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      ...PORTAL,
      fetchedAt: Date.now() + 60_000,
      rows: [
        { ...PORTAL.rows[0], YEARLEVEL_CODE: "L1" },
        PORTAL.rows[1],
        PORTAL.rows[2],
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /pull again/i }));

    const row = await waitFor(() => rowFor("Amira Haddad"));
    expect(within(row).getByText("Changed")).toBeTruthy();
    expect(within(row).getByText("year FY → L1")).toBeTruthy();
  });

  it("forgets the stored rosters when asked", async () => {
    renderRoster();
    await pull();

    fireEvent.click(screen.getByRole("button", { name: /forget stored rosters/i }));

    expect(screen.queryByText("Amira Haddad")).toBeNull();
    expect(screen.getByText(/nothing pulled yet on this machine/i)).toBeTruthy();
  });

  it("sends the saved search's own codes to the extension", async () => {
    renderRoster();
    await pull();

    expect(rosters.pullFilter).toHaveBeenCalledWith(
      { YEARLEVEL_CODE: ["FY"] },
      { name: SAVED.name, expect: SAVED.expectedCount },
    );
  });

  it("still shows the cohort's ids when the extension cannot be reached", async () => {
    vi.spyOn(rosters, "fetchSchema").mockResolvedValue({
      ...SCHEMA,
      ok: false,
      fields: [],
      error: "The SCEN Rosters extension did not answer.",
    });
    renderRoster();

    expect(await screen.findByText("A001")).toBeTruthy();
  });
});
