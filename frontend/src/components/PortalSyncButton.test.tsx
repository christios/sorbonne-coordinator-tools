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
