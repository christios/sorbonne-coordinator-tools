import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseCards } from "@/components/CourseCards";
import * as lists from "@/services/portalLists";
import * as publication from "@/services/publication";
import { EMPTY_REQUEST } from "@/services/studentDatabase";
import * as database from "@/services/studentDatabase";
import { EMPTY_SECTION } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "c1", name: "Foundation Year", term: "2026-27", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0,
  memberCount: 12, scopeCount: 2, createdAt: "", updatedAt: "",
};

const CATALOGUES: database.CohortCatalogue[] = [
  {
    cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
    scopes: [
      {
        id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [
          { id: "td-math", code: "MATH001", name: "Pre-calculus 1", component: "TD", request: EMPTY_REQUEST },
          { id: "td-algo", code: "MATH011", name: "Algorithms", component: "TD", request: EMPTY_REQUEST },
        ],
        groups: [
          { id: "td-1", label: "1", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 30, crns: { "td-math": { ...EMPTY_SECTION, crn: "23223", teacherId: "act-1", hours: "50" }, "td-algo": { ...EMPTY_SECTION, crn: "23652" } } },
          { id: "td-2", label: "2", capacity: 33, note: "", program: "", parentGroupId: "", assigned: 31, crns: { "td-math": { ...EMPTY_SECTION, crn: "23224" } } },
        ],
      },
    ],
  },
];

beforeEach(() => {
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue(CATALOGUES);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1", slug: "s1", isPublished: false, courseCount: 1, sessionCount: 1, studentCount: 1 } as unknown as timetables.TimetableTerm,
  ]);
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
    { id: "act-1", portalTeacherId: "A001", partTimeTeacherId: "", fullName: "Samar Ghantous", email: "", source: "portal", addedAt: "", addedBy: "", teacherStatus: "", category: "", type: "", lastTerm: "", department: "", rank: "", courses: "", institution: "", portalStatus: "" },
    { id: "act-2", portalTeacherId: "A002", partTimeTeacherId: "", fullName: "Jad Tarsissi", email: "", source: "portal", addedAt: "", addedBy: "", teacherStatus: "", category: "", type: "", lastTerm: "", department: "", rank: "", courses: "", institution: "", portalStatus: "" },
  ]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([
    { id: "a1", courseCode: "MATH001", title: "Pre-calculus 1", ue: "UL1MA001", mutualized: "" as const, addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
  ]);
  vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({
    portalTermCode: "262710",
    crns: {
      "23223": { courseCode: "MATH001", title: "", teacherName: "Samar Ghantous", status: "in_portal" },
      "23224": { courseCode: "MATH001", title: "", teacherName: "", status: "in_portal" },
      "23999": { courseCode: "MATH001", title: "", teacherName: "Jad Tarsissi", status: "in_portal" },
    },
  });
  vi.spyOn(publication, "fetchPublication").mockResolvedValue({
    cohorts: [{ cohortId: "c1", cohort: "Foundation Year", students: 12, studentsResolved: 10, unassigned: { TD: ["A9", "A10"] }, warnings: [], clashes: [], isReady: false }],
    validation: { "td-1|MATH001": { status: "matched", detail: "" } },
    unmatchedCrns: 0, sections: 40, resolved: { students: 10, enrolments: 20 }, isReady: false, coverage: { linked: true, portalTermCode: "262710", pulledAt: "now", asked: 2, timetabled: 2, blind: [], hubReachable: null },
  });
});

afterEach(() => vi.restoreAllMocks());

function show(onPlaceStudents?: (cohortId: string, ids: string[]) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CourseCards cohorts={[COHORT]} onPlaceStudents={onPlaceStudents} />
    </QueryClientProvider>,
  );
}

