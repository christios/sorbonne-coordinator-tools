import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalRegistrations } from "@/components/PortalRegistrations";
import * as lists from "@/services/portalLists";
import { forgetHistory } from "@/services/pullHistory";
import { forgetRosters, rememberPull } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
import * as database from "@/services/studentDatabase";
import type { Cohort, Student } from "@/services/studentDatabase";

const FYS: Cohort = {
  id: "c1", name: "FYS-S1", term: "2026-27", notes: "",
  majors: [], terms: [], yearLevel: "FY",
  memberCount: 2, scopeCount: 0, createdAt: "", updatedAt: "",
};

const student = (studentId: string): Student => ({
  studentId, status: "in_portal", cohortId: "c1", cohortName: "FYS-S1",
  cohortSince: "2026-09-01T09:00:00Z", firstSeenAt: "", lastSeenAt: "", groups: [],
});

const mismatch = (over: Partial<lists.Mismatch>): lists.Mismatch => ({
  studentId: "A001", termId: "t1", termCode: "262710", courseCode: "MATH-001",
  kind: "missing", expected: ["23223"], registered: [], ...over,
});

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PortalRegistrations cohorts={[FYS]} />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  window.localStorage.clear();
  await forgetRosters();
  await forgetHistory();
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue({
    ok: true, source: "built-in", fields: [], columns: [], term: null, harvestedAt: null,
  } as never);
  vi.spyOn(lists, "fetchPortalFilters").mockResolvedValue([]);
  vi.spyOn(database, "fetchStudents").mockResolvedValue([student("A001"), student("A002")]);
  vi.spyOn(database, "fetchDiscrepancyRules").mockResolvedValue([]);
  await rememberPull({
    kind: "students", presetId: "view-1", name: "All", count: 2, expect: null, warning: null,
    fetchedAt: Date.parse("2026-09-10T08:00:00Z"),
    rows: [
      { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" },
      { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser" },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("the Course Registration page", () => {
  it("is the cohort's students, with what the registrar has differently", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([
      mismatch({ studentId: "A001", kind: "missing", expected: ["23223"], registered: [] }),
    ]);

    renderPage();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(within(rowOf("Amira Haddad")).getByText("MATH-001: not registered in 23223")).toBeTruthy();
    // The student the registrar has right carries nothing.
    expect(within(rowOf("Karim Nasser")).queryByText(/MATH-001/)).toBeNull();
    expect(screen.getByText(/1 of 2 students differ/)).toBeTruthy();
  });

  it("counts a student once, however many of their courses differ, and says what kind", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([
      mismatch({ studentId: "A001", courseCode: "MATH-001" }),
      mismatch({ studentId: "A001", courseCode: "MATH-009", kind: "wrong", expected: ["23365"], registered: ["23366"] }),
    ]);

    renderPage();
    await screen.findByText("Amira Haddad");

    expect(screen.getByText(/1 of 2 students differ/)).toBeTruthy();
    expect(screen.getByText(/1 not registered in a section we placed them in/)).toBeTruthy();
    expect(screen.getByText(/1 registered in another section/)).toBeTruthy();
  });

  it("lets a difference be dismissed, and keeps it dismissed", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([mismatch({ studentId: "A001" })]);

    renderPage();
    await screen.findByText("Amira Haddad");
    fireEvent.click(within(rowOf("Amira Haddad")).getByRole("button", { name: /Dismiss/ }));

    expect(within(rowOf("Amira Haddad")).queryByText("MATH-001: not registered in 23223")).toBeNull();
    expect(screen.getByText(/Show 1 dismissed/)).toBeTruthy();
    // Kept where the Cohorts page keeps its own, and recognisable as this page's.
    expect(window.localStorage.getItem("scen-discrepancy-dismissed:v1")).toContain("registration|A001");
  });
});
