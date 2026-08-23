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

const SYNCED = "2026-08-22T09:00:00+00:00";

/** What our side holds: ids, a status and a cohort. Never a name. */
const HELD: database.Student[] = [
  {
    studentId: "A001",
    status: "in_portal",
    cohortId: "cohort-1",
    cohortName: "Foundation Year",
    firstSeenAt: "2026-08-01T09:00:00+00:00",
    lastSeenAt: SYNCED,
    groups: {},
  },
  {
    studentId: "A002",
    status: "in_portal",
    cohortId: null,
    cohortName: "",
    firstSeenAt: "2026-08-01T09:00:00+00:00",
    lastSeenAt: SYNCED,
    groups: {},
  },
  {
    studentId: "A003",
    status: "in_portal",
    cohortId: null,
    cohortName: "",
    firstSeenAt: SYNCED,
    lastSeenAt: SYNCED,
    groups: {},
  },
  {
    studentId: "A999",
    status: "not_in_portal",
    cohortId: "cohort-1",
    cohortName: "Foundation Year",
    firstSeenAt: "2026-08-01T09:00:00+00:00",
    lastSeenAt: "2026-08-01T09:00:00+00:00",
    groups: {},
  },
];

function renderRoster() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentRoster cohorts={COHORTS} />
    </QueryClientProvider>,
  );
}

