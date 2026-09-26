import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CohortsPage } from "@/components/CohortsPage";
import * as dismissalStore from "@/services/warningDismissals";
import * as lists from "@/services/portalLists";
import * as publicationService from "@/services/publication";
import { forgetHistory, recordPull } from "@/services/pullHistory";
import { forgetRosters, rememberPull } from "@/services/rosterStore";
import { clearRun } from "@/services/syncRun";
import * as rosters from "@/services/scenRosters";
import * as comments from "@/services/studentComments";
import * as database from "@/services/studentDatabase";
import type { Cohort, DiscrepancyRule, Student } from "@/services/studentDatabase";

const L1: Cohort = {
  id: "c1",
  name: "L1 Maths",
  term: "2026-27",
  notes: "",
  majors: ["Applied Mathematics and Physics"], terms: [],
  yearLevel: "L1", workbookTab: "", firstSemester: 0, allowedCodes: [],
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

const WITHDRAWN: DiscrepancyRule = { id: "r1", field: "STST_CODE", kind: "changed_to", values: ["WD"], cohortId: "" };
const MAJOR: DiscrepancyRule = { id: "r2", field: "MAJOR_CODE_DESC", kind: "differs", values: [], cohortId: "" };
const IS_WITHDRAWN: DiscrepancyRule = { id: "r3", field: "STST_CODE", kind: "is", values: ["WD"], cohortId: "" };

/** A check's answer: the differences, and the ground they were looked for on. */
const report = (mismatches: lists.Mismatch[] = [], coverage: lists.TermCoverage[] = []): lists.RegistrationReport => ({
  mismatches,
  coverage,
  electives: [],
});

/**
 * A semester the register was fully asked about — the default everywhere below, so a test
 * that is not about coverage does not accidentally assert a cohort nobody has checked.
 */
const checked = (over: Partial<lists.TermCoverage> = {}): lists.TermCoverage => ({
  termId: "t1", termCode: "262710", members: 2, judged: 2, blind: 0, skipped: [], pulledInTerm: 2, undatedCrns: [], ...over,
});

const mismatch = (over: Partial<lists.Mismatch>): lists.Mismatch => ({
  studentId: "A001", termId: "t1", termCode: "262710", courseCode: "MATH-001",
  kind: "missing", expected: ["23223"], registered: [], ...over,
});

/** What the portal said, as this browser holds it. */
async function portalSays(rows: Record<string, string>[]) {
  await rememberPull({
    kind: "students", presetId: "view-1",
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

/** What the server holds, so a dismissal written in one test is not read by the next. */
let onServer: dismissalStore.Dismissal[] = [];

beforeEach(async () => {
  window.localStorage.clear();
  onServer = [];
  vi.spyOn(dismissalStore, "fetchDismissals").mockImplementation(async () => [...onServer]);
  vi.spyOn(dismissalStore, "setDismissal").mockImplementation(async (key: string, on: boolean) => {
    onServer = onServer.filter((entry) => entry.key !== key);
    if (!on) return null;
    const made = { key, byEmail: "coordinator@sorbonne.ae", byName: "Coordinator", at: "2026-09-16T09:00:00Z" };
    onServer = [...onServer, made];
    return made;
  });
  await forgetRosters();
  await forgetHistory();
  // The register agrees unless a test says otherwise. Left unmocked it would reach the
  // network, fail, and put every check in error — which switches the registration prune
  // off, so a test about pruning would pass without the prune ever running.
  vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
  vi.spyOn(comments, "fetchCommentSummary").mockResolvedValue({});
  vi.spyOn(comments, "fetchComments").mockResolvedValue([]);
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
    expect(within(rowOf("Amira Haddad")).getByTitle(/major is Physics, cohort expects/)).toBeTruthy();
    expect(within(rowOf("Karim Nasser")).queryByText(/cohort expects/)).toBeNull();
    // How many are flagged is on the toggle for the record that flags them.
    expect(screen.getByRole("button", { name: /Admissions\s*1/ })).toBeTruthy();
  });

  it("has no Cohort column — every row would say the same thing — and pills the groups", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      { ...student("A001", "c1"), groups: [{ termId: "t1", scopeCode: "TD", groupLabel: "1" }, { termId: "t1", scopeCode: "CM", groupLabel: "2" }] },
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();
    await screen.findByText("Amira Haddad");

    expect(screen.queryByRole("columnheader", { name: /^Cohort/ })).toBeNull();
    // Each group is its own pill, not one dotted string.
    const groups = within(rowOf("Amira Haddad")).getAllByText(/^(TD 1|CM 2)$/);
    expect(groups.map((pill) => pill.textContent)).toEqual(["TD 1", "CM 2"]);
  });

  it("shows how many students each cohort holds, in the picker", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", null, "")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage([{ ...L1, memberCount: 1 }]);
    fireEvent.click(await screen.findByRole("combobox", { name: "Cohort" }));

    // The year is its own pill beside the name, not part of it: no dash joins the two.
    expect(await screen.findByRole("option", { name: /L1 Maths\s*academic year\s*2026-27\s*1$/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /L1 Maths — 2026-27/ })).toBeNull();
  });

  it("offers each warning as a filter value, the way groups are", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      student("A001", "c1"),
      student("A002", "c1"),
      student("A003", "c1"),
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR, IS_WITHDRAWN]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics", STST_CODE: "AS" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", MAJOR_CODE_DESC: "Applied Mathematics and Physics", STST_CODE: "WD" },
      { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", MAJOR_CODE_DESC: "Applied Mathematics and Physics", STST_CODE: "AS" },
    ]);

    renderPage();
    await screen.findByText("Nadia Newcomer");

    // Filter → Warnings → tick the withdrawn warning: only Karim is left.
    fireEvent.click(screen.getByRole("button", { name: /^(Filter|Add filter)$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Warnings" }));
    fireEvent.click(await screen.findByRole("combobox", { name: "Warnings value" }));
    fireEvent.click(await screen.findByRole("option", { name: /student status is WD/ }));

    await waitFor(() => expect(screen.queryByText("Amira Haddad")).toBeNull());
    expect(screen.getByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByText("Nadia Newcomer")).toBeNull();
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

    expect(await screen.findByTitle(/student status changed to WD \(was AS\)/)).toBeTruthy();
  });

  it("dismisses a warning from its row, for everybody, and can bring it back", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();
    await screen.findByTitle(/major is Physics/);

    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));

    await waitFor(() => expect(screen.queryByTitle(/major is Physics/)).toBeNull());
    expect(screen.getByRole("button", { name: /Dismissed\s*1/ })).toBeTruthy();
    // On the server, not in this browser: the next coordinator to open the page meets
    // the decision already made rather than the warning again.
    await waitFor(() => expect(onServer.map((entry) => entry.key).join(" ")).toContain("A001:r2:"));
    expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).toBeNull();

    // Beside the toggles, a toggle of its own shows the dismissed ones back on their rows.
    fireEvent.click(screen.getByRole("button", { name: /Dismissed\s*1/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Restore: major is Physics/ }));

    expect(await screen.findByRole("button", { name: /Admissions\s*1/ })).toBeTruthy();
  });

  it("shows the error when the rules cannot be loaded, rather than an empty cohort", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockRejectedValue(new Error("The rules could not be loaded."));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The rules could not be loaded.");
  });

});

