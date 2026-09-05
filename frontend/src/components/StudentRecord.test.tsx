import { EMPTY_SECTION } from "@/services/studentDatabase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentRecord } from "@/components/StudentRecord";
import * as lists from "@/services/portalLists";
import type { PullHistory } from "@/services/pullHistory";
import type { StudentRow } from "@/services/rosterView";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const ROW: StudentRow = {
  studentId: "A001",
  name: "Amira Haddad",
  yearLevel: "FY",
  major: "Mathematics",
  email: "a@sorbonne.ae",
  status: "in_portal",
  cohortId: "cohort-1",
  cohortName: "Foundation Year",
  cohortSince: "",
  firstSeenAt: "",
  lastSeenAt: "",
  portal: { FULL_NAME: "Amira Haddad", STST_CODE: "AS", MAJOR_CODE_DESC: "Mathematics" },
  isNew: false,
  changes: [],
  warnings: [],
  groups: ["TD 1"],
};

const COHORT: database.Cohort = {
  id: "cohort-1", name: "Foundation Year", term: "2026-27", notes: "", majors: [], terms: [], yearLevel: "",
  memberCount: 1, scopeCount: 1, createdAt: "", updatedAt: "",
};

const HISTORY: PullHistory = {
  pulls: [{ id: "p1", at: Date.parse("2026-09-05T10:00:00Z"), arrived: [], departed: [], changed: { A001: [{ field: "STST_CODE", from: "IS", to: "AS" }] } }],
  latest: {},
  present: [],
} as unknown as PullHistory;

beforeEach(() => {
  vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
    { termCode: "262710", crn: "22151", courseCode: "MATH-001", title: "Pre-calculus", teacherName: "Dr Maaz", status: "in_portal", lastSeenAt: "" },
    { termCode: "262710", crn: "23653", courseCode: "MATH-011", title: "Algorithms", teacherName: "Dr Ahmed", status: "in_portal", lastSeenAt: "" },
  ]);
  vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([
    { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "MATH-011", kind: "wrong", expected: "23652", registered: ["23653"] },
    { studentId: "A002", termId: "term-1", termCode: "262710", courseCode: "MATH-001", kind: "missing", expected: "22151", registered: [] },
  ]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1", slug: "s1", isPublished: true, courseCount: 1, sessionCount: 1, studentCount: 1 } as unknown as timetables.TimetableTerm,
  ]);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
    scopes: [
      {
        id: "scope-td", code: "TD", name: "Tutorials", note: "", termId: "term-1",
        kind: "shared", parentScopeId: "", openToAll: false, courses: [{ id: "c-algo", code: "MATH-011", name: "Algorithms", component: "TD" }],
        groups: [{ id: "td-1", label: "1", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 1, crns: { "c-algo": { ...EMPTY_SECTION, crn: "23652", teacher: "" } } }],
      },
    ],
  });
  vi.spyOn(database, "fetchAssignments").mockResolvedValue({ A001: { "scope-td": "td-1" } });
});

afterEach(() => vi.restoreAllMocks());

function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StudentRecord open row={ROW} cohorts={[COHORT]} history={HISTORY} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("a student's record", () => {
  it("shows the portal's fields, the groups, the registrations and only this student's differences", async () => {
    show();

    expect(await screen.findByRole("heading", { name: "Amira Haddad" })).toBeTruthy();
    expect(screen.getByText("AS")).toBeTruthy();

    const groups = await screen.findByLabelText("Groups");
    expect(groups.textContent).toContain("TD 1");
    expect(groups.textContent).toContain("Semester 1");
    expect(groups.textContent).toContain("MATH-011 23652");

    const registrations = await screen.findByLabelText("Registrations");
    expect(within(registrations).getAllByRole("row")).toHaveLength(3);
    expect(registrations.textContent).toContain("Dr Ahmed");

    const differences = await screen.findByLabelText("Differences");
    expect(differences.textContent).toBe("MATH-011: registered in 23653, group says 23652");
  });

  it("reads the history from this browser", async () => {
    show();

    const history = await screen.findByLabelText("History");
    expect(history.textContent).toContain("student status: IS → AS");
  });
});