/** SelectMenu is a button and a listbox, not a native select — see the UI decisions doc. */
async function choose(label: string, option: string | RegExp) {
  fireEvent.click(await screen.findByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

async function sync() {
  await waitFor(() => expect(screen.getByRole("button", { name: /sync all students/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /sync all students/i }));
  await screen.findByText("Amira Haddad");
}

/** A narrowed sync: choose a saved search first, so the pull is not a census. */
async function syncSearch() {
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Search" })).toBeTruthy());
  await choose("Search", SAVED.name);
  fireEvent.click(screen.getByRole("button", { name: /sync this search/i }));
  await screen.findByText("Amira Haddad");
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

beforeEach(() => {
  // The roster lives in this browser now, so each test starts with an empty store.
  forgetRosters();
  vi.spyOn(database, "fetchStudents").mockResolvedValue(HELD);
  vi.spyOn(database, "syncStudents").mockResolvedValue({
    seen: 3,
    added: 1,
    missing: 1,
    syncedAt: SYNCED,
  });
  vi.spyOn(database, "fetchSavedSearches").mockResolvedValue([SAVED]);
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA);
  vi.spyOn(rosters, "pullFilter").mockResolvedValue(PORTAL);
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetRosters();
});

describe("StudentRoster", () => {
  it("shows every held student before anything is pulled, and nobody is mislabelled", async () => {
    renderRoster();

    expect(await screen.findByText("A001")).toBeTruthy();
    // The list is the server's; this browser only ever adds the names to it.
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/name not pulled yet/).length).toBe(HELD.length);
    expect(within(table).getAllByText("Not in portal")).toHaveLength(1);
  });

  it("names the students once the extension answers", async () => {
    renderRoster();
    await sync();

    expect(within(rowFor("Amira Haddad")).getByText("In portal")).toBeTruthy();
    expect(within(rowFor("Amira Haddad")).getByText("Foundation Year")).toBeTruthy();
  });

  it("tells the server a plain sync was the whole population", async () => {
    renderRoster();
    await sync();

    await waitFor(() => expect(database.syncStudents).toHaveBeenCalled());
    const [ids, full] = (database.syncStudents as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ids).toEqual(["A001", "A002", "A003"]);
    expect(full).toBe(true);
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Amira");
  });

  it("tells the server a narrowed sync was not, so nobody is marked as gone", async () => {
    // The bug this pins: a filtered search is not a census, and used to read as one.
    renderRoster();
    await syncSearch();

    await waitFor(() => expect(database.syncStudents).toHaveBeenCalled());
    expect((database.syncStudents as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(false);
  });

  it("marks a student the last sync brought in as new", async () => {
    renderRoster();
    await sync();

    expect(within(rowFor("Nadia Newcomer")).getByText("New")).toBeTruthy();
    expect(within(rowFor("Amira Haddad")).queryByText("New")).toBeNull();
  });

  it("keeps a student the portal stopped returning, with no name", async () => {
    renderRoster();
    await sync();

    const gone = screen.getByText("A999").closest("tr") as HTMLElement;
    expect(within(gone).getByText("Not in portal")).toBeTruthy();
    expect(within(gone).getByText(/name not pulled yet/)).toBeTruthy();
  });

  it("keeps every student when the stored rosters are forgotten", async () => {
    // Forgetting clears the names this browser holds. The list lives on the server, so
    // nobody leaves it and no cohort changes.
    renderRoster();
    await sync();

    fireEvent.click(screen.getByRole("button", { name: /forget stored rosters/i }));
    expect(await screen.findByText(/No student leaves the list/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget rosters" }));

    await waitFor(() => expect(screen.queryByText("Amira Haddad")).toBeNull());
    const table = screen.getByRole("table");
    expect(within(table).getByText("A001")).toBeTruthy();
    expect(within(table).getByText("A999")).toBeTruthy();
    expect(within(table).getAllByText("Foundation Year")).toHaveLength(2);
  });

  it("filters by a search, by year, and by cohort", async () => {
    renderRoster();
    await sync();

    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "karim" } });
    expect(screen.queryByText("Amira Haddad")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "" } });
    await choose("Year", "L1");
    expect(screen.getByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();

    await choose("Year", "Year: any");
    await choose("Cohort", "No cohort yet");
    expect(screen.queryByText("Amira Haddad")).toBeNull();
    expect(screen.getByText("Karim Nasser")).toBeTruthy();
  });

  it("moves the selected students into a cohort", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(2);
    renderRoster();
    await sync();

    fireEvent.click(screen.getByLabelText("Select Karim Nasser"));
    fireEvent.click(screen.getByLabelText("Select Nadia Newcomer"));
    await choose("Move to cohort", "Foundation Year");
    fireEvent.click(screen.getByRole("button", { name: /Move 2/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    const [ids, cohortId] = move.mock.calls[0];
    expect([...ids].sort()).toEqual(["A002", "A003"]);
    expect(cohortId).toBe("cohort-1");
    expect(JSON.stringify(ids)).not.toContain("Karim");
  });

  it("takes students out of a cohort with a null, not a delete", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    renderRoster();
    await sync();

    fireEvent.click(screen.getByLabelText("Select Amira Haddad"));
    await choose("Move to cohort", "Take out of their cohort");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(move.mock.calls[0]).toEqual([["A001"], null]);
  });

  it("selects everyone shown, respecting the filter", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    renderRoster();
    await sync();
    await choose("Year", "L1");

    fireEvent.click(screen.getByLabelText("Select everyone shown"));
    await choose("Move to cohort", "Foundation Year");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(move.mock.calls[0][0]).toEqual(["A002"]);
  });

  it("sorts by a column when its header is clicked", async () => {
    renderRoster();
    await sync();

    fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));

    const names = screen.getAllByRole("row").slice(1).map((row) => row.textContent ?? "");
    expect(names[names.length - 1]).toContain("Nadia Newcomer");
  });

  it("still shows the names after the page has been left and come back to", async () => {
    // The bug this pins: the pull lived in component state, so changing page lost it.
    const { unmount } = renderRoster();
    await sync();
    unmount();

    renderRoster();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
  });

  it("marks what the portal now says differently, against the previous pull", async () => {
    renderRoster();
    await sync();
    vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      ...PORTAL,
      fetchedAt: PORTAL.fetchedAt + 60_000,
      rows: [
        { ...PORTAL.rows[0], YEARLEVEL_CODE: "L1" },
        ...PORTAL.rows.slice(1),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /sync all students/i }));

    const row = await waitFor(() => rowFor("Amira Haddad"));
    expect(within(row).getByText("Changed")).toBeTruthy();
    expect(within(row).getByText("year FY → L1")).toBeTruthy();
  });

  it("keeps a filter composed in the dialog when it is closed", async () => {
    // The dialog is an editor, not a form: closing it must not discard the work.
    renderRoster();
    fireEvent.click(await screen.findByRole("button", { name: /filters/i }));
    await choose("Year level", /^FY/);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText(/Year level FY/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /sync this search/i }));

    await waitFor(() => expect(rosters.pullFilter).toHaveBeenCalled());
    expect((rosters.pullFilter as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      YEARLEVEL_CODE: ["FY"],
    });
  });

  it("uses the shared select control, not a native one", async () => {
    // docs/handoffs/ui-ux-decisions.md: no native <select> in product UI.
    renderRoster();
    await screen.findByText("A001");

    expect(document.querySelector("select")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Cohort" }).tagName).toBe("BUTTON");
  });

  it("still shows the held students when the extension cannot be reached", async () => {
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