describe("the cohort a coordinator is working on", () => {
  const L2: Cohort = { ...L1, id: "c2", name: "L2 Maths", yearLevel: "L2" };

  async function twoCohorts() {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c2")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);
  }

  it("opens on the cohort the other pages are on, not the first in the list", async () => {
    // The shared contract in remembered.ts. This was the one cohort picker that kept its
    // own opinion, so moving between the pages silently reset the year at every step.
    window.localStorage.setItem("scen-remembered:cohort", "c2");
    await twoCohorts();

    renderPage([L1, L2]);

    expect(await screen.findByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByText("Amira Haddad")).toBeNull();
  });

  it("tells the other pages when the cohort is changed here", async () => {
    await twoCohorts();

    renderPage([L1, L2]);
    await screen.findByText("Amira Haddad");
    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: /L2 Maths/ }));

    await waitFor(() => expect(window.localStorage.getItem("scen-remembered:cohort")).toBe("c2"));
  });

  it("falls back to the first when the remembered cohort is gone", async () => {
    // Deleted since, or belonging to another deployment's data. The page must not be empty.
    window.localStorage.setItem("scen-remembered:cohort", "a-cohort-that-was-deleted");
    await twoCohorts();

    renderPage([L1, L2]);

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
  });
});

/*
 * Groups & CRNs hands the cohort page a handful of students to place. The table narrows to
 * them, and "Show everyone again" puts the rest back — the rest of THE COHORT, which is
 * what the page is about.
 */
describe("students sent over from Groups & CRNs", () => {
  const L2: Cohort = { ...L1, id: "c2", name: "L2 Maths", yearLevel: "L2" };

  async function twoCohorts() {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      student("A001", "c1"), student("A002", "c1"), student("A003", "c2"),
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
      { SPRIDEN_ID: "A003", FULL_NAME: "Rana Aziz" },
    ]);
  }

  const renderFocused = (ids: string[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CohortsPage cohorts={[L1, L2]} focus={{ cohortId: "c1", studentIds: ids }} />
      </QueryClientProvider>,
    );
  };

  it("shows only the ones sent", async () => {
    await twoCohorts();

    renderFocused(["A001"]);

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(screen.queryByText("Karim Nasser")).toBeNull();
  });

  /**
   * The page's owner, in miniature: it holds the handover, and lets go of it when the page
   * says the students are on screen. StudentDatabase is the real one.
   */
  function Sender({ ids }: { ids: string[] }) {
    const [focus, setFocus] = useState<{ cohortId: string; studentIds: string[] } | null>({
      cohortId: "c1",
      studentIds: ids,
    });
    return <CohortsPage cohorts={[L1, L2]} focus={focus} onFocusTaken={() => setFocus(null)} />;
  }

  const renderSent = (ids: string[]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Sender ids={ids} />
      </QueryClientProvider>,
    );
  };

  const chooseCohort = async (name: RegExp) => {
    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name }));
  };

  it("comes back to the cohort, not to every student in the database", async () => {
    /*
     * The arriving selection used to widen the search as well as narrow it — harmless when
     * `everywhere` only meant "ignore the chosen portal filter", and not harmless once it
     * also meant "ignore the cohort". Showing everyone again then showed all three
     * thousand students rather than this cohort's two.
     */
    await twoCohorts();

    renderFocused(["A001"]);
    await screen.findByText("Amira Haddad");
    fireEvent.click(screen.getByRole("button", { name: /Show everyone again/ }));

    expect(await screen.findByText("Karim Nasser")).toBeTruthy();
    // A002 is this cohort's. A003 is L2's, and must not appear.
    expect(screen.queryByText("Rana Aziz")).toBeNull();
  });

  it("is answered once, not every time the coordinator comes back to the cohort", async () => {
    /*
     * The handover used to be kept by the page above for the rest of the session, and the
     * table is keyed on the cohort — so leaving L1 and returning built a fresh table out
     * of the same handful, narrowed again, with "Show everyone again" beside it. The
     * coordinator answered the same arrival on every pass through their cohorts.
     */
    await twoCohorts();

    renderSent(["A001"]);
    await screen.findByText("Amira Haddad");
    fireEvent.click(screen.getByRole("button", { name: /Show everyone again/ }));
    await screen.findByText("Karim Nasser");

    await chooseCohort(/L2 Maths/);
    await screen.findByText("Rana Aziz");
    await chooseCohort(/L1 Maths/);

    expect(await screen.findByText("Karim Nasser")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Show everyone again/ })).toBeNull();
  });

  it("still narrows on arrival, which is the whole point of the handover", async () => {
    // The fix is that the sender lets go, not that nothing happens: the students it sent
    // must still be the only ones on screen when the page opens.
    await twoCohorts();

    renderSent(["A001"]);

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Karim Nasser")).toBeNull());
  });
});

