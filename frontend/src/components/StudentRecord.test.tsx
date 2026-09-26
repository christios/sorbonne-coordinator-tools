import { EMPTY_REQUEST, EMPTY_SECTION } from "@/services/studentDatabase";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentRecord } from "@/components/StudentRecord";
import * as lists from "@/services/portalLists";
import * as sessionChanges from "@/services/sessionChanges";
import type { PullHistory } from "@/services/pullHistory";
import type { StudentRow } from "@/services/rosterView";
import * as comments from "@/services/studentComments";
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
  groups: ["TD 1"], sets: [], meets: [], signature: "TD 1", electives: [],
};

const COHORT: database.Cohort = {
  id: "cohort-1", name: "Foundation Year", term: "2026-27", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0, allowedCodes: [],
  memberCount: 1, scopeCount: 1, createdAt: "", updatedAt: "",
};

const HISTORY: PullHistory = {
  pulls: [{ id: "p1", at: Date.parse("2026-09-05T10:00:00Z"), arrived: [], departed: [], changed: { A001: [{ field: "STST_CODE", from: "IS", to: "AS" }] } }],
  latest: {},
  present: [],
} as unknown as PullHistory;

/** A check's answer: the differences, and the ground they were looked for on. */
const report = (mismatches: lists.Mismatch[] = [], coverage: lists.TermCoverage[] = []): lists.RegistrationReport => ({
  mismatches,
  coverage,
  electives: [],
});

/** A semester the register was fully asked about, with this student among those it saw. */
const checked = (over: Partial<lists.TermCoverage> = {}): lists.TermCoverage => ({
  termId: "term-1", termCode: "262710", members: 2, judged: 2, blind: 0, skipped: [], pulledInTerm: 2, undatedCrns: [], ...over,
});

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
  vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([
    { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "MATH-011", kind: "wrong", expected: ["23652"], registered: ["23653"] },
    { studentId: "A002", termId: "term-1", termCode: "262710", courseCode: "MATH-001", kind: "missing", expected: ["22151"], registered: [] },
  ], [checked()]));
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  // The registrar's sweep, for the week at the foot of the record.
  vi.spyOn(sessionChanges, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(lists, "fetchFacilitySections").mockImplementation(async (termCode, crns) => ({
    termCode,
    pulledAt: "",
    sections: crns.map((crn) => ({
      crn, courseCode: "", title: "", teacherName: "", state: "published" as const,
      meetings: [{ meetsOn: "2026-09-07", startsAt: "08:30", endsAt: "10:00", room: "5.101" }],
    })),
  }));
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1", slug: "s1", isPublished: true, courseCount: 1, sessionCount: 1, studentCount: 1 } as unknown as timetables.TimetableTerm,
  ]);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
    scopes: [
      {
        id: "scope-td", code: "TD", name: "Tutorials", note: "", termId: "term-1",
        kind: "shared", parentScopeId: "", openToAll: false, courses: [{ id: "c-algo", code: "MATH-011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST }],
        groups: [{ id: "td-1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: { "c-algo": { ...EMPTY_SECTION, crn: "23652", teacher: "" } } }],
      },
    ],
  });
  vi.spyOn(database, "fetchAssignments").mockResolvedValue({ A001: { "scope-td": "td-1" } });
  vi.spyOn(comments, "fetchComments").mockResolvedValue([]);
  // Which courses a student does not take. The CRNs table waits for this before it draws,
  // since it decides whether a row reads "exempt" or "not registered" in red.
  vi.spyOn(database, "fetchExemptions").mockResolvedValue([]);
});

afterEach(() => vi.restoreAllMocks());

function show(row: StudentRow = ROW) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StudentRecord open row={row} cohorts={[COHORT]} history={HISTORY} onClose={() => {}} />
    </QueryClientProvider>,
  );
  return queryClient;
}

