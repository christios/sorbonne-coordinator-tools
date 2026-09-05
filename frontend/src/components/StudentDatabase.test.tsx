import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentDatabase } from "@/components/StudentDatabase";
import { StaffContext } from "@/components/useStaffUser";
import * as backup from "@/services/historyBackup";
import { forgetHistory } from "@/services/pullHistory";
import { forgetRosters } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const SCHEMA: rosters.PortalSchema = {
  ok: true,
  source: "portal",
  columns: [{ key: "YEARLEVEL_CODE", label: "Year level" }],
  fields: [
    { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY", label: "FY" }], verified: true },
  ],
  term: { code: "262710", label: "First Semester 2026-2027" },
  harvestedAt: null,
  error: "",
};

const PORTAL: rosters.PortalRoster = {
  kind: "students",
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

/**
 * Portal sync waits on the views and portal filters, so it is briefly disabled.
 *
 * Waited out to the end, because the run is module state shared by every test in this
 * file: a test that walked away mid-run would leave the next one unable to start.
 */
async function clickSync() {
  const button = await screen.findByRole("button", { name: /portal sync/i });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await screen.findByText(/^Synced/);
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(database, "fetchCohorts").mockResolvedValue([]);
  vi.spyOn(database, "fetchStudents").mockResolvedValue([]);
  vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW]);
  vi.spyOn(database, "syncView").mockResolvedValue({
    seen: 2,
    added: 2,
    missing: 0,
    syncedAt: "2026-08-23T09:00:00+00:00",
  });
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA);
  vi.spyOn(rosters, "pullFilter").mockResolvedValue(PORTAL);
  vi.spyOn(timetables, "fetchTimetableStatus").mockResolvedValue({ configured: true, host: "scen.example.dev" });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([]);
  vi.spyOn(timetables, "fetchAnnouncements").mockResolvedValue({ announcements: [], icons: ["info"], cohorts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  forgetRosters();
  forgetHistory();
  window.localStorage.clear();
});

describe("Portal sync", () => {
  it("stands at the foot of the pane, and the pages themselves no longer sync", async () => {
    renderApp();

    expect(await screen.findByRole("combobox", { name: "View" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /portal sync/i })).toBeTruthy();
    // One way to ask the portal, not one per page.
    expect(screen.queryByRole("button", { name: /sync this filter|seed this filter/i })).toBeNull();
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

  it("says what the run did, list by list", async () => {
    renderApp();

    await clickSync();

    await waitFor(() => expect(database.syncView).toHaveBeenCalled());
    // The panel opens with the run in it: the list, and what the portal gave back.
    expect(await screen.findByText("Students ·")).toBeTruthy();
    expect(await screen.findByText(/2 returned/)).toBeTruthy();
  });

  it("says when the history could not be copied to the chosen folder", async () => {
    vi.spyOn(backup, "backUpHistory").mockResolvedValue({ ok: false, reason: "no_permission" });
    renderApp();

    await clickSync();

    expect(await screen.findByText(/Chrome needs you to allow it again/)).toBeTruthy();
  });

  it("stays quiet about the backup when no folder has been chosen", async () => {
    // Not opting in is not a failure, and a warning about it every sync would be noise.
    vi.spyOn(backup, "backUpHistory").mockResolvedValue({ ok: false, reason: "no_folder" });
    renderApp();

    await clickSync();

    expect(await screen.findByText(/2 returned/)).toBeTruthy();
    expect(screen.queryByText(/could not be written/)).toBeNull();
  });

  it("still syncs the students when the backup fails", async () => {
    // The students are synced either way; the backup is a copy, not the point.
    vi.spyOn(backup, "backUpHistory").mockResolvedValue({ ok: false, reason: "failed" });
    renderApp();

    await clickSync();

    await waitFor(() => expect(database.syncView).toHaveBeenCalled());
  });
});

describe("a view is a fixed question", () => {
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
    fireEvent.click(await screen.findByRole("button", { name: "New portal filter" }));

    expect(await screen.findByText(/fixed now and cannot be changed afterwards/i)).toBeTruthy();
  });

  it("says there is nothing to show until a view exists", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([]);
    renderApp();

    expect(await screen.findByText(/No portal filters yet/)).toBeTruthy();
  });
});

/**
 * Switching view used to remount the table.
 *
 * Everything the coordinator had set up went with it — the columns they had arranged, the
 * filters, the sort — and a full-screen loader covered a list React Query already had.
 */