describe("dismissals belong to the coordinator, not to the page on screen", () => {
  const L2: Cohort = { ...L1, id: "c2", name: "L2 Maths", yearLevel: "L2", memberCount: 1 };

  async function twoCohorts() {
    // L2 carries two flagged students where L1 carries one, so the count of warnings on
    // screen genuinely changes with the cohort. That is what makes the prune run again.
    vi.spyOn(database, "fetchStudents").mockResolvedValue([
      student("A001", "c1"), student("A002", "c2"), student("A003", "c2"),
    ]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", MAJOR_CODE_DESC: "Chemistry" },
      { SPRIDEN_ID: "A003", FULL_NAME: "Rana Aziz", MAJOR_CODE_DESC: "Biology" },
    ]);
    renderPage([L1, L2]);
  }

  const held = () => onServer.map((entry) => entry.key).join(" ");

  it("keeps a dismissal that belongs to a cohort the page is not showing", async () => {
    // The list is one; the table shows one cohort at a time. Nothing prunes it now, and
    // this is the guard that says so: a page that started deleting what it cannot see
    // would throw away decisions about every cohort but the one on screen.
    await twoCohorts();
    await screen.findByTitle(/major is Physics/);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));
    await waitFor(() => expect(held()).toContain("A001:r2:"));

    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: /L2 Maths/ }));

    await screen.findByTitle(/major is Chemistry/);
    expect(held()).toContain("A001:r2:");
  });

  it("brings back exactly the dismissed warnings on screen, and nobody else's", async () => {
    // The other cohort's registration difference, dismissed by somebody else.
    const theirs = mismatch({ studentId: "A003", courseCode: "PHYS-118", expected: ["22150"] });
    vi.spyOn(lists, "fetchRegistrationCheck").mockImplementation(async (cohortId: string) =>
      report(cohortId === "c2" ? [theirs] : [], [checked()]),
    );
    await twoCohorts();
    await screen.findByTitle(/major is Physics/);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));
    await waitFor(() => expect(held()).toContain("A001:r2:"));

    const theirKey = "registration|A003|262710|PHYS-118|missing|22150|";
    onServer = [...onServer, { key: theirKey, byEmail: "c@sorbonne.ae", byName: "Colleague", at: "2026-09-15T09:00:00Z" }];

    fireEvent.click(await screen.findByRole("button", { name: "Bring back" }));

    expect(await screen.findByTitle(/major is Physics/)).toBeTruthy();
    expect(held()).not.toContain("A001:r2:");
    // L2's, so not on screen, so not brought back.
    expect(held()).toContain(theirKey);
  });
});

/*
 * Course Registration was a page of its own until it was folded in here.
 *
 * These are that page's tests, kept, plus the ones the merge itself needs: that the two
 * records are told apart on the row, that either can be looked at alone, and that a count
 * of nothing from the register is not reported as agreement.
 */
