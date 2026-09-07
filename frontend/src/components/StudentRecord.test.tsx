import { EMPTY_REQUEST, EMPTY_SECTION } from "@/services/studentDatabase";
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
  id: "cohort-1", name: "Foundation Year", term: "2026-27", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0,
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
    { termCode: "262710", crn: "23223", courseCode: "MATH-001", title: "Pre-calculus G.1-TD", teacherName: "Dr Maaz", status: "in_portal", lastSeenAt: "" },
    { termCode: "262710", crn: "23653", courseCode: "MATH-011", title: "Algorithms", teacherName: "Dr Ahmed", status: "in_portal", lastSeenAt: "" },
  ]);
  // The register: the tutorial hangs from the lecture the course is built around.
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([
    { id: "r1", crn: "23223", parentCrn: "22151", courseCode: "MATH-001" },
    { id: "r2", crn: "22151", parentCrn: "", courseCode: "MATH-001" },
  ] as unknown as lists.ActiveCrn[]);
  vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([
    { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "MATH-011", kind: "wrong", expected: ["23652"], registered: ["23653"] },
    { studentId: "A002", termId: "term-1", termCode: "262710", courseCode: "MATH-001", kind: "missing", expected: ["22151"], registered: [] },
  ]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1", slug: "s1", isPublished: true, courseCount: 1, sessionCount: 1, studentCount: 1 } as unknown as timetables.TimetableTerm,
  ]);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
    scopes: [
      {
        id: "scope-td", code: "TD", name: "Tutorials", note: "", termId: "term-1",
        kind: "shared", parentScopeId: "", openToAll: false, courses: [{ id: "c-algo", code: "MATH-011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST }],
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

    // One block per course, and the warning about a course sits with that course.
    const registrations = await screen.findByLabelText("Registrations");
    const courses = within(registrations).getAllByRole("listitem").filter((item) => item.parentElement === registrations);
    expect(courses.map((item) => item.textContent?.slice(0, 8))).toEqual(["MATH-001", "MATH-011"]);
    expect(registrations.textContent).toContain("Dr Ahmed");
    expect(courses[1].textContent).toContain("MATH-011: registered in 23653, we placed them in 23652");
    // The tutorial sits inside the lecture it hangs from, not beside it.
    const nested = within(courses[0]).getAllByRole("listitem");
    expect(nested).toHaveLength(1);
    expect(nested[0].textContent).toContain("23223");
  });

  it("reads the history from this browser", async () => {
    show();

    const history = await screen.findByLabelText("History");
    expect(history.textContent).toContain("student status: IS → AS");
  });
});

describe("a course the registrar has not touched", () => {
  it("says so, rather than looking like one it has", async () => {
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
      { crn: "23644", courseCode: "CPSC-100", title: "Computer Science G.1-TD", termCode: "262710", status: "in_portal" },
    ] as never);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue([
      // Registered in one of the two sections we expect: the course is partly there.
      { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "CPSC-100", kind: "missing", expected: ["22155", "23644"], registered: ["23644"] },
      // Registered in nothing at all — the heading exists only to carry the warning.
      { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "PHYS-118", kind: "missing", expected: ["22150"], registered: [] },
    ] as never);

    show();

    const list = await screen.findByLabelText("Registrations");
    const phys = within(list).getByText("PHYS-118").closest("li") as HTMLElement;
    expect(within(phys).getByText("nothing registered")).toBeTruthy();
    expect(within(phys).getByText(/no section of this course/)).toBeTruthy();
    // The course that does have a registration is not marked that way.
    const cpsc = within(list).getByText("CPSC-100").closest("li") as HTMLElement;
    expect(within(cpsc).queryByText("nothing registered")).toBeNull();
  });
});

describe("the two lists of CRNs", () => {
  it("shows what the groups come to against what the registrar has, and marks each gap", async () => {
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
      // One both sides have, and one the registrar has that is no group of theirs.
      { crn: "23652", courseCode: "MATH-011", title: "Algorithms G.1-TD", termCode: "262710", status: "in_portal" },
      { crn: "23421", courseCode: "SCEN-101", title: "French A0", termCode: "262710", status: "in_portal" },
    ] as never);

    show();

    const table = await screen.findByLabelText("CRNs");
    const rows = within(table).getAllByRole("row").slice(1).map((row) =>
      within(row).getAllByRole("cell").map((cell) => cell.textContent?.trim()),
    );

    expect(rows).toEqual([
      ["23652", "MATH-011Algorithms G.1-TD", "TD 1", "registered"],
      ["23421", "SCEN-101French A0", "no group of theirs", "registered"],
    ]);
    expect(screen.getByText(/1 agree/)).toBeTruthy();
    expect(screen.getByText(/1 registered that is no group of theirs/)).toBeTruthy();
  });
});