describe("the course cards", () => {
  it("lists the courses, and shows the chosen one in full", async () => {
    show();

    // The list is names and a count; the first course is shown without being asked for.
    const courses = await screen.findByRole("navigation", { name: "Courses" });
    // The list is the courses, and the way to bring one in sits under them. The files are
    // the cohort's rather than the list's, so they live up beside the cohort picker.
    const names = within(courses).getAllByRole("button").map((item) => item.textContent ?? "");
    expect(names.slice(0, 2).map((name) => name.slice(0, 7))).toEqual(["MATH001", "MATH011"]);
    expect(names.slice(2)).toEqual([" Add from portal"]);
    expect(screen.getByRole("button", { name: /Workbook and lists/ })).toBeTruthy();
    expect(screen.getByText("2 courses · 1 cohort-semester")).toBeTruthy();

    const detail = screen.getByRole("heading", { name: "MATH001" }).closest("section") as HTMLElement;
    expect(detail.textContent).toContain("Foundation Year · Semester 1");
    expect(await within(detail).findByText("Samar Ghantous")).toBeTruthy();
    expect(detail.textContent).not.toContain("Not on the active list");

    // Algorithms is not on the active list, and its own page says so.
    fireEvent.click(within(courses).getByText("MATH011"));
    expect(await screen.findByText("Not on the active list")).toBeTruthy();
  });

  it("changes a CRN and a teacher through the section's dialog", async () => {
    const saveCrn = vi.spyOn(database, "setGroupCrn").mockResolvedValue();
    const saveDetails = vi.spyOn(database, "updateSection").mockResolvedValue();
    show();

    expect(await screen.findByText("2 in no group")).toBeTruthy();
    const row = await screen.findByLabelText("Edit TD 2 MATH001");
    expect(row.textContent).toContain("23224");
    fireEvent.click(row);

    // The CRN is chosen from the portal's list for this course; the teacher from Active teachers.
    fireEvent.click(await screen.findByRole("combobox", { name: "CRN for TD 2 MATH001" }));
    fireEvent.click(await screen.findByRole("option", { name: /23999/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Teacher for TD 2 MATH001" }));
    fireEvent.click(await screen.findByRole("option", { name: "Jad Tarsissi" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveCrn).toHaveBeenCalledWith("td-2", "td-math", { crn: "23999", teacher: "" }));
    await waitFor(() => expect(saveDetails).toHaveBeenCalledWith("td-2", "td-math", expect.objectContaining({ teacherId: "act-2" })));
  });

  it("says on the card when a course is taught to both degrees at once", async () => {
    vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([
      { id: "a1", courseCode: "MATH001", title: "Pre-calculus 1", ue: "UL1MA001", mutualized: "yes" as const, addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710", portalParentCrn: "24226" },
    ]);

    show();

    expect(await screen.findByText("Mutualized")).toBeTruthy();
  });

  it("says nothing about mutualization until somebody has said", async () => {
    show();
    await screen.findByRole("heading", { name: "MATH001" });

    // Unanswered is not the same as "one degree only", so the page stays quiet.
    expect(screen.queryByText(/Mutualized|One degree only/)).toBeNull();
  });

  it("says the hours, the expected students and the seats as figures rather than prose", async () => {
    show();

    const one = (await screen.findByLabelText("Edit TD 1 MATH001")) as HTMLElement;
    // The three the timetable is built from, each with its own reading.
    expect(within(one).getByTitle("50 hours")).toBeTruthy();
    expect(within(one).getByTitle("No expected set yet")).toBeTruthy();
    expect(within(one).getByTitle("30 of 33 seats taken")).toBeTruthy();

    // A section nobody has given hours to says so, rather than saying nothing.
    const two = screen.getByLabelText("Edit TD 2 MATH001") as HTMLElement;
    expect(within(two).getByTitle("No hours set yet")).toBeTruthy();
    expect(within(two).getByTitle("31 of 33 seats taken")).toBeTruthy();
  });

  it("keeps the fullness bar on the card's bottom edge whatever else the card carries", async () => {
    show();

    // A STRUCTURAL PROXY, and it is one on purpose: jsdom performs no layout, so it
    // cannot see the gap this pins. The cards sit in a grid whose default align-items
    // is stretch, so every card in a row is as tall as the tallest; a plain block box
    // then leaves the surplus BELOW its last child, and the bar floats by exactly the
    // height difference. That is why it reads as "some cards" — the tallest one in each
    // row sets the height and is always flush.
    //
    // Two things hold it down and both must stay: the card is a column, and something
    // above the bar absorbs the surplus. Verify live at a width where sm:grid-cols-2 is
    // active and again at 2xl:grid-cols-3, with one short and one tall card in a row.
    const card = (await screen.findByLabelText("Edit TD 1 MATH001")) as HTMLElement;
    expect(card.classList.contains("flex")).toBe(true);
    expect(card.classList.contains("flex-col")).toBe(true);

    // The bar is aria-hidden and carries no accessible name, so it is reached
    // structurally: it is the card's last child, and the spacer sits right before it.
    const bar = card.lastElementChild as HTMLElement;
    expect(bar.className).toContain("rounded-b-lg");
    expect((bar.previousElementSibling as HTMLElement | null)?.className ?? "").toContain("flex-1");
  });

  it("sends the students a set has not placed to the page where placing happens", async () => {
    const place = vi.fn();
    show(place);

    fireEvent.click(await screen.findByRole("button", { name: /2 in no group/ }));

    // The cohort as well as the people: the Cohorts page is one cohort at a time.
    expect(place).toHaveBeenCalledWith("c1", ["A9", "A10"]);
  });

  it("narrows by search the way the tables do", async () => {
    show();
    await screen.findByRole("heading", { name: "MATH001" });

    fireEvent.change(screen.getByLabelText("Search courses"), { target: { value: "algo" } });

    const courses = screen.getByRole("navigation", { name: "Courses" });
    expect(within(courses).queryByText("MATH001")).toBeNull();
    expect(within(courses).getByText("MATH011")).toBeTruthy();
    expect(screen.getByText("2 courses, 1 shown · 1 cohort-semester")).toBeTruthy();
  });
});


describe("the clash count says what it could not see", () => {
  it("puts the blind sections beside the number, not in a warning of their own", async () => {
    /*
     * Not having asked the registrar is not a fault and cannot be cleared from this page.
     * But a count with nothing beside it reads as the whole truth about the semester, when
     * it may be a tenth of it.
     */
    vi.spyOn(publication, "fetchPublication").mockResolvedValue({
      cohorts: [{
        cohortId: "c1", cohort: "Foundation Year", students: 12, studentsResolved: 10,
        unassigned: {}, warnings: [], isReady: false,
        clashes: [{ groups: [{ id: "td-1", scopeId: "s", scopeCode: "TD", label: "1" }], windows: [], students: ["A1"] }],
      }],
      validation: {}, unmatchedCrns: 0, sections: 40,
      coverage: { linked: true, portalTermCode: "262710", pulledAt: "now", asked: 120, timetabled: 110, blind: ["1", "2"], hubReachable: null },
      resolved: { students: 10, enrolments: 20 }, isReady: false,
    } as never);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /1 student is in two groups/ }));

    expect(await screen.findByText(/110 of 120 sections have hours/)).toBeTruthy();
  });
});