/** Open a picker once it is enabled, then choose. Each waits on the one before it. */
const pick = async (label: string, option: string | RegExp) => {
  await waitFor(() =>
    expect((screen.getByRole("combobox", { name: label }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

describe("a student's record", () => {
  it("shows the portal's fields, the groups, the registrations and only this student's differences", async () => {
    show();

    expect(await screen.findByRole("heading", { name: "Amira Haddad" })).toBeTruthy();
    expect(screen.getByText("AS")).toBeTruthy();

    // Each set is a band of the one table, its CRNs under it.
    const td = await screen.findByLabelText("TD 1");
    expect(td.textContent).toContain("Semester 1");
    expect(within(td).getByText("23652").closest("tr")?.textContent).toContain("MATH-011");

    // The check's verdicts sit under the CRNs table, this student's only.
    const verdicts = await screen.findByLabelText("What the check says");
    expect(within(verdicts).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "MATH-011: registered in 23653, we placed them in 23652",
    ]);
    // What the registrar registered is a row of the CRNs table, not a card of its own.
    expect(screen.queryByText("Registered in the portal")).toBeNull();
    const table = screen.getByLabelText("CRNs");
    expect(within(table).getByText("23223")).toBeTruthy();
  });

  it("takes them out of one group from the group itself, after asking once", async () => {
    const assigned = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 0, skipped: [] });
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Take out of TD 1" }));
    // Nothing yet: the question is asked in words first, and "Keep" leaves them where they are.
    expect(assigned).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText(/Take them out of TD 1\?/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Take out of TD 1" }));
    expect(screen.getByText("Take them out of TD 1?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take out" }));

    // Out of that set alone — a null group in that set, for this one student.
    await waitFor(() => expect(assigned).toHaveBeenCalledWith("scope-td", ["A001"], null));
  });

  it("says exempt, not a fault, for a CRN of a course they do not take", async () => {
    /*
     * 23652 is a CRN their group gives them and the registrar has not registered them for.
     * That is red work to chase — unless they are exempt from the course, when it is a
     * registration that must never be made, and the red was asking for the wrong thing.
     */
    vi.spyOn(database, "fetchExemptions").mockResolvedValue([
      { studentId: "A001", courseId: "c-algo", courseCode: "MATH-011", scopeId: "scope-td", scopeCode: "TD", termId: "term-1", reason: "" },
    ]);
    show();

    const table = await screen.findByLabelText("CRNs");
    const row = within(table).getByText("23652").closest("tr");
    expect(row?.textContent).toContain("exempt");
    expect(row?.textContent).not.toContain("not registered");
    // And the count above the table agrees with the rows under it.
    expect(within(table.closest("section") ?? table).queryByText(/not registered/)).toBeNull();
  });

  it("still calls an unregistered CRN a fault when nothing excuses it", async () => {
    show();

    const table = await screen.findByLabelText("CRNs");
    const row = within(table).getByText("23652").closest("tr");
    expect(row?.textContent).toContain("not registered");
  });

  it("gives the portal's mobile number beside the e-mail, as a number to ring", async () => {
    show({ ...ROW, portal: { ...ROW.portal, MOBILE_NO: " +971 50 123 4567 " } });

    const mobile = await screen.findByRole("link", { name: "+971 50 123 4567" });
    expect(mobile.getAttribute("href")).toBe("tel:+971501234567");
  });

  it("says nothing about a mobile the portal has not given", async () => {
    show();

    await screen.findByLabelText("CRNs");
    expect(screen.queryByText("Mobile")).toBeNull();
  });

  it("reads the history from this browser", async () => {
    show();

    const history = await screen.findByLabelText("History");
    expect(history.textContent).toContain("student status: IS → AS");
  });
});

/*
 * The green tick is a claim about evidence, and it used to be made without any.
 *
 * The check skips a student no registrations pull has returned — correctly, there is
 * nothing to hold them against — and the record then found no differences about them and
 * said the registrations agreed with the groups. It was the confident version of "we did
 * not look".
 */
describe("a student the check never saw", () => {
  it("does not tell them their registrations agree", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(
      report([], [checked({ judged: 1, blind: 1, skipped: ["A001"] })]),
    );

    show();
    await screen.findByLabelText("CRNs");

    expect(screen.queryByText(/Registrations agree with the groups/)).toBeNull();
    expect(screen.getByText(/No registrations pull has returned this student for their semester/)).toBeTruthy();
  });

  it("still says they agree when the check did see them", async () => {
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([], [checked()]));

    show();
    await screen.findByLabelText("CRNs");

    expect(await screen.findByText(/Registrations agree with the groups/)).toBeTruthy();
  });
});

