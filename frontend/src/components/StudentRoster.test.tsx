import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentRoster } from "@/components/StudentRoster";
import * as rosters from "@/services/scenRosters";
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
  fireEvent.click(await screen.findByRole("button", { name: /pull from portal/i }));
  await screen.findByText(/3 students from/i);
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  vi.spyOn(database, "fetchMembers").mockResolvedValue([
    { studentId: "A001", addedAt: "", addedBy: "", groups: {} },
    { studentId: "A999", addedAt: "", addedBy: "", groups: {} },
  ]);
  vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(true);
  vi.spyOn(rosters, "listPresets").mockResolvedValue([
    { id: "scen-fy", name: "SCEN — First Year", expect: 3 },
  ]);
  vi.spyOn(rosters, "pullRoster").mockResolvedValue(PORTAL);
});

afterEach(() => vi.restoreAllMocks());

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

  it("still works with no extension, and says so", async () => {
    vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(false);
    vi.spyOn(rosters, "listPresets").mockResolvedValue([]);
    renderRoster();

    expect(await screen.findByText(/extension is not answering/i)).toBeTruthy();
    expect(screen.getByText("A001")).toBeTruthy();
  });
});
