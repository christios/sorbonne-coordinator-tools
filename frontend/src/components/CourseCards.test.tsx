import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseCards } from "@/components/CourseCards";
import * as lists from "@/services/portalLists";
import * as publication from "@/services/publication";
import * as database from "@/services/studentDatabase";
import { EMPTY_SECTION } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "c1", name: "Foundation Year", term: "2026-27", notes: "", majors: [], terms: [], yearLevel: "",
  memberCount: 12, scopeCount: 2, createdAt: "", updatedAt: "",
};

const CATALOGUES: database.CohortCatalogue[] = [
  {
    cohort: { id: "c1", name: "Foundation Year", term: "2026-27" },
    scopes: [
      {
        id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
        courses: [
          { id: "td-math", code: "MATH001", name: "Pre-calculus 1", component: "TD" },
          { id: "td-algo", code: "MATH011", name: "Algorithms", component: "TD" },
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
    unmatchedCrns: 0, sections: 40, resolved: { students: 10, enrolments: 20 }, isReady: false,
  });
});

afterEach(() => vi.restoreAllMocks());

function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CourseCards cohorts={[COHORT]} />
    </QueryClientProvider>,
  );
}

describe("the course cards", () => {
  it("lists the courses, and shows the chosen one in full", async () => {
    show();

    // The list is names and a count; the first course is shown without being asked for.
    const courses = await screen.findByRole("navigation", { name: "Courses" });
    // The list is the courses; the two ways to bring a course in sit under them.
    const names = within(courses).getAllByRole("button").map((item) => item.textContent ?? "");
    expect(names.slice(0, 2).map((name) => name.slice(0, 7))).toEqual(["MATH001", "MATH011"]);
    expect(names.slice(2)).toEqual([" Add from portal", " Workbook and lists"]);
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