describe("a course the registrar has not touched", () => {
  it("is still a verdict under the CRNs, since no row of the table can carry it", async () => {
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
      { crn: "23644", courseCode: "CPSC-100", title: "Computer Science G.1-TD", termCode: "262710", status: "in_portal" },
    ] as never);
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue(report([
      // Registered in one of the two sections we expect: the course is partly there.
      { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "CPSC-100", kind: "missing", expected: ["22155", "23644"], registered: ["23644"] },
      // Registered in nothing at all — the heading exists only to carry the warning.
      { studentId: "A001", termId: "term-1", termCode: "262710", courseCode: "PHYS-118", kind: "missing", expected: ["22150"], registered: [] },
    ] as never, [checked()]));

    show();

    const verdicts = await screen.findByLabelText("What the check says");
    const said = within(verdicts).getAllByRole("listitem").map((item) => item.textContent);
    expect(said).toEqual(["CPSC-100: not registered in 22155", "PHYS-118: not registered in 22150"]);
  });
});

describe("the groups and their CRNs, against the portal", () => {
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent?.trim());

  it("puts each CRN under its group, and what the portal has outside the groups last", async () => {
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
      // One both sides have, and one the registrar has that is no group of theirs.
      { crn: "23652", courseCode: "MATH-011", title: "Algorithms G.1-TD", termCode: "262710", teacherName: "Dr Ahmed", status: "in_portal" },
      { crn: "23421", courseCode: "SCEN-101", title: "French A0", termCode: "262710", teacherName: "Mme Roux", status: "in_portal" },
    ] as never);

    show();

    const td = await screen.findByLabelText("TD 1");
    expect(cells(within(td).getByText("23652").closest("tr") as HTMLElement).slice(0, 4)).toEqual([
      "23652", "MATH-011Algorithms", "Dr Ahmed", "registered",
    ]);
    const outside = screen.getByLabelText("Registered outside their groups");
    expect(cells(within(outside).getByText("23421").closest("tr") as HTMLElement).slice(0, 4)).toEqual([
      "23421", "SCEN-101French A0", "Mme Roux", "no group of theirs",
    ]);
    expect(screen.getByText(/1 registered as placed · 1 outside their groups/)).toBeTruthy();
  });

  it("names who teaches each CRN as the portal has it, whatever the group was planned with", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
      scopes: [
        {
          id: "scope-td", code: "TD", name: "Tutorials", note: "", termId: "term-1",
          kind: "shared", parentScopeId: "", openToAll: false, courses: [{ id: "c-algo", code: "MATH-011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST }],
          groups: [{ id: "td-1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: { "c-algo": { ...EMPTY_SECTION, crn: "23652", teacher: "Sara Khaled" } } }],
        },
      ],
    });
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([
      { crn: "23652", courseCode: "MATH-011", title: "Algorithms", termCode: "262710", teacherName: "Diaa Mereib, Sara Khaled", status: "in_portal" },
    ] as never);

    show();

    const row = within(await screen.findByLabelText("TD 1")).getByText("23652").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("Diaa Mereib, Sara Khaled");
    expect(row.textContent).not.toContain("portal:");
  });

  it("finds the portal's teacher in the register for a CRN they are not registered in", async () => {
    vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([]);
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([
      { id: "r3", crn: "23652", parentCrn: "", courseCode: "MATH-011", teacherName: "Grace Younes" },
    ] as unknown as lists.ActiveCrn[]);
    show();

    const row = within(await screen.findByLabelText("TD 1")).getByText("23652").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("Grace Younes");
    expect(row.textContent).toContain("not registered");
  });

  it("exempts from a course with a word on a button, in every set, and undoes it the same way", async () => {
    // The same course in two sets: its lecture and its tutorial are one exemption.
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
      scopes: [
        {
          id: "scope-cm", code: "CM", name: "", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [{ id: "c-algo-cm", code: "MATH-011", name: "Algorithms", component: "CM", request: EMPTY_REQUEST }],
          groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: { "c-algo-cm": { ...EMPTY_SECTION, crn: "23600" } } }],
        },
        {
          id: "scope-td", code: "TD", name: "", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [{ id: "c-algo", code: "MATH-011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST }],
          groups: [{ id: "td-1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: { "c-algo": { ...EMPTY_SECTION, crn: "23652" } } }],
        },
      ],
    });
    vi.spyOn(database, "fetchAssignments").mockResolvedValue({ A001: { "scope-cm": "cm-a", "scope-td": "td-1" } });
    const set = vi.spyOn(database, "setExemption").mockResolvedValue(undefined as never);
    show();

    const buttons = await screen.findAllByRole("button", { name: "Exempt from MATH-011" });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
    expect(set.mock.calls.map((call) => call[1]).sort()).toEqual(["c-algo", "c-algo-cm"]);
  });

  it("says exempt, and offers the way back, on a course they do not take", async () => {
    vi.spyOn(database, "fetchExemptions").mockResolvedValue([
      { studentId: "A001", courseId: "c-algo", courseCode: "MATH-011", scopeId: "scope-td", scopeCode: "TD", termId: "term-1", reason: "" },
    ]);
    const clear = vi.spyOn(database, "clearExemption").mockResolvedValue(undefined as never);
    show();

    const row = within(await screen.findByLabelText("TD 1")).getByText("23652").closest("tr") as HTMLElement;
    expect(row.textContent).toContain("exempt");
    fireEvent.click(within(row).getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(clear).toHaveBeenCalledWith("A001", "c-algo"));
  });
});

