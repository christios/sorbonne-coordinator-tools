import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalSyncButton } from "@/components/PortalSyncButton";
import * as backup from "@/services/historyBackup";
import * as lists from "@/services/portalLists";
import { forgetHistory } from "@/services/pullHistory";
import { forgetRosters } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const VIEW: database.StudentView = {
  id: "view-1", name: "Foundation Year", description: "", filter: { YEARLEVEL_CODE: ["FY"] },
  held: 2, gone: 0, lastSyncedAt: "", createdAt: "", updatedBy: "",
};

const COURSES: lists.PortalFilter = {
  id: "f1", kind: "courses", name: "SCEN Courses", filter: { DEPT_CODE: ["SCEN"] },
  held: 0, gone: 0, lastSyncedAt: "", createdAt: "", updatedBy: "",
};

const STUDENTS: rosters.PortalRoster = {
  kind: "students", presetId: "view-1", name: "Foundation Year", count: 2, expect: null,
  warning: null, fetchedAt: Date.now(),
  rows: [
    { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" },
    { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", YEARLEVEL_CODE: "FY" },
  ],
};

const COURSE_ROWS: rosters.PortalRoster = {
  kind: "courses", term: { code: "262710", label: "S1" }, presetId: "", name: "SCEN Courses",
  count: 1, expect: null, warning: null, fetchedAt: Date.now(),
  rows: [{ COURSE_CRN: "22151", COURSE_CODE: "MATH-001", TERM_CODE: "262710" }],
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PortalSyncButton />
    </QueryClientProvider>,
  );
}

/** Waited out to the end: the run is module state shared by every test in this file. */
async function sync() {
  const button = await screen.findByRole("button", { name: /portal sync/i });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await screen.findByText(/^Synced/);
}

beforeEach(() => {
  window.localStorage.clear();
  // The pre-flight. Asked once before a run rather than discovered by six lists each
  // waiting out the sixty seconds of silence a missing extension announces itself with.
  vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(true);
  vi.spyOn(database, "fetchViews").mockResolvedValue([VIEW]);
  vi.spyOn(database, "syncView").mockResolvedValue({ seen: 2, added: 2, missing: 0, syncedAt: "now" });
  vi.spyOn(lists, "fetchPortalFilters").mockImplementation(async (kind) => (kind === "courses" ? [COURSES] : []));
  vi.spyOn(lists, "syncCourses").mockResolvedValue({ seen: 1, added: 1, missing: 0, syncedAt: "now" });
  vi.spyOn(rosters, "pullFilter").mockImplementation(async (_filter, meta) =>
    meta?.kind === "courses" ? COURSE_ROWS : STUDENTS,
  );
});

afterEach(async () => {
  vi.restoreAllMocks();
  await forgetRosters();
  await forgetHistory();
  window.localStorage.clear();
});

describe("Portal sync", () => {
  it("asks every list, students first, and says what each returned", async () => {
    show();

    await sync();

    expect(database.syncView).toHaveBeenCalled();
    expect(lists.syncCourses).toHaveBeenCalled();
    expect(await screen.findByText("Students ·")).toBeTruthy();
    expect(await screen.findByText("Courses ·")).toBeTruthy();
    expect(screen.getByText(/2 of 2 synced/)).toBeTruthy();
  });

  it("sends our server ids, never a name", async () => {
    show();

    await sync();

    const [view, ids] = (database.syncView as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(view).toBe("view-1");
    expect(ids).toEqual(["A001", "A002"]);
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Amira");
  });

  it("keeps going when one list fails, and says which", async () => {
    vi.spyOn(rosters, "pullFilter").mockImplementation(async (_filter, meta) => {
      if (meta?.kind === "courses") throw new rosters.PortalError("auth");
      return STUDENTS;
    });
    show();

    await sync();

    expect(database.syncView).toHaveBeenCalled();
    expect(await screen.findByText(/portal session has expired/)).toBeTruthy();
    expect(screen.getByText(/1 of 2 synced, 1 did not/)).toBeTruthy();
  });

  /*
   * A backup that has quietly stopped working is worse than no backup: it is discovered
   * when it is needed, which is after the thing it was protecting has gone.
   */
  it("says when the history could not be copied to the chosen folder", async () => {
    vi.spyOn(backup, "backUpHistory").mockResolvedValue({ ok: false, reason: "no_permission" });
    show();

    await sync();

    expect(await screen.findByText(/Chrome needs you to allow it again/)).toBeTruthy();
  });

  it("stays quiet about the backup when no folder has been chosen", async () => {
    // Not opting in is not a failure, and a warning about it every sync would be noise.
    vi.spyOn(backup, "backUpHistory").mockResolvedValue({ ok: false, reason: "no_folder" });
    show();

    await sync();

    expect(screen.queryByText(/could not be written|allow it again/)).toBeNull();
  });
});

describe("what the button says when the portal will not answer", () => {
  it("says it once when every list failed for the same reason", async () => {
    // An expired session fails every list, because every list starts by asking the portal
    // who you are. Six identical sentences reads as six problems; it is one, and the one
    // thing to do about it is sign in again.
    vi.spyOn(rosters, "pullFilter").mockRejectedValue(new rosters.PortalError("auth"));
    show();

    await sync();

    const shown = await screen.findAllByText(/portal session has expired/);
    expect(shown.length).toBe(1);
    expect(screen.queryByText(/0 of 2 synced/)).toBeTruthy();
  });

  it("still names each list when they failed for different reasons", async () => {
    // The grouping must not flatten genuinely different failures into one sentence.
    vi.spyOn(rosters, "pullFilter").mockImplementation(async (_filter, meta) => {
      if (meta?.kind === "courses") throw new rosters.PortalError("auth");
      throw new Error("The server is having a moment.");
    });
    show();

    await sync();

    expect(await screen.findByText(/portal session has expired/)).toBeTruthy();
    expect(screen.getByText(/having a moment/)).toBeTruthy();
  });
});

describe("how stale the lists are", () => {
  it("says the age of the oldest pull on the button itself", async () => {
    // Not the most recent: after a sync the button's whole job is a staleness floor, and
    // "just now" while one list is a week old is exactly the lie this is here to prevent.
    const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const hour = new Date(Date.now() - 3600_000).toISOString();
    vi.spyOn(database, "fetchViews").mockResolvedValue([{ ...VIEW, lastSyncedAt: hour }]);
    vi.spyOn(lists, "fetchPortalFilters").mockImplementation(async (kind) =>
      kind === "courses" ? [{ ...COURSES, lastSyncedAt: week }] : [],
    );
    show();

    expect(await screen.findByText(/7 days ago/)).toBeTruthy();
  });

  it("says nothing about age when nothing has ever been synced", async () => {
    vi.spyOn(database, "fetchViews").mockResolvedValue([{ ...VIEW, lastSyncedAt: "" }]);
    vi.spyOn(lists, "fetchPortalFilters").mockResolvedValue([{ ...COURSES, lastSyncedAt: "" }]);
    show();

    expect(await screen.findByRole("button", { name: /Portal sync/ })).toBeTruthy();
    expect(screen.queryByText(/ago/)).toBeNull();
  });
});

describe("before anything is asked for", () => {
  it("says the extension is missing instead of failing every list one at a time", async () => {
    /*
     * A missing extension announces itself by silence, timed out after a minute. Six lists
     * is six minutes to be told one thing — and every one of them ends up in the failed
     * column, which reads as six problems. The check that settles it takes a second.
     */
    vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(false);
    const pull = vi.spyOn(rosters, "pullFilter");

    show();
    const button = await screen.findByRole("button", { name: /portal sync/i });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("extension did not answer") as unknown as string,
    );
    // And nothing was asked for. A run that cannot work must not be started.
    expect(pull).not.toHaveBeenCalled();
  });

  it("goes ahead when the extension answers", async () => {
    const pull = vi.spyOn(rosters, "pullFilter");

    show();
    await sync();

    expect(pull).toHaveBeenCalled();
    expect(screen.queryByText(/extension did not answer/)).toBeNull();
  });
});

describe("the registrar's timetable in the run", () => {
  beforeEach(() => {
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
    vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
      { id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm,
    ]);
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151"], registered: ["24001"] });
    vi.spyOn(rosters, "pullTimetable").mockResolvedValue({
      termCode: "262710", asked: ["22151", "24001"], sections: [], silent: ["24001"],
      failed: [], complete: true, malformed: 0, warning: null, fetchedAt: 0,
    });
    vi.spyOn(lists, "recordFacilityPull").mockResolvedValue({
      asked: 2, answered: 1, silent: 1, failed: 0, complete: true,
    });
  });

  it("asks the registrar last, after the registrations it reads", async () => {
    /*
     * Which sections to ask about comes from the registrations we hold, so a sweep run
     * before them asks about last week's list. It is also much the longest step, so
     * ending on it means everything else is in by the time the waiting starts.
     *
     * Asserted on the order things were actually DONE in, not the order they are drawn
     * in: the panel groups steps by a fixed list of kinds, so it shows the timetable last
     * whatever the run does, and an assertion about the rendering would pass with the
     * sweep running first.
     */
    const ran: string[] = [];
    vi.mocked(database.syncView).mockImplementation(async () => {
      ran.push("students");
      return { seen: 2, added: 2, missing: 0, syncedAt: "now" };
    });
    vi.mocked(lists.syncCourses).mockImplementation(async () => {
      ran.push("courses");
      return { seen: 1, added: 1, missing: 0, syncedAt: "now" };
    });
    vi.mocked(rosters.pullTimetable).mockImplementation(async () => {
      ran.push("timetable");
      return {
        termCode: "262710", asked: ["22151", "24001"], sections: [], silent: ["24001"],
        failed: [], complete: true, malformed: 0, warning: null, fetchedAt: 0,
      };
    });

    show();
    await sync();

    expect(ran).toEqual(["students", "courses", "timetable"]);
  });

  it("counts the sections answered and warns about none of it", async () => {
    /*
     * One of the two answered; the other was asked and said nothing, which is a section
     * with no room booked rather than a failure — so the run has nothing to warn about.
     *
     * It used to say so anyway, which put an amber triangle on the button at the end of
     * every single sync: there is always a section nobody has booked a room for yet, so
     * the warning could never be cleared and stopped being read. How much of the semester
     * is booked is on Groups & CRNs now, beside the clash count it qualifies.
     */
    show();
    await sync();

    const step = (await screen.findByText(/Registrar timetable/)).closest("li");
    expect(step?.textContent).toContain("1 returned");
    expect(screen.queryByText(/with nothing booked/)).toBeNull();
    expect(screen.queryByText(/sections timetabled/)).toBeNull();
    expect(screen.queryByText(/would not answer/)).toBeNull();
  });

  it("asks about the other departments' sections our students take", async () => {
    show();
    await sync();

    expect(rosters.pullTimetable).toHaveBeenCalledWith("262710", ["22151", "24001"], expect.any(Function));
  });

  it("leaves the run alone when no semester is linked to a portal term", async () => {
    // Nothing to ask about, and no step for it. A run that showed a step it could never
    // finish would look permanently half-done.
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});

    show();
    await sync();

    expect(screen.queryByText(/Registrar timetable/)).toBeNull();
  });
});

