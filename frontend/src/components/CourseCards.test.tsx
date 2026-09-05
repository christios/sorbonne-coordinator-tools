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
        id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "",
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
    { id: "a1", courseCode: "MATH001", title: "Pre-calculus 1", ue: "UL1MA001", parentCrn: "24226", addedAt: "", addedBy: "", crnCount: 3, termCount: 1, lastTerm: "262710" },
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
  it("shows one collapsed card per course, with where it is and who teaches it", async () => {
    show();

    const maths = (await screen.findByText("MATH001")).closest("article") as HTMLElement;
    expect(maths.textContent).toContain("Pre-calculus 1");
    expect(maths.textContent).toContain("Foundation Year · Semester 1");
    expect(maths.textContent).toContain("2 sections in TD");
    expect(await within(maths).findByText("Samar Ghantous")).toBeTruthy();
    expect(screen.queryByLabelText("Edit TD 1 MATH001")).toBeNull();
    expect(screen.getByText("2 courses · 1 cohort-semester")).toBeTruthy();
    // Algorithms is not on the active list, and the card says so; Pre-calculus is, and does not.
    const algo = screen.getByText("MATH011").closest("article") as HTMLElement;
    expect(algo.textContent).toContain("Not on the active list");
    expect(maths.textContent).not.toContain("Not on the active list");
  });

  it("opens to the sections, and changes a CRN and a teacher through the row's dialog", async () => {
    const saveCrn = vi.spyOn(database, "setGroupCrn").mockResolvedValue();
    const saveDetails = vi.spyOn(database, "updateSection").mockResolvedValue();
    show();

    fireEvent.click(await screen.findByLabelText("Expand MATH001"));
    expect(await screen.findByText("2 in no group")).toBeTruthy();
    const row = screen.getByTitle("Edit TD 2 MATH001");
    expect(row.textContent).toContain("23224");
    fireEvent.click(screen.getByLabelText("Edit TD 2 MATH001"));

    // The CRN is chosen from the portal's list for this course; the teacher from Active teachers.
    fireEvent.click(await screen.findByRole("combobox", { name: "CRN for TD 2 MATH001" }));
    fireEvent.click(await screen.findByRole("option", { name: /23999/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Teacher for TD 2 MATH001" }));
    fireEvent.click(await screen.findByRole("option", { name: "Jad Tarsissi" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveCrn).toHaveBeenCalledWith("td-2", "td-math", { crn: "23999", teacher: "" }));
    await waitFor(() => expect(saveDetails).toHaveBeenCalledWith("td-2", "td-math", expect.objectContaining({ teacherId: "act-2" })));
  });

  it("narrows by search the way the tables do", async () => {
    show();
    await screen.findByText("MATH001");

    fireEvent.change(screen.getByLabelText("Search courses"), { target: { value: "algo" } });

    expect(screen.queryByText("MATH001")).toBeNull();
    expect(screen.getByText("MATH011")).toBeTruthy();
    expect(screen.getByText("2 courses, 1 shown · 1 cohort-semester")).toBeTruthy();
  });
});
