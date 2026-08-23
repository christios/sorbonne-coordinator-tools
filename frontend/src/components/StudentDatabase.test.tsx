import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDatabase } from "@/components/StudentDatabase";
import { StaffContext } from "@/components/useStaffUser";
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

const ADMIN = { email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: true };
const COLLEAGUE = { email: "colleague@sorbonne.ae", name: "Patricia Duval", isAdmin: false };

function renderApp(user: typeof ADMIN | null = ADMIN, onOpenSettings = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffContext.Provider value={user}>
        <StudentDatabase onOpenSettings={onOpenSettings} />
      </StaffContext.Provider>
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
    locked: false,
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
      locked: false,
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


describe("the sync lock", () => {
  it("lets an administrator straight in, and offers them the lock", async () => {
    vi.spyOn(database, "fetchSyncSettings").mockResolvedValue({
      filter: {},
      updatedAt: "",
      updatedBy: "",
      locked: true,
    });
    renderApp(ADMIN);

    fireEvent.click(await screen.findByRole("button", { name: "Sync settings" }));

    expect(await screen.findByText(/Locked with a passphrase/)).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("asks everybody else for the passphrase before showing the settings", async () => {
    vi.spyOn(database, "fetchSyncSettings").mockResolvedValue({
      filter: {},
      updatedAt: "",
      updatedBy: "",
      locked: true,
    });
    const unlock = vi.spyOn(database, "unlockSyncSettings").mockResolvedValue({ ok: true });
    renderApp(COLLEAGUE);

    fireEvent.click(await screen.findByRole("button", { name: "Sync settings" }));

    const field = await screen.findByLabelText("Passphrase");
    expect(screen.queryByText(/Leave everything blank to sync every student/)).toBeNull();

    fireEvent.change(field, { target: { value: "term-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));

    await waitFor(() => expect(unlock).toHaveBeenCalledWith("term-2026"));
    expect(await screen.findByText(/Leave everything blank to sync every student/)).toBeTruthy();
  });

  it("keeps an unlocked setting open to everyone", async () => {
    renderApp(COLLEAGUE);

    fireEvent.click(await screen.findByRole("button", { name: "Sync settings" }));

    expect(await screen.findByText(/Leave everything blank to sync every student/)).toBeTruthy();
  });

  it("only offers the lock itself to an administrator", async () => {
    renderApp(COLLEAGUE);

    fireEvent.click(await screen.findByRole("button", { name: "Sync settings" }));
    await screen.findByText(/Leave everything blank to sync every student/);

    expect(screen.queryByText(/Set a passphrase/)).toBeNull();
  });
});

describe("the account menu", () => {
  it("sits at the foot of the tool's own sidebar", async () => {
    renderApp(COLLEAGUE);

    // Named after the person, not their address — the name an administrator gave them.
    expect(await screen.findByRole("button", { name: /Patricia Duval/ })).toBeTruthy();
  });

  it("opens the settings screen for an administrator", async () => {
    const openSettings = vi.fn();
    renderApp(ADMIN, openSettings);

    fireEvent.click(await screen.findByRole("button", { name: /Coordinator/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Users/ }));

    expect(openSettings).toHaveBeenCalled();
  });
});