describe("a step that is many requests, not one", () => {
  it("counts its way through instead of only showing a clock", async () => {
    /*
     * Every other step is one slow request with nothing to report until it lands, and the
     * panel says so. The timetable is a hundred and sixty, and over minutes an elapsed
     * clock alone is indistinguishable from a hang — which is precisely the reading that
     * had a working sync reported as a missing extension.
     */
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
    vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
      { id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm,
    ]);
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151", "23652"], registered: [] });
    vi.spyOn(lists, "recordFacilityPull").mockResolvedValue({ asked: 2, answered: 2, silent: 0, failed: 0, complete: true });
    // A sweep that reports its way through and then waits to be let finish.
    let finish: (pull: rosters.TimetablePull) => void = () => {};
    vi.spyOn(rosters, "pullTimetable").mockImplementation(async (_term, _crns, onProgress) => {
      onProgress?.({ fetched: 1, total: 2 });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    show();
    const button = await screen.findByRole("button", { name: /portal sync/i });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);

    expect(await screen.findByText(/1 of 2,/)).toBeTruthy();
    // And the footer stops claiming there is nothing to count.
    expect(screen.getByText(/one request per section, two at a time/)).toBeTruthy();

    finish({
      termCode: "262710", asked: ["22151", "23652"], sections: [], silent: [],
      failed: [], complete: true, malformed: 0, warning: null, fetchedAt: 0,
    });
    await screen.findByText(/^Synced/);
  });
});