describe("the register half of the Cohorts page", () => {
  async function twoStudents(rules: DiscrepancyRule[] = []) {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue(rules);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics", STST_CODE: "AS" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", MAJOR_CODE_DESC: "Applied Mathematics and Physics", STST_CODE: "AS" },
    ]);
  }

  /** The pill a warning is drawn in, so the test can ask which record it came from. */
  /*
   * The pill shows the KIND — "not registered" — and carries the whole sentence on its
   * title, because a cell beside eleven columns truncated the sentence to nothing useful.
   * So a pill is found by what it says in full, which is the thing worth asserting.
   */
  const pillOf = (text: RegExp | string) => screen.getByTitle(text).closest("[data-source]") as HTMLElement;

  it("warns about an elective nobody has approved, under a record of its own", async () => {
    /*
     * Sport included: the warning stays until a coordinator says yes, on the student's
     * record or with the cohort's allowed list. One the list covers, or one approved for
     * this student, has had its yes and says nothing.
     */
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue({
      ...report([], [checked()]),
      electives: [
        { studentId: "A001", termId: "t1", termCode: "262710", courseCode: "SPRT-650", crns: ["23667"], status: "open" },
        { studentId: "A002", termId: "t1", termCode: "262710", courseCode: "ENGL-616", crns: ["23757"], status: "allowed" },
        { studentId: "A002", termId: "t1", termCode: "262710", courseCode: "SPAN-603", crns: ["20598"], status: "approved" },
      ],
    });
    await twoStudents();

    renderPage();

    expect(await screen.findByText("SPRT-650 not approved")).toBeTruthy();
    expect(pillOf(/registered in SPRT-650 \(23667\).*no coordinator has approved it/).dataset.source).toBe("electives");
    expect(screen.queryByText(/ENGL-616 not approved/)).toBeNull();
    expect(screen.queryByText(/SPAN-603 not approved/)).toBeNull();

    // A filter of its own: turned off, the warning goes and nothing else does.
    // The filter, not the Electives column's header, which is a button too.
    const electives = screen.getAllByRole("button", { name: /Electives/ }).find((button) => button.hasAttribute("aria-pressed"))!;
    expect(electives.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(electives);
    await waitFor(() => expect(screen.queryByText("SPRT-650 not approved")).toBeNull());
  });

  it("carries the register's differences on the same rows as the record's", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    const row = within(rowOf("Amira Haddad"));
    // Both records, one row, one column.
    expect(row.getByTitle(/major is Physics, cohort expects/)).toBeTruthy();
    expect(row.getByTitle("MATH-001: not registered in 23223")).toBeTruthy();
    // The student both records agree about carries neither.
    expect(within(rowOf("Karim Nasser")).queryByText(/MATH-001/)).toBeNull();
  });

  it("carries a set nobody has placed them in as its own record, not among the register's", async () => {
    /*
     * This was a banner over the table with a proposal in it. A banner is the wrong shape
     * for a fact about one student: everything else the page says about one student is a
     * pill on their row, and a banner cannot be set aside while the registrar's
     * differences are cleared.
     */
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    vi.spyOn(publicationService, "fetchPublication").mockResolvedValue({
      cohorts: [{ cohortId: "c1", cohortName: "L1 Maths", unassigned: { TD: ["A001"], CM: ["A001", "A002"] }, clashes: [] }],
    } as unknown as publicationService.Publication);
    await twoStudents([MAJOR]);

    renderPage();
    expect(await screen.findByText("Amira Haddad")).toBeTruthy();

    // One pill per set they are short of, under a record of its own.
    const row = within(rowOf("Amira Haddad"));
    await waitFor(() => expect(row.getByTitle(/in no TD group/)).toBeTruthy());
    expect(row.getByTitle(/in no CM group/)).toBeTruthy();
    expect(pillOf(/in no TD group/).dataset.source).toBe("groups");
    // Its own colour, so it cannot be read as one of the other three records.
    expect(pillOf(/in no TD group/).className).not.toEqual(pillOf(/major is Physics, cohort expects/).className);
    // The student short of only the lecture set gets that one and no more.
    const other = within(rowOf("Karim Nasser"));
    expect(other.getByTitle(/in no CM group/)).toBeTruthy();
    expect(other.queryByTitle(/in no TD group/)).toBeNull();
    // And the register's own count is untouched by any of it.
    expect(screen.getByRole("button", { name: /^Register/ }).textContent).toContain("0");
  });

  it("keeps the cohort's own rules in a tab of its settings, saved with the rest", async () => {
    // "Cohort rules" was a button of its own beside the table; it is a tab now.
    vi.spyOn(lists, "fetchPortalCourses").mockResolvedValue({ terms: [], courses: [] });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});
    const updated = vi.spyOn(database, "updateCohort").mockResolvedValue(L1);
    const saved = vi.spyOn(database, "saveDiscrepancyRules").mockImplementation(async (rules) => rules as never);
    await twoStudents();

    renderPage();
    await screen.findByRole("button", { name: `${L1.name} settings` });
    expect(screen.queryByRole("button", { name: /Cohort rules/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `${L1.name} settings` }));
    fireEvent.click(await screen.findByRole("tab", { name: /Rules/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add a rule/ }));

    // A rule with no values yet is not a sentence: nothing saves until it is one.
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(await screen.findByLabelText("Values for rule 1"), { target: { value: "WD" } });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(updated).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0][0]).toEqual([
      expect.objectContaining({ field: "STST_CODE", kind: "changed_to", values: ["WD"], cohortId: L1.id }),
    ]);
  });

  it("saves no rules when only the cohort itself was changed", async () => {
    vi.spyOn(lists, "fetchPortalCourses").mockResolvedValue({ terms: [], courses: [] });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});
    const updated = vi.spyOn(database, "updateCohort").mockResolvedValue(L1);
    const saved = vi.spyOn(database, "saveDiscrepancyRules");
    await twoStudents();

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: `${L1.name} settings` }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(saved).not.toHaveBeenCalled();
  });

  it("asks the register again when the cohort is saved, so a newly allowed subject stops warning", async () => {
    // SPRT was added to FYS-S1's allowed list and every sport warning stayed on screen:
    // saving refreshed the cohort list and left the register's old verdict in place.
    const sport = { studentId: "A001", termId: "t1", termCode: "262710", courseCode: "SPRT-650", crns: ["23667"] };
    const check = vi
      .spyOn(lists, "fetchRegistrationCheck")
      .mockResolvedValue({ ...report([], [checked()]), electives: [{ ...sport, status: "open" }] });
    vi.spyOn(lists, "fetchPortalCourses").mockResolvedValue({ terms: [], courses: [] });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});
    vi.spyOn(database, "updateCohort").mockResolvedValue({ ...L1, allowedCodes: ["SPRT"] });
    await twoStudents();

    renderPage();
    expect(await screen.findByText("SPRT-650 not approved")).toBeTruthy();

    check.mockResolvedValue({ ...report([], [checked()]), electives: [{ ...sport, status: "allowed" }] });
    fireEvent.click(screen.getByRole("button", { name: `${L1.name} settings` }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByText("SPRT-650 not approved")).toBeNull());
  });

  it("lists a course outside the groups as an elective, and warns only about one nobody has approved", async () => {
    // Every elective is in the column, routine or not. Only one nobody has said yes to is
    // a warning — the allowed list's yes counts, and it says nothing.
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue({
      mismatches: [],
      coverage: [checked()],
      electives: [
        { studentId: "A001", termId: "t1", termCode: "262710", courseCode: "SPAN-601", crns: ["22595"], status: "open" },
        { studentId: "A001", termId: "t1", termCode: "262710", courseCode: "SPRT-628", crns: ["23352"], status: "allowed" },
      ],
    });
    await twoStudents([MAJOR]);

    renderPage();
    expect(await screen.findByText("Amira Haddad")).toBeTruthy();

    // On the row, in a column of its own, both of them — routine or not.
    const row = within(rowOf("Amira Haddad"));
    expect(row.getByText("SPAN-601 · SPRT-628")).toBeTruthy();
    /*
      * Among the warnings, the admissions one it was set up with and one for SPAN-601 —
      * under Electives, not the register, and nothing for the sport the list allows.
      */
    const pills = [...rowOf("Amira Haddad").querySelectorAll("[data-source]")];
    expect(pills.map((pill) => (pill as HTMLElement).dataset.source)).toEqual(["record", "electives"]);
    expect(row.getByText("SPAN-601 not approved")).toBeTruthy();
    expect(row.queryByText(/SPRT-628 not approved/)).toBeNull();
    // The student who holds none has an empty cell rather than somebody else's electives.
    expect(within(rowOf("Karim Nasser")).queryByText(/SPAN-601/)).toBeNull();
  });

  it("says which record each warning came out of, so one cannot be read as the other", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();
    await screen.findByTitle("MATH-001: not registered in 23223");

    expect(pillOf("MATH-001: not registered in 23223").dataset.source).toBe("registration");
    expect(pillOf(/major is Physics, cohort expects/).dataset.source).toBe("record");
    // And not only in the markup: the two are drawn in different colours.
    expect(pillOf("MATH-001: not registered in 23223").className).not.toEqual(
      pillOf(/major is Physics, cohort expects/).className,
    );
  });

  it("shows any combination of the records, counting the students in each", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A002" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();
    await screen.findByTitle("MATH-001: not registered in 23223");

    // One student flagged by each record; all three records on to begin with, no "All".
    const admissions = screen.getByRole("button", { name: "Admissions 1" });
    const register = screen.getByRole("button", { name: "Register 1" });
    expect(screen.getByRole("button", { name: "Timetabling 0" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^All / })).toBeNull();
    expect(admissions.getAttribute("aria-pressed")).toBe("true");
    expect(register.getAttribute("aria-pressed")).toBe("true");

    // Turn admissions off: the register's warning stays, the admissions one goes.
    fireEvent.click(admissions);
    await waitFor(() => expect(screen.queryByTitle(/major is Physics, cohort expects/)).toBeNull());
    expect(screen.getByTitle("MATH-001: not registered in 23223")).toBeTruthy();

    // Turn the register off too: nothing is shown, which is what nothing chosen means.
    fireEvent.click(register);
    await waitFor(() => expect(screen.queryByTitle("MATH-001: not registered in 23223")).toBeNull());

    // And back on, in any order.
    fireEvent.click(admissions);
    expect(await screen.findByTitle(/major is Physics, cohort expects/)).toBeTruthy();
    expect(screen.queryByTitle("MATH-001: not registered in 23223")).toBeNull();
  });

  it("puts a withdrawal above any number of registration differences", async () => {
    // Karim has four differences and Amira has withdrawn. A count would sort Karim first,
    // which is the whole reason the column stopped sorting on the count.
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([
      mismatch({ studentId: "A002", courseCode: "MATH-001" }),
      mismatch({ studentId: "A002", courseCode: "MATH-009" }),
      mismatch({ studentId: "A002", courseCode: "PHYS-118" }),
      mismatch({ studentId: "A002", courseCode: "CHEM-101" }),
    ], [checked()]));
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([IS_WITHDRAWN]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", STST_CODE: "WD" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", STST_CODE: "AS" },
    ]);

    renderPage();
    /*
     * Both records, before the order is read.
     *
     * They arrive from different places — the register from a query, the withdrawal from
     * this browser's own evidence — and waiting for only one of them read the order at a
     * moment when the table honestly had only half the warnings. Which made the test pass
     * or fail depending on how loaded the machine was.
     */
    await screen.findByTitle("MATH-001: not registered in 23223");
    await screen.findByText(/student status is WD/);

    await waitFor(() => {
      const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
      expect(rows.findIndex((text) => text.includes("Amira Haddad"))).toBeLessThan(
        rows.findIndex((text) => text.includes("Karim Nasser")),
      );
    });
  });

  it("counts a student once however many of their courses differ", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([
      mismatch({ studentId: "A001", courseCode: "MATH-001" }),
      mismatch({ studentId: "A001", courseCode: "MATH-009", kind: "wrong", expected: ["23365"], registered: ["23366"] }),
    ], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByText("Amira Haddad");

    // Two of her courses differ; she is one student on the Register toggle.
    expect(screen.getByRole("button", { name: /Register\s*1/ })).toBeTruthy();
  });

  /*
   * The four things "no differences" can mean, and the three of them that are not
   * agreement. Each is a separate sentence because each is a separate thing to go and do.
   */
  it("counts the stragglers a pull did not return, without flagging them", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ judged: 1, blind: 1, skipped: ["A002"] })]),
    );
    await twoStudents();

    renderPage();

    await screen.findByText("Amira Haddad");
    /*
     * A floor is not a flag. The straggler must not become a warning on a row, must not
     * raise the source filter — which only appears when there is something to choose
     * between — and must not put "N flagged" beside the cohort in the picker.
     */
    expect(document.querySelectorAll("[data-source]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Register/ })).toBeNull();
    expect(screen.queryByText(/flagged/)).toBeNull();
  });

  it("lets a difference be dismissed, and keeps it dismissed for everybody", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByTitle("MATH-001: not registered in 23223");
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: MATH-001/ }));

    await waitFor(() => expect(screen.queryByTitle("MATH-001: not registered in 23223")).toBeNull());
    expect(screen.getByRole("button", { name: /Dismissed\s*1/ })).toBeTruthy();
    await waitFor(() => expect(onServer.map((entry) => entry.key).join(" ")).toContain("registration|A001"));
  });

  it("says whose decision a dismissed warning was", async () => {
    /*
     * The whole cost of sharing dismissals: one hides a warning from colleagues who may
     * never have seen it. A name turns a disappearance into a decision somebody can look
     * at and disagree with, so it is on the pill and not only in a log.
     */
    onServer = [
      {
        key: "registration|A001|262710|MATH-001|missing|23223|",
        byEmail: "lina@sorbonne.ae",
        byName: "Lina Haddad",
        at: "2026-09-15T09:00:00Z",
      },
    ];
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents();

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Dismissed\s*1/ }));

    const pill = await screen.findByTitle(/MATH-001: not registered in 23223 — dismissed by Lina Haddad on .*2026/);
    expect(pill.textContent).toContain("Lina Haddad");
  });

  it("leaves a dismissal alone when the difference it points at is gone", async () => {
    /*
     * Three careful effects used to delete these, one per family, each guarding against
     * pruning on half-arrived evidence. A shared list must not be pruned at all: every
     * browser judges "gone" from its OWN evidence — its own pull history, its own checks —
     * so one of them would quietly throw away decisions made about warnings only another
     * browser can see. A row nothing matches is dead weight, and dead weight is cheap.
     */
    const gone = "registration|A001|262710|GONE-001|missing|11111|";
    onServer = [{ key: gone, byEmail: "c@sorbonne.ae", byName: "Colleague", at: "2026-09-15T09:00:00Z" }];
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByText("Amira Haddad");
    await waitFor(() => expect(lists.fetchRegistrationCheck).toHaveBeenCalled());

    // Still held, and saying nothing: the warning it named is not reported any more, so
    // there is nothing on screen for it to quieten and nothing to bring back.
    expect(onServer.map((entry) => entry.key)).toEqual([gone]);
    expect(screen.queryByText(/dismissed/)).toBeNull();
  });
});

