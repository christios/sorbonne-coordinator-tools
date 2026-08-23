import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDatabase } from "@/components/StudentDatabase";
import { forgetRosters } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
import * as database from "@/services/studentDatabase";

const SCHEMA: rosters.PortalSchema = {
  ok: true,
  source: "portal",
  fields: [
    { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY", label: "FY" }], verified: true },
  ],
  term: { code: "262710", label: "First Semester 2026-2027" },
  harvestedAt: null,
  error: "",
};

const PORTAL: rosters.PortalRoster = {
  presetId: "sync",
  name: "Sync",
  count: 2,
  expect: null,
  warning: null,
  fetchedAt: Date.now(),
  rows: [
    { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" },
    { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", YEARLEVEL_CODE: "L1" },
  ],
};

/** The sync waits on its settings, so it is briefly disabled after the page appears. */
async function clickSync() {
  const button = await screen.findByRole("button", { name: /sync with portal/i });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
}

function renderApp() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentDatabase />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(database, "fetchCohorts").mockResolvedValue([]);
  vi.spyOn(database, "fetchStudents").mockResolvedValue([]);
  vi.spyOn(database, "fetchSavedSearches").mockResolvedValue([]);
  vi.spyOn(database, "fetchSyncSettings").mockResolvedValue({
    filter: {},
    updatedAt: "",
    updatedBy: "",
  });
  vi.spyOn(database, "syncStudents").mockResolvedValue({
    seen: 2,
    added: 2,
    missing: 0,
    syncedAt: "2026-08-23T09:00:00+00:00",
  });
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA);
  vi.spyOn(rosters, "pullFilter").mockResolvedValue(PORTAL);
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetRosters();
  window.localStorage.clear();
});

describe("the sync, and where it lives", () => {
  it("offers one sync in the header of the Students page", async () => {
    renderApp();

    expect(await screen.findByRole("button", { name: /sync with portal/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sync settings" })).toBeTruthy();
  });

  it("asks the portal for the configured population, and sends back only ids", async () => {
    vi.spyOn(database, "fetchSyncSettings").mockResolvedValue({
      filter: { YEARLEVEL_CODE: ["FY"] },
      updatedAt: "",
      updatedBy: "",
    });
    renderApp();

    await clickSync();

    await waitFor(() => expect(database.syncStudents).toHaveBeenCalled());
    expect((rosters.pullFilter as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      YEARLEVEL_CODE: ["FY"],
    });
    const [ids] = (database.syncStudents as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(ids).toEqual(["A001", "A002"]);
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Amira");
  });

  it("says what the sync did", async () => {
    renderApp();

    await clickSync();

    expect(await screen.findByText(/2 returned · 2 added · 0 no longer in the portal/)).toBeTruthy();
  });

  it("explains what narrowing the population means before it is narrowed", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "Sync settings" }));

    expect(await screen.findByText(/marked as no longer in the portal/i)).toBeTruthy();
  });
});

describe("portal views", () => {
  it("says plainly that a view cannot change the student list", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Portal views/ }));

    expect(
      await screen.findByText(/never add, remove or restatus a student/i),
    ).toBeTruthy();
  });

  it("never syncs, however much you look at the portal", async () => {
    vi.spyOn(database, "fetchSavedSearches").mockResolvedValue([
      {
        id: "search-1",
        name: "SCEN — First Year",
        description: "",
        filter: { YEARLEVEL_CODE: ["FY"] },
        expectedCount: 0,
        createdAt: "",
        updatedAt: "",
        updatedBy: "",
      },
    ]);
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Portal views/ }));

    fireEvent.click(await screen.findByRole("combobox", { name: "Open a view" }));
    fireEvent.click(await screen.findByRole("option", { name: "SCEN — First Year" }));
    fireEvent.click(await screen.findByRole("button", { name: /look at the portal/i }));

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    // The whole point of the split: looking never writes.
    expect(database.syncStudents).not.toHaveBeenCalled();
  });
});