/*
 * A run that ends with a warning icon has something to say, and the only way to ask what
 * it was used to destroy the answer: the click that opened the panel also started a fresh
 * run, so by the time the report appeared every step was back to waiting.
 */
describe("reading what the last sync said", () => {
  const warned = async () => {
    // A pull that returned far fewer rows than the view expected. The extension decides
    // that and names it; here the mock stands in for the extension.
    vi.spyOn(rosters, "pullFilter").mockImplementation(async (_filter, meta) =>
      meta?.kind === "courses"
        ? COURSE_ROWS
        : { ...STUDENTS, count: 1, expect: 40, rows: [STUDENTS.rows[0]], warning: "count_drift" },
    );
    show();
    await sync();
  };

  it("opens the report instead of starting another sync", async () => {
    await warned();
    const pulls = vi.mocked(rosters.pullFilter).mock.calls.length;
    // Put the panel away, the way clicking off it does, and come back to ask.
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /portal sync/i }));

    // The warning is legible, and nothing was asked for again to make it so.
    expect(await screen.findByText(/where about 40 was expected/)).toBeTruthy();
    expect(vi.mocked(rosters.pullFilter).mock.calls.length).toBe(pulls);
    expect(screen.getByText(/^Synced/)).toBeTruthy();
  });

  it("keeps every step's result, rather than putting them back to waiting", async () => {
    await warned();
    fireEvent.keyDown(document, { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: /portal sync/i }));

    expect(await screen.findByText(/2 of 2 synced/)).toBeTruthy();
  });

  it("syncs again from inside the report, where it cannot be pressed by accident", async () => {
    await warned();
    const pulls = vi.mocked(rosters.pullFilter).mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Sync again" }));

    await waitFor(() => expect(vi.mocked(rosters.pullFilter).mock.calls.length).toBeGreaterThan(pulls));
    // Waited out. The run is module state shared by every test in this file, so leaving
    // one in flight means the next test's `startRun` finds `driving` still true and does
    // nothing — which fails somewhere else, intermittently, for no visible reason.
    await screen.findByText(/of 2 synced/);
  });

  it("still syncs on the first click when there is nothing to show", async () => {
    // The very first press of a session must not need two clicks to do anything.
    show();
    const button = await screen.findByRole("button", { name: /portal sync/i });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));

    fireEvent.click(button);

    expect(await screen.findByText(/^Synced/)).toBeTruthy();
  });
});