describe("a student caught between our hour and another department's", () => {
  it("is a warning on their row, like every other thing wrong with them", async () => {
    /*
     * The same fact Active Courses reports per SECTION, said once per student here. There
     * the question is "what do we do about this slot" and the remedies belong to the
     * section; here it is "is anything wrong with this student", and a coordinator working
     * down a cohort wants to know this one loses their language hour every Tuesday.
     */
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report(
        [
          mismatch({
            studentId: "A001",
            kind: "collides",
            courseCode: "SCEN-101",
            expected: ["23302"],
            registered: ["22590"],
            scopeCode: "Tue 16:30–18:00",
          }),
        ],
        [checked()],
      ),
    );
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByTitle(/SCEN-101 \(23302\) is at the same hour as 22590 — Tue 16:30–18:00/)).toBeTruthy();
  });

  it("is counted among the timetabling warnings", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A001", kind: "collides" })], [checked()]),
    );
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(await screen.findByRole("button", { name: /Timetabling\s*1/ })).toBeTruthy();
  });
});

describe("the registrar's worklist, copied", () => {
  const L2: Cohort = { ...L1, id: "c2", name: "L2 Maths", yearLevel: "L2" };
  const copied: string[] = [];

  beforeEach(() => {
    copied.length = 0;
    Object.assign(navigator, {
      clipboard: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
    });
  });

  it("copies a line per CRN to add or drop, with the student written once", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report(
        [
          mismatch({ studentId: "A001", kind: "missing", courseCode: "MATH-001", expected: ["23561"], registered: [] }),
          mismatch({ studentId: "A001", kind: "wrong", courseCode: "MATH-009", expected: ["23564"], registered: ["23999"] }),
        ],
        [checked()],
      ),
    );
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();
    // A small button in the toolbar; the choice of one cohort or all is inside it, taken
    // at the moment of copying rather than asked of everybody who looks at the page.
    fireEvent.click(await screen.findByRole("button", { name: "Registrations to change" }));
    // Scoped to the dialog: the roster's own Copy menu is on the page behind it.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(copied).toHaveLength(1));
    const [header, ...rows] = copied[0].split("\n");
    expect(header.split("\t")).toContain("Remove CRN");
    // The name and the id once, at the head of their block.
    expect(rows[0]).toContain("A001\tAmira Haddad");
    expect(rows[1].startsWith("\t\t\t")).toBe(true);
    // Every CRN of theirs is in it, whichever verdict it came from.
    expect(copied[0]).toContain("23561");
    expect(copied[0]).toContain("23999");
  });

  it("says there is nothing to change rather than copying an empty table", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage([L1, L2]);
    fireEvent.click(await screen.findByRole("button", { name: "Registrations to change" }));

    // Both answers shown before either is chosen, because the counts are the decision.
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("nothing to change")).toHaveLength(2);
    for (const copy of within(dialog).getAllByRole("button", { name: "Copy" })) {
      expect(copy).toHaveProperty("disabled", true);
    }
  });
});

