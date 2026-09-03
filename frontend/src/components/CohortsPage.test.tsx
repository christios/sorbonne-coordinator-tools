import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CohortsPage } from "@/components/CohortsPage";
import { forgetHistory, recordPull } from "@/services/pullHistory";
import { forgetRosters, rememberPull } from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";
import type { Cohort, DiscrepancyRule, Student } from "@/services/studentDatabase";

const L1: Cohort = {
  id: "c1",
  name: "L1 Maths",
  term: "2026-27",
  notes: "",
  program: "Applied Mathematics and Physics",
  yearLevel: "L1",
  memberCount: 2,
  scopeCount: 0,
  createdAt: "",
  updatedAt: "",
};

const student = (studentId: string, cohortId: string | null, cohortSince = "2026-09-01T09:00:00Z"): Student => ({
  studentId,
  status: "in_portal",
  cohortId,
  cohortName: cohortId ? "L1 Maths" : "",
  cohortSince,
  firstSeenAt: "2026-08-01T00:00:00Z",
  lastSeenAt: "2026-09-10T00:00:00Z",
  groups: [],
});

const WITHDRAWN: DiscrepancyRule = { id: "r1", field: "STST_CODE", kind: "changed_to", values: ["WD"] };
const MAJOR: DiscrepancyRule = { id: "r2", field: "MAJOR_CODE_DESC", kind: "differs", values: [] };
const IS_WITHDRAWN: DiscrepancyRule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD"] };

/** What the portal said, as this browser holds it. */
async function portalSays(rows: Record<string, string>[]) {
  await rememberPull({
    presetId: "view-1",
    name: "All",
    count: rows.length,
    expect: null,
    warning: null,
    fetchedAt: Date.parse("2026-09-10T08:00:00Z"),
    rows,
  });
}

function renderPage(cohorts = [L1], onShowStudents = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CohortsPage cohorts={cohorts} onShowStudents={onShowStudents} />
    </QueryClientProvider>,
  );
  return onShowStudents;
}

beforeEach(async () => {
  window.localStorage.clear();
  await forgetRosters();
  await forgetHistory();
});
afterEach(() => vi.restoreAllMocks());

describe("the Cohorts page", () => {
  it("flags a student whose status changed after they were placed", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([WITHDRAWN]);
    // Two pulls: active at placement, withdrawn after.
    await recordPull("view-1", [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "AS" }, { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "AS" }], Date.parse("2026-09-02T08:00:00Z"));
    await recordPull("view-1", [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "WD" }, { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "AS" }], Date.parse("2026-09-10T08:00:00Z"));
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "WD" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "AS" },
    ]);

    renderPage();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(screen.getByText(/student status changed to WD \(was AS\)/)).toBeTruthy();
    // Karim has nothing to flag, so he is not in the flagged list by default.
    expect(screen.queryByText("Karim Nasser")).toBeNull();
    expect(screen.getByText(/1 of 2 students flagged/)).toBeTruthy();
  });

  it("flags a major that differs from what the cohort expects", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();

    expect(await screen.findByText(/major is Physics, cohort expects Applied Mathematics and Physics/)).toBeTruthy();
  });

  it("says when the evidence is from, and what the cohort expects", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();

    expect(await screen.findByText(/As of this browser's last sync/)).toBeTruthy();
    expect(screen.getByText(/This cohort expects Applied Mathematics and Physics, L1/)).toBeTruthy();
  });

  it("lists the unplaced who look fine, under “Not in any cohort”", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      student("A001", null, ""),
      student("A002", null, ""),
      student("A003", "c1"),
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([IS_WITHDRAWN]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "AS" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "WD" },
      { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", STST_CODE: "AS" },
    ]);

    renderPage();
    await screen.findByRole("combobox", { name: "Cohort" });
    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: "Not in any cohort" }));

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(screen.getByText(/in no cohort, and nothing about them says they should not be/)).toBeTruthy();
    // Withdrawn, so not a placement candidate; placed, so not unplaced.
    expect(screen.queryByText("Karim Nasser")).toBeNull();
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();
  });

  it("dismisses a warning, remembers it, and can bring it back", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();
    await screen.findByText(/major is Physics/);

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));

    await waitFor(() => expect(screen.queryByText(/major is Physics/)).toBeNull());
    expect(screen.getByText(/Nothing to flag among 1/)).toBeTruthy();
    // Remembered in this browser.
    expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).toContain("A001:r2:");

    fireEvent.click(screen.getByRole("button", { name: /Show 1 dismissed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Restore: major is Physics/ }));

    expect(await screen.findByText(/1 of 1 students flagged/)).toBeTruthy();
  });

  it("says so for a student placed before placement was recorded", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1", "")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([WITHDRAWN]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "AS" }]);

    renderPage();

    expect(await screen.findByText(/placed before the moment of placement was recorded/)).toBeTruthy();
  });

  it("hands a flagged student to the Students table, where moving lives", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);
    const onShowStudents = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Amira Haddad" }));

    expect(onShowStudents).toHaveBeenCalledWith(["A001"]);
  });

  it("says plainly when there are no rules yet", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByText(/No rules yet/)).toBeTruthy();
  });
});
