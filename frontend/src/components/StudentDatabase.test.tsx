import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDatabase } from "@/components/StudentDatabase";
import { StaffContext } from "@/components/useStaffUser";
import { forgetHistory } from "@/services/pullHistory";
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
  presetId: "view-1",
  name: "Foundation Year",
  count: 2,
  expect: null,
  warning: null,
  fetchedAt: Date.now(),
  rows: [
    { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" },
    { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", YEARLEVEL_CODE: "FY" },
  ],
};

const VIEW: database.StudentView = {
  id: "view-1",
  name: "Foundation Year",
  description: "",
  filter: { YEARLEVEL_CODE: ["FY"] },
  held: 2,
  gone: 0,
  lastSyncedAt: "2026-08-22T09:00:00+00:00",
  createdAt: "",
  updatedBy: "",
};

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

/** The sync waits on the views query, so it is briefly disabled after the page appears. */
async function clickSync() {
  const button = await screen.findByRole("button", { name: /sync this view/i });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(database, "fetchCohorts").mockResolvedValue([]);
  vi.spyOn(database, "fetchStudents").mockResolvedValue([]);
  vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW]);
  vi.spyOn(database, "fetchViewLock").mockResolvedValue({ locked: false });
  vi.spyOn(database, "syncView").mockResolvedValue({
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
  forgetHistory();
  window.localStorage.clear();
});

describe("syncing a view", () => {
  it("offers the view picker and one sync in the header", async () => {
    renderApp();

    expect(await screen.findByRole("combobox", { name: "View" })).toBeTruthy();
    // The label waits on the views query, which says whether this one has been synced.
    expect(await screen.findByRole("button", { name: /sync this view/i })).toBeTruthy();
  });

  it("asks the portal for the view's own fixed filter, and sends back only ids", async () => {
    renderApp();

    await clickSync();

    await waitFor(() => expect(database.syncView).toHaveBeenCalled());
    expect((rosters.pullFilter as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual({
      YEARLEVEL_CODE: ["FY"],
    });
    const [view, ids] = (database.syncView as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(view).toBe("view-1");
    expect(ids).toEqual(["A001", "A002"]);
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Amira");
  });

  it("says what the sync did to this view", async () => {
    renderApp();

    await clickSync();

    expect(await screen.findByText(/2 returned · 2 added · 0 no longer in this view/)).toBeTruthy();
  });

  it("offers no way to change a view's filter", async () => {
    // The filter is fixed at creation — that is what makes "no longer in the view" mean
    // something — so there is deliberately no edit control and no shared settings dialog.
    renderApp();
    await screen.findByRole("combobox", { name: "View" });

    expect(screen.queryByRole("button", { name: /edit (the )?filter/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sync settings/i })).toBeNull();
  });

  it("warns that a new view's filter cannot be changed afterwards", async () => {
    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: "New view" }));

    expect(await screen.findByText(/fixed now and cannot be changed afterwards/i)).toBeTruthy();
  });

  it("says there is nothing to show until a view exists", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([]);
    renderApp();

    expect(await screen.findByText(/No views yet/)).toBeTruthy();
  });
});

describe("the lock on defining views", () => {
  it("asks a coordinator for the passphrase when views are locked", async () => {
    vi.spyOn(database, "fetchViewLock").mockResolvedValue({ locked: true });
    const create = vi.spyOn(database, "createView").mockResolvedValue(VIEW);
    renderApp(COLLEAGUE);

    fireEvent.click(await screen.findByRole("button", { name: "New view" }));
    fireEvent.change(await screen.findByLabelText("View name"), { target: { value: "L1" } });
    fireEvent.change(screen.getByLabelText("Passphrase"), { target: { value: "term-2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create view" }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].passphrase).toBe("term-2026");
  });

  it("never asks an administrator for it", async () => {
    vi.spyOn(database, "fetchViewLock").mockResolvedValue({ locked: true });
    renderApp(ADMIN);

    fireEvent.click(await screen.findByRole("button", { name: "New view" }));

    expect(await screen.findByLabelText("View name")).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("does not ask for it at all when views are open", async () => {
    renderApp(COLLEAGUE);

    fireEvent.click(await screen.findByRole("button", { name: "New view" }));

    expect(await screen.findByLabelText("View name")).toBeTruthy();
    expect(screen.queryByLabelText("Passphrase")).toBeNull();
  });

  it("offers the lock itself only to an administrator", async () => {
    renderApp(COLLEAGUE);
    await screen.findByRole("combobox", { name: "View" });

    expect(screen.queryByText(/Views are (locked|open)/)).toBeNull();
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