describe("three records, three kinds of trouble", () => {
  it("files a clash of hours under timetabling, not under the register", async () => {
    /*
     * It comes out of the same check as the registrations and is not one of them: not a
     * fault of the register, not chased with the registrar, and not something a
     * coordinator clearing registrations wants in the way.
     */
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A001", kind: "collides", scopeCode: "Tue 16:30–18:00" })], [checked()]),
    );
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    // Which of ours, and when — the two things that tell one clash from another.
    const pill = (await screen.findByText("MATH-001 Tue 16:30–18:00")).closest("[data-source]") as HTMLElement;
    expect(pill.dataset.source).toBe("timetabling");
  });

  it("says the kind and the one thing that identifies it, not the whole sentence", async () => {
    /*
     * The cell sits beside eleven other columns, so the whole sentence truncated to
     * nothing useful. The bare kind is no better: six rows reading "major differs" say
     * only that something is wrong six times. The value is what tells them apart.
     */
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();

    expect(await screen.findByText("major: Physics")).toBeTruthy();
    // And the whole of it is still one hover away, and still what a dismissal names.
    expect(screen.getByTitle(/major is Physics, cohort expects/)).toBeTruthy();
  });

  it("narrows to timetabling alone by turning the other two off", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A002", kind: "collides" })], [checked()]),
    );
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /Admissions/ }));
    fireEvent.click(screen.getByRole("button", { name: /Register/ }));

    expect(screen.getByRole("button", { name: /Timetabling/ }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText(/MATH-001/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("major: Physics")).toBeNull());
  });
});