describe("changing view", () => {
  const SECOND: database.StudentView = { ...VIEW, id: "view-2", name: "L1", held: 3 };

  async function switchToL1() {
    fireEvent.click(await screen.findByRole("combobox", { name: "View" }));
    fireEvent.click(await screen.findByRole("option", { name: /L1/ }));
  }

  it("asks the server once per view, and not again on the way back", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW, SECOND]);
    const spy = vi.spyOn(database, "fetchStudents").mockResolvedValue([]);
    // The everyone-list is prefetched for the Cohorts page as soon as the app opens; what
    // this test guards is the per-view fetch, so only calls that name a view are counted.
    const fetched = { calls: () => spy.mock.calls.filter(([view]) => Boolean(view)).length };
    renderApp();
    await screen.findByRole("combobox", { name: "View" });
    await waitFor(() => expect(fetched.calls()).toBe(1));

    await switchToL1();
    await waitFor(() => expect(fetched.calls()).toBe(2));

    // Back to the first: its answer is minutes old and still good.
    fireEvent.click(await screen.findByRole("combobox", { name: "View" }));
    fireEvent.click(await screen.findByRole("option", { name: /Foundation Year/ }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "View" }).textContent).toContain("Foundation Year"));
    expect(fetched.calls()).toBe(2);
  });

  it("keeps the table on screen instead of a loading page", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW, SECOND]);
    renderApp();
    const table = await screen.findByRole("table");

    await switchToL1();

    // The same table element: not torn down and rebuilt.
    expect(screen.getByRole("table")).toBe(table);
    expect(screen.queryByText(/Loading the students…/)).toBeNull();
  });

  it("keeps the columns the coordinator arranged", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW, SECOND]);
    renderApp();
    await screen.findByRole("table");
    const [resize] = screen.getAllByRole("separator", { name: /^Resize / });
    const column = resize.closest("th") as HTMLElement;
    fireEvent.keyDown(resize, { key: "ArrowRight" });
    const width = column.style.width;

    await switchToL1();

    expect((screen.getAllByRole("separator", { name: /^Resize / })[0].closest("th") as HTMLElement).style.width).toBe(
      width,
    );
  });
});

describe("who may define a view", () => {
  it("offers making and deleting one to an administrator", async () => {
    renderApp(ADMIN);

    expect(await screen.findByRole("button", { name: "New portal filter" })).toBeTruthy();
    // The delete button waits for a view to be chosen, which happens once they load.
    expect(await screen.findByRole("button", { name: `Delete ${VIEW.name}` })).toBeTruthy();
  });

  it("offers neither to a coordinator who is not one", async () => {
    renderApp(COLLEAGUE);
    await screen.findByRole("combobox", { name: "View" });

    expect(screen.queryByRole("button", { name: "New portal filter" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Delete ${VIEW.name}` })).toBeNull();
  });

  it("still lets them ask the portal, which settles nothing about a population", async () => {
    renderApp(COLLEAGUE);

    expect(await screen.findByRole("button", { name: /portal sync/i })).toBeTruthy();
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

describe("students and their timetables in one place", () => {
  /** The pages are reached from the side pane, exactly as a coordinator reaches them. */
  const open = async (name: RegExp) => fireEvent.click(await screen.findByRole("button", { name }));

  it("offers the roster pages and the timetable pages in one pane", async () => {
    renderApp();
    const pane = await screen.findByRole("complementary", { name: /students and timetables/i });

    for (const name of ["Students", "Groups & CRNs", "Semesters", "Announcements"]) {
      expect(within(pane).getByRole("button", { name })).toBeTruthy();
    }
  });

  it("reaches the semesters the Student Hub holds", async () => {
    renderApp();

    await open(/^Semesters$/);

    expect(await screen.findByText(/Semesters on the Student Hub/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Import a timetable/ })).toBeTruthy();
  });

  it("says the timetable pages need a platform, and leaves the roster pages alone", async () => {
    vi.spyOn(timetables, "fetchTimetableStatus").mockResolvedValue({ configured: false, host: null });
    renderApp();

    await open(/^Semesters$/);
    expect(await screen.findByText("Timetable uploads are not configured")).toBeTruthy();

    // The roster is this application's own, so a missing platform must not close it.
    await open(/^Students$/);
    expect(await screen.findByRole("combobox", { name: "View" })).toBeTruthy();
  });
});


/**
 * Refreshing used to lose your place.
 *
 * The page was state and nothing else, so a reload — or the back button — dropped the
 * coordinator on Students however deep in the work they were.
 */
describe("keeping your place", () => {
  // Local, because the `open` helper above belongs to another describe block — and
  // calling it from here quietly resolved to window.open, which clicks nothing.
  const choose = async (name: RegExp) => fireEvent.click(await screen.findByRole("button", { name }));

  /*
   * Set the address and let the hashchange it fires settle *before* mounting.
   *
   * Without the wait these tests pass whether or not the page is read on mount: jsdom
   * dispatches hashchange a tick after the assignment, so the listener quietly did the
   * work and a component that ignored the address entirely still looked correct.
   */
  const startAt = async (hash: string) => {
    window.location.hash = hash;
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  afterEach(() => {
    window.location.hash = "";
  });

  it("opens the page the address names", async () => {
    await startAt("#/database/semesters");
    renderApp();

    expect(await screen.findByText(/Semesters on the Student Hub/)).toBeTruthy();
  });

  it("writes the page into the address when one is chosen", async () => {
    renderApp();
    await choose(/^Groups & CRNs$/);

    await waitFor(() => expect(window.location.hash).toBe("#/database/groups"));
  });

  it("opens Students when the address names no page", async () => {
    await startAt("#/database");
    renderApp();

    expect(await screen.findByRole("combobox", { name: "View" })).toBeTruthy();
  });

  it("opens Students rather than nothing when the address names a page we lost", async () => {
    await startAt("#/database/a-page-that-was-removed");
    renderApp();

    expect(await screen.findByRole("combobox", { name: "View" })).toBeTruthy();
  });

  it("follows the back button", async () => {
    await startAt("#/database/announcements");
    renderApp();
    await screen.findByRole("combobox", { name: "Semester" });

    // What going back looks like to the page: the address changes underneath it.
    window.location.hash = "#/database/semesters";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(await screen.findByText(/Semesters on the Student Hub/)).toBeTruthy();
  });
});