describe("placing one student from their own record", () => {
  it("offers to propose a group in every set, which is the question this surface is about", async () => {
    /*
     * The record modal is the only surface organised BY STUDENT — every other one is
     * organised by set or by cohort — and a student arriving in week three is a question
     * about one person, not about a set.
     */
    show();
    await screen.findByLabelText("TD 1");

    fireEvent.click(screen.getByRole("button", { name: /Place in every set/ }));

    expect(await screen.findByText(/Propose groups for 1 student/)).toBeTruthy();
  });
});

describe("after placing them from their own record", () => {
  it("refreshes the roster row behind the record, not only the record", async () => {
    /*
     * The record invalidated the groups and the catalogue and nothing else, so the row it
     * was opened from — whose Groups column comes from the students list, and whose
     * warnings come from the register — read as before until the page was reloaded.
     */
    vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 1, skipped: [] });
    const client = show();
    const invalidated = vi.spyOn(client, "invalidateQueries");
    await screen.findByLabelText("TD 1");
    fireEvent.click(screen.getByRole("button", { name: /Place in every set/ }));

    await pick("Groups", "I'll choose");
    await pick("Semester", "Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 1/);
    fireEvent.click(screen.getByRole("button", { name: /Place 1/ }));

    await waitFor(() => expect(invalidated).toHaveBeenCalledWith({ queryKey: ["students"] }));
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ["registration-check"] });
  });
});

describe("the thread on the record", () => {
  it("is the same thread the row's mark opens, under the portal's card", async () => {
    vi.spyOn(comments, "fetchComments").mockResolvedValue([
      { id: "c1", studentId: "A001", body: "Spoke to the registrar.", authorEmail: "x@sorbonne.ae", authorName: "Colleague", createdAt: "2026-09-10T08:30:00+00:00" },
    ]);
    show();

    expect(await screen.findByText("Spoke to the registrar.")).toBeTruthy();
    expect(screen.getByLabelText("Add a comment on Amira Haddad")).toBeTruthy();
  });
});

describe("their week", () => {
  it("draws the groups' sections and the registrations as one calendar, dashing what the registrar has not registered", async () => {
    /*
     * A student's timetable is two lists drawn as one: what their groups stand for, and
     * what the registrar registered. The tutorial we placed them in and the registrar has
     * not is the class we expect them at and nobody else does — dashed, not dropped.
     */
    show();

    const card = (await screen.findByText("Timetable")).closest("section") as HTMLElement;
    const boxes = await within(card).findAllByLabelText(/CRN \d+/);
    // The group's 23652, plus the three registrations — one of them an elective in no group.
    expect(boxes).toHaveLength(4);
    expect(within(card).getByLabelText(/CRN 23652.*in their group, not registered/)).toBeTruthy();
    expect(within(card).getByLabelText(/CRN 23653/).getAttribute("aria-label")).not.toMatch(/not registered/);
  });
});