describe("copying whichever records the reader acts on", () => {
  const copied: string[] = [];
  beforeEach(() => {
    copied.length = 0;
    Object.assign(navigator, {
      clipboard: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
    });
  });

  async function bothKinds() {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A002", kind: "missing", expected: ["23561"], registered: [] })], [checked()]),
    );
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Registrations to change" }));
    return screen.findByRole("dialog");
  }

  it("narrows the lines to the records chosen, not the students", async () => {
    /*
     * The same reading as the page's filter: a student flagged by two records appears
     * under each, carrying only that record's lines. Turning one off leaves the rest —
     * who receives the copy decides the combination, and the registrar wants the
     * registrations and the clashes and not a word about majors.
     */
    const dialog = await bothKinds();

    fireEvent.click(within(dialog).getByRole("button", { name: "Admissions" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Timetabling" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("23561");
    expect(copied[0]).not.toContain("Physics");
  });

  it("copies what is wrong instead of a CRN for an admissions line", async () => {
    const dialog = await bothKinds();

    fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Timetabling" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("Physics");
    expect(copied[0]).not.toContain("23561");
  });

  it("copies every record while all three are on, which is where it starts", async () => {
    const dialog = await bothKinds();

    fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("23561");
    expect(copied[0]).toContain("Physics");
  });
});

describe("the cohort picker says what kind of trouble each cohort has", () => {
  it("counts each record on its own, rather than adding them into one number", async () => {
    /*
     * "9 flagged" said that something is wrong nine times and nothing about what. Nine
     * records drifting from admissions, nine registrations to key in and nine hours a
     * student cannot attend are three different afternoons' work, and choosing which
     * cohort to open is often choosing which of them to do.
     */
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A002", kind: "collides" })], [checked()]),
    );
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);

    renderPage();

    // One student with a drifted record, one booked into two places at one hour, and
    // nothing the registrar disagrees about — three counts, not a total of two.
    expect(await screen.findByTitle("1 with a record that has drifted from admissions")).toBeTruthy();
    expect(screen.getByTitle("1 booked into two places at one hour")).toBeTruthy();
    expect(
      screen.queryByTitle(/the registrar has in other sections/),
    ).toBeNull();
  });
});

describe("choosing a combination of records", () => {
  const copied: string[] = [];
  beforeEach(() => {
    copied.length = 0;
    Object.assign(navigator, {
      clipboard: { writeText: (text: string) => { copied.push(text); return Promise.resolve(); } },
    });
  });

  it("keeps two of the three when one is turned off", async () => {
    // The registrar wants the registrations and the clashes and not a word about majors.
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), student("A002", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report(
        [
          mismatch({ studentId: "A002", kind: "missing", expected: ["23561"], registered: [] }),
          mismatch({ studentId: "A002", kind: "collides", courseCode: "SCEN-101" }),
        ],
        [checked()],
      ),
    );
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Registrations to change" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Admissions" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Copy" })[0]);

    await waitFor(() => expect(copied).toHaveLength(1));
    expect(copied[0]).toContain("23561");
    expect(copied[0]).toContain("SCEN-101");
    expect(copied[0]).not.toContain("Physics");
  });

  it("says there is nothing to copy when every record is turned off", async () => {
    // Rather than an empty table, which reads as a page that has broken.
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Registrations to change" }));
    const dialog = await screen.findByRole("dialog");
    for (const name of ["Admissions", "Register", "Timetabling"]) {
      fireEvent.click(within(dialog).getByRole("button", { name }));
    }

    expect(within(dialog).getByText(/No record chosen/)).toBeTruthy();
  });
});

