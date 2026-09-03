import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CohortsPage } from "@/components/CohortsPage";
import { forgetHistory, recordPull } from "@/services/pullHistory";
import { forgetRosters, rememberPull } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
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

function renderPage(cohorts = [L1]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CohortsPage cohorts={cohorts} />
    </QueryClientProvider>,
  );
}

/** The table row a student is on, found by their name in the Student column. */
const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

beforeEach(async () => {
  window.localStorage.clear();
  await forgetRosters();
  await forgetHistory();
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue({
    ok: true,
    source: "built-in",
    fields: [],
    columns: [],
    term: null,
    harvestedAt: null,
  } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("the Cohorts page", () => {
  it("is the Students table, narrowed to the cohort, with a Warnings column", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      student("A001", "c1"),
      student("A002", "c1"),
      student("A003", "c2"),
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", MAJOR_CODE_DESC: "Applied Mathematics and Physics" },
      { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", MAJOR_CODE_DESC: "Physics" },
    ]);

    renderPage();

    // The same table: its search box, its filter bar, its column picker.
    expect(await screen.findByRole("columnheader", { name: /Warnings/ })).toBeTruthy();
    expect(screen.getByLabelText("Search students")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Columns/ })).toBeTruthy();
    // Both members listed; the other cohort's student is not. (Rows land a beat after
    // the header, once the students and the evidence are both in.)
    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(screen.getByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();
    // The warning sits on Amira's row; Karim's row has none.
    expect(within(rowOf("Amira Haddad")).getByText(/major is Physics, cohort expects/)).toBeTruthy();
    expect(within(rowOf("Karim Nasser")).queryByText(/cohort expects/)).toBeNull();
    expect(screen.getByText(/1 of 2 students flagged/)).toBeTruthy();
  });

  it("puts the flagged students first", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Applied Mathematics and Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", MAJOR_CODE_DESC: "Physics" },
    ]);

    renderPage();
    await screen.findByText("Karim Nasser");

    const names = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    expect(names.findIndex((text) => text.includes("Karim Nasser"))).toBeLessThan(
      names.findIndex((text) => text.includes("Amira Haddad")),
    );
  });

  it("flags a status that changed after the student was placed", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([WITHDRAWN]);
    await recordPull("view-1", [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "AS" }], Date.parse("2026-09-02T08:00:00Z"));
    await recordPull("view-1", [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "WD" }], Date.parse("2026-09-10T08:00:00Z"));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "WD" }]);

    renderPage();

    expect(await screen.findByText(/student status changed to WD \(was AS\)/)).toBeTruthy();
  });

  it("says when the evidence is from, and what the cohort expects", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();

    expect(await screen.findByText(/As of this browser's last sync/)).toBeTruthy();
    expect(screen.getByText(/This cohort expects Applied Mathematics and Physics, L1/)).toBeTruthy();
  });

  it("lists the unplaced under “Not in any cohort”, flagging those who look fine", async () => {
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
    fireEvent.click(await screen.findByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: "Not in any cohort" }));

    await screen.findByText("Amira Haddad");
    expect(within(rowOf("Amira Haddad")).getByText(/in no cohort, and nothing about them/)).toBeTruthy();
    // Karim is unplaced too, so he is listed — but withdrawn, so not a candidate.
    expect(within(rowOf("Karim Nasser")).queryByText(/in no cohort/)).toBeNull();
    // Nadia is placed, so she is not on this list at all.
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();
  });

  it("dismisses a warning from its row, remembers it, and can bring it back", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();
    await screen.findByText(/major is Physics/);

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));

    await waitFor(() => expect(screen.queryByText(/major is Physics/)).toBeNull());
    expect(screen.getByText(/Nothing to flag among 1/)).toBeTruthy();
    expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).toContain("A001:r2:");

    fireEvent.click(screen.getByRole("button", { name: /Show 1 dismissed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Restore: major is Physics/ }));

    expect(await screen.findByText(/1 of 1 students flagged/)).toBeTruthy();
  });

  it("says once, in the summary, that placements predate the record — not on every row", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1", ""), student("A002", "c1", "")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([WITHDRAWN]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "AS" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "AS" },
    ]);

    renderPage();

    expect(await screen.findByText(/All were placed before the moment of placement was recorded/)).toBeTruthy();
    expect(screen.queryByText(/changes cannot be judged/)).toBeNull();
  });

  it("shows the error when the rules cannot be loaded, rather than an empty cohort", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockRejectedValue(new Error("The rules could not be loaded."));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The rules could not be loaded.");
  });

  it("says plainly when there are no rules yet", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByText(/No rules yet/)).toBeTruthy();
  });
});
