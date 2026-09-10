import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CohortsPage } from "@/components/CohortsPage";
import * as lists from "@/services/portalLists";
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
  majors: ["Applied Mathematics and Physics"], terms: [],
  yearLevel: "L1", workbookTab: "", firstSemester: 0,
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

beforeEach(async () => {
  window.localStorage.clear();
  await forgetRosters();
  await forgetHistory();
  // The register agrees unless a test says otherwise. Left unmocked it would reach the
  // network, fail, and put every check in error — which switches the registration prune
  // off, so a test about pruning would pass without the prune ever running.
  vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
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

    expect(await screen.findByText(/student status changed to WD \(was AS\)/)).toBeTruthy();
  });

  it("says when the evidence is from, and what the cohort expects", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([MAJOR]);
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" }]);

    renderPage();

    expect(await screen.findByText(/As of this browser's last sync/)).toBeTruthy();
    expect(screen.getByText(/This cohort expects major Applied Mathematics and Physics, year level L1/)).toBeTruthy();
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

    expect(await screen.findByText(/No rules apply here/)).toBeTruthy();
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

  const held = () => window.localStorage.getItem("scen-discrepancy-dismissed:v1") ?? "";

  it("keeps a dismissal that belongs to a cohort the page is not showing", async () => {
    // The store is one; the table shows one cohort at a time. Pruning against only the
    // cohort on screen threw away every decision made about all the others — silently,
    // and on the first render after switching.
    await twoCohorts();
    await screen.findByText(/major is Physics/);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));
    await waitFor(() => expect(held()).toContain("A001:r2:"));

    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    fireEvent.click(await screen.findByRole("option", { name: /L2 Maths/ }));

    await screen.findByText(/major is Chemistry/);
    expect(held()).toContain("A001:r2:");
  });

  it("brings back exactly the dismissed warnings on screen, and nobody else's", async () => {
    // The other cohort's live registration difference. This page owns that family now —
    // it prunes it — so the key has to be one the register really reports, or it would be
    // pruned for being dead rather than kept for belonging to somebody else.
    const theirs = mismatch({ studentId: "A003", courseCode: "PHYS-118", expected: ["22150"] });
    vi.spyOn(lists, "fetchRegistrationCheck").mockImplementation(async (cohortId: string) =>
      report(cohortId === "c2" ? [theirs] : [], [checked()]),
    );
    await twoCohorts();
    await screen.findByText(/major is Physics/);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: major is Physics/ }));
    await waitFor(() => expect(held()).toContain("A001:r2:"));

    const theirKey = "registration|A003|262710|PHYS-118|missing|22150|";
    window.localStorage.setItem("scen-discrepancy-dismissed:v1", JSON.stringify([...JSON.parse(held()), theirKey]));

    fireEvent.click(await screen.findByRole("button", { name: /Bring 1 back/ }));

    expect(await screen.findByText(/major is Physics/)).toBeTruthy();
    expect(held()).not.toContain("A001:r2:");
    // L2's, so not on screen, so not brought back — and not pruned either.
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
  const pillOf = (text: RegExp | string) => screen.getByText(text).closest("[data-source]") as HTMLElement;

  it("carries the register's differences on the same rows as the record's", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    const row = within(rowOf("Amira Haddad"));
    // Both records, one row, one column.
    expect(row.getByText(/major is Physics, cohort expects/)).toBeTruthy();
    expect(row.getByText("MATH-001: not registered in 23223")).toBeTruthy();
    // The student both records agree about carries neither.
    expect(within(rowOf("Karim Nasser")).queryByText(/MATH-001/)).toBeNull();
  });

  it("says which record each warning came out of, so one cannot be read as the other", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();
    await screen.findByText("MATH-001: not registered in 23223");

    expect(pillOf("MATH-001: not registered in 23223").dataset.source).toBe("registration");
    expect(pillOf(/major is Physics, cohort expects/).dataset.source).toBe("record");
    // And not only in the markup: the two are drawn in different colours.
    expect(pillOf("MATH-001: not registered in 23223").className).not.toEqual(
      pillOf(/major is Physics, cohort expects/).className,
    );
  });

  it("shows one record at a time when asked, counting the students in each", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A002" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();
    await screen.findByText("MATH-001: not registered in 23223");

    // One student flagged by each record, two between them.
    expect(screen.getByRole("button", { name: "All 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Admissions 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Register 1" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Register 1" }));

    await waitFor(() => expect(screen.queryByText(/major is Physics, cohort expects/)).toBeNull());
    expect(screen.getByText("MATH-001: not registered in 23223")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Admissions 1" }));

    await waitFor(() => expect(screen.queryByText("MATH-001: not registered in 23223")).toBeNull());
    expect(screen.getByText(/major is Physics, cohort expects/)).toBeTruthy();
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
    await screen.findByText("MATH-001: not registered in 23223");
    await screen.findByText(/student status is WD/);

    await waitFor(() => {
      const rows = screen.getAllByRole("row").map((row) => row.textContent ?? "");
      expect(rows.findIndex((text) => text.includes("Amira Haddad"))).toBeLessThan(
        rows.findIndex((text) => text.includes("Karim Nasser")),
      );
    });
  });

  it("counts a student once however many of their courses differ, and says what kind", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([
      mismatch({ studentId: "A001", courseCode: "MATH-001" }),
      mismatch({ studentId: "A001", courseCode: "MATH-009", kind: "wrong", expected: ["23365"], registered: ["23366"] }),
    ], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByText("Amira Haddad");

    expect(screen.getByText(/The register differs about 1 of them/)).toBeTruthy();
    expect(screen.getByText(/1 not registered in a section we placed them in/)).toBeTruthy();
    expect(screen.getByText(/1 registered in another section/)).toBeTruthy();
  });

  it("says the register could not be asked, rather than that it agrees", async () => {
    // The request itself fell over. Reporting that as "every student is registered
    // correctly" is the exact mistake this page exists to prevent.
    vi.spyOn(lists, "fetchRegistrationCheck").mockRejectedValue(new Error("no semester"));
    await twoStudents();

    renderPage();

    expect(await screen.findByText(/The register could not be asked about this cohort at all/)).toBeTruthy();
    expect(screen.queryByText(/exactly the sections their groups give them/)).toBeNull();
  });

  /*
   * The four things "no differences" can mean, and the three of them that are not
   * agreement. Each is a separate sentence because each is a separate thing to go and do.
   */
  it("names a semester nobody has linked to a portal term", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ termCode: "", judged: 0, blind: 2, skipped: ["A001", "A002"], pulledInTerm: 0 })]),
    );
    await twoStudents();

    renderPage();

    expect(
      await screen.findByText(/is not linked to a portal term, so none of its 2 students have been checked/),
    ).toBeTruthy();
    expect(screen.getByText(/Nobody has asked the register about this cohort yet/)).toBeTruthy();
    expect(screen.queryByText(/exactly the sections their groups give them/)).toBeNull();
  });

  it("names a semester nothing has been pulled for", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ judged: 0, blind: 2, skipped: ["A001", "A002"], pulledInTerm: 0 })]),
    );
    await twoStudents();

    renderPage();

    expect(await screen.findByText(/Nothing has been pulled for .*so none of its 2 students have been checked/)).toBeTruthy();
  });

  it("tells a filter scoped to the wrong population from one that never ran", async () => {
    // Registrations were pulled — just nobody from here. Without `pulledInTerm` on the
    // wire this reads exactly like a sync that was never done, and the fix is different.
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ judged: 0, blind: 2, skipped: ["A001", "A002"], pulledInTerm: 400 })]),
    );
    await twoStudents();

    renderPage();

    expect(await screen.findByText(/the filter that ran covers another population/)).toBeTruthy();
  });

  it("counts the stragglers a pull did not return, without flagging them", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ judged: 1, blind: 1, skipped: ["A002"] })]),
    );
    await twoStudents();

    renderPage();

    expect(await screen.findByText(/1 of 2 students checked — 1 no pull has returned/)).toBeTruthy();
    /*
     * A floor is not a flag. The straggler must not become a warning on a row, must not
     * raise the source filter — which only appears when there is something to choose
     * between — and must not put "N flagged" beside the cohort in the picker.
     */
    expect(document.querySelectorAll("[data-source]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^Register/ })).toBeNull();
    expect(screen.queryByText(/flagged/)).toBeNull();
  });

  it("says when it has no timetable to tell the halves of a course apart", async () => {
    /*
     * The date-aware expectation only works on the registrar's own timetable. Without it
     * both halves of a handover are expected every day of the year — the old behaviour,
     * kept on purpose because narrowing on no evidence is worse — and if that is not said
     * out loud the fix looks as though it is working when nothing has been pulled.
     */
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ undatedCrns: ["22151", "23652", "23820"] })]),
    );
    await twoStudents();

    renderPage();

    expect(
      await screen.findByText(/no timetable for 3 of this cohort's sections, so a course taught in two halves/),
    ).toBeTruthy();
    // Still not a flag: nobody is warned, and the students were all checked.
    expect(document.querySelectorAll("[data-source]")).toHaveLength(0);
    expect(screen.queryByText(/students checked/)).toBeNull();
  });

  it("says nothing at all about a semester it saw all of", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await twoStudents();

    renderPage();

    expect(await screen.findByText(/exactly the sections their groups give them/)).toBeTruthy();
    // The one silence on this page that has been earned.
    expect(screen.queryByText(/students checked/)).toBeNull();
    expect(screen.queryByText(/it could see/)).toBeNull();
  });

  it("lets a difference be dismissed, and keeps it dismissed", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByText("MATH-001: not registered in 23223");
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss: MATH-001/ }));

    await waitFor(() => expect(screen.queryByText("MATH-001: not registered in 23223")).toBeNull());
    expect(screen.getByText(/Show 1 dismissed/)).toBeTruthy();
    expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).toContain("registration|A001");
  });

  it("forgets a dismissed difference the register no longer reports", async () => {
    // The counterpart of keeping another cohort's: a key that is genuinely dead goes, or
    // the store grows for ever. It has to be the register's own prune that does it.
    window.localStorage.setItem(
      "scen-discrepancy-dismissed:v1",
      JSON.stringify(["registration|A001|262710|GONE-001|missing|11111|"]),
    );
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));
    await twoStudents();

    renderPage();
    await screen.findByText("Amira Haddad");

    await waitFor(() =>
      expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).not.toContain("GONE-001"),
    );
  });

  it("prunes each record's dismissals against its own evidence, and only its own", async () => {
    /*
     * Two prunes now run on one page over one store, and each must keep to its family.
     * Seeded BEFORE the render, so both prunes really see all four keys — a dismissal
     * written afterwards is never offered to them, which is how a test can pass while the
     * families are crossed.
     *
     * Dead of each family must go; live of each family must stay. Point either prune at
     * the other's family and one of these four goes the wrong way.
     */
    const liveRegistration = "registration|A001|262710|MATH-001|missing|23223|";
    const deadRegistration = "registration|A001|262710|GONE-001|missing|11111|";
    const liveRule = "A001:r2:Physics≠Applied Mathematics and Physics";
    const deadRule = "A001:r99:whatever";
    window.localStorage.setItem(
      "scen-discrepancy-dismissed:v1",
      JSON.stringify([liveRegistration, deadRegistration, liveRule, deadRule]),
    );
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([mismatch({ studentId: "A001" })], [checked()]));
    await twoStudents([MAJOR]);

    renderPage();
    await screen.findByText("Amira Haddad");

    // Both dismissals are in force, so the row shows nothing until they are asked for.
    await waitFor(() => expect(screen.getByText(/Show 2 dismissed/)).toBeTruthy());
    const held = () => JSON.parse(window.localStorage.getItem("scen-discrepancy-dismissed:v1") ?? "[]") as string[];
    await waitFor(() => expect(held()).not.toContain(deadRegistration));
    expect(held()).not.toContain(deadRule);
    expect(held()).toContain(liveRegistration);
    expect(held()).toContain(liveRule);
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

    expect(await screen.findByText(/SCEN-101 \(23302\) is at the same hour as 22590 — Tue 16:30–18:00/)).toBeTruthy();
  });

  it("is counted among the register's differences, in its own words", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001", "c1")]);
    vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([mismatch({ studentId: "A001", kind: "collides" })], [checked()]),
    );
    await portalSays([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }]);

    renderPage();

    expect(
      await screen.findByText(/1 in one of our hours and another department's at once/),
    ).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: /Registrations to change/ }));

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

    const button = await screen.findByRole("button", { name: /Registrations to change/ });
    await waitFor(() => expect(button).toHaveProperty("disabled", true));
  });
});