describe("one cohort, or every cohort", () => {
  it("has a two-way switch beside the cohort picker: a cohort mark for this one, a globe for all of them", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1"), { ...student("A002", "c2"), cohortName: "L2 Maths" }]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    await portalSays([
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ]);
    renderPage([L1, { ...L1, id: "c2", name: "L2 Maths", yearLevel: "L2", memberCount: 1 }]);
    await screen.findByText("Amira Haddad");
    expect(screen.queryByText("Karim Nasser")).toBeNull();

    // Both answers in view, the chosen one marked.
    const one = screen.getByRole("radio", { name: "This cohort" });
    const all = screen.getByRole("radio", { name: "Every cohort" });
    expect(one.getAttribute("aria-checked")).toBe("true");
    expect(all.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(all);

    expect(await screen.findByText("Karim Nasser")).toBeTruthy();
    expect(all.getAttribute("aria-checked")).toBe("true");
    expect(one.getAttribute("aria-checked")).toBe("false");
    // No switch of its own on the table any more.
    expect(screen.queryByRole("button", { name: /All cohorts|This cohort/ })).toBeNull();
    // And the picker stops naming a cohort the table is no longer about.
    expect(screen.getByRole("combobox", { name: "Cohort" }).textContent).toContain("Every cohort");
    expect(screen.getByText(/showing every cohort/)).toBeTruthy();

    // Choosing a cohort is what brings the table back to one.
    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: /L2 Maths/ }));
    expect(screen.getByRole("radio", { name: "This cohort" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Cohort" }).textContent).toContain("L2 Maths");
    expect(await screen.findByText("Karim Nasser")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Amira Haddad")).toBeNull());
  });
});

describe("taking an arrival in from the banner", () => {
  it("adds them to the cohort on screen, shared sets kept, after a word of confirmation", async () => {
    const FYS: Cohort = { ...L1, id: "c1", name: "FYS-S1", yearLevel: "FY" };
    const L1_COHORT: Cohort = { ...L1, id: "c2", name: "L1 Maths", yearLevel: "L1" };
    const BELONGS: DiscrepancyRule = { id: "r4", field: "MAJOR_CODE", kind: "belongs", values: [], cohortId: "" };
    vi.spyOn(database, "fetchStudents").mockResolvedValue([{ ...student("A001", "c2"), cohortName: "L1 Maths" }]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([BELONGS]);
    const moved = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Samvel Martirosyan", MAJOR_CODE_DESC: "Applied Mathematics and Physics", YEARLEVEL_CODE: "FY" }]);

    renderPage([FYS, L1_COHORT]);
    fireEvent.click(await screen.findByRole("button", { name: "Add Samvel Martirosyan to FYS-S1" }));

    // The move is said before it is made: he leaves L1 and the groups he held there.
    expect(await screen.findByText(/leave L1 Maths/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add to FYS-S1" }));

    await waitFor(() => expect(moved).toHaveBeenCalledWith(["A001"], "c1", true));
  });
});

describe("who a cohort claims, after a sync", () => {
  it("stops claiming a student once a portal sync says they have moved on", async () => {
    /*
     * The page read the browser's rows once, on mount. A sync from the header changed
     * them underneath it, so a student the registrar had moved to L1 went on being
     * claimed by Foundation Year from a row that said FY — while his own record, reading
     * the fresh row, said L1. Reported from a real cohort.
     */
    const FYS: Cohort = { ...L1, id: "c1", name: "FYS-S1", yearLevel: "FY" };
    const L1_COHORT: Cohort = { ...L1, id: "c2", name: "L1 Maths", yearLevel: "L1" };
    const BELONGS: DiscrepancyRule = { id: "r4", field: "MAJOR_CODE", kind: "belongs", values: [], cohortId: "" };
    vi.spyOn(database, "fetchStudents").mockResolvedValue([{ ...student("A001", "c2"), cohortName: "L1 Maths" }]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([BELONGS]);
    const samvel = (yearLevel: string) => ({
      SPRIDEN_ID: "A001", FULL_NAME: "Samvel Martirosyan", MAJOR_CODE_DESC: "Applied Mathematics and Physics", YEARLEVEL_CODE: yearLevel,
    });
    await portalSays([samvel("FY")]);

    renderPage([FYS, L1_COHORT]);
    expect(await screen.findByText(/One student belongs to FYS-S1 by what it expects/)).toBeTruthy();

    // The registrar has moved him: the next pull says L1. Then the sync run is put away,
    // which is the last thing a finished sync does.
    await rememberPull({
      kind: "students", presetId: "view-1", name: "All", count: 1, expect: null, warning: null,
      fetchedAt: Date.parse("2026-09-11T08:00:00Z"), rows: [samvel("L1")],
    });
    clearRun();

    await waitFor(() => expect(screen.queryByText(/belongs to FYS-S1 by what it expects/)).toBeNull());
  });
});
