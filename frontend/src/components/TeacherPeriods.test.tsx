import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherPeriods } from "@/components/TeacherPeriods";
import * as lists from "@/services/portalLists";
import * as sessions from "@/services/sessionChanges";
import * as database from "@/services/studentDatabase";
import * as teachers from "@/services/teachers";
import * as timetables from "@/services/timetables";

const TERM = { id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm;

const CATALOGUE = [
  {
    cohort: { id: "c1", name: "FYS-S1", term: "2026-27" },
    scopes: [
      {
        id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared",
        parentScopeId: "", openToAll: false,
        courses: [{ id: "c-math", code: "MATH-100", name: "Analysis", component: "TD", request: database.EMPTY_REQUEST }],
        groups: [
          {
            id: "g1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 20,
            crns: { "c-math": { ...database.EMPTY_SECTION, crn: "23644", teacher: "", teacherId: "act-1", hours: "24" } },
          },
        ],
      },
    ],
  },
] as unknown as database.CohortCatalogue[];

const meeting = (meetsOn: string) => ({ meetsOn, startsAt: "08:30", endsAt: "10:00", room: "5.101" });

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TeacherPeriods teacherId="pt-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([TERM]);
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
    { id: "act-1", fullName: "Bilal Maaz", partTimeTeacherId: "pt-1" },
  ] as never);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue(CATALOGUE);
  vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });
  vi.spyOn(teachers, "fetchTeacherSummary").mockResolvedValue({ "pt-1": { contractedHours: 100 } } as never);
  vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
  vi.spyOn(sessions, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
    termCode: "262710",
    pulledAt: "",
    sections: [
      {
        crn: "23644", courseCode: "MATH-100", title: "Analysis", teacherName: "", state: "published",
        meetings: [meeting("2026-09-16"), meeting("2026-09-23"), meeting("2026-10-21")],
      },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("what a part-time teacher taught, period by period", () => {
  it("counts the classes that met in each period, and says what they were contracted for", async () => {
    show();

    // Two 90-minute classes in 15 Sep – 14 Oct, one in the period after.
    expect(await screen.findByText("15 Sep – 14 Oct 2026")).toBeTruthy();
    expect(await screen.findByText("3 h")).toBeTruthy();
    expect(screen.getByText("15 Oct – 14 Nov 2026")).toBeTruthy();
    expect(screen.getByText("1.5 h")).toBeTruthy();
    expect(screen.getByText(/Contracted for 100 h/)).toBeTruthy();
  });

  it("says plainly where no sheet has been filed for a period", async () => {
    show();

    expect(await screen.findAllByText("No sheet filed")).toHaveLength(2);
  });

  it("takes a cancelled class off the claim", async () => {
    vi.spyOn(sessions, "fetchSessionChanges").mockResolvedValue([
      {
        id: "n1", termCode: "262710", crn: "23644", meetsOn: "2026-09-16", startsAt: "08:30", endsAt: "10:00",
        kind: "cancelled", coverTeacherId: "", coverTeacherName: "", note: "", authorEmail: "", authorName: "",
        createdAt: "", updatedAt: "",
      },
    ]);

    show();

    // One class left in each period now, so both read 1.5 h and nothing reads 3.
    expect(await screen.findAllByText("1.5 h")).toHaveLength(2);
    expect(screen.queryByText("3 h")).toBeNull();
  });

  it("has nothing to count for somebody not joined to an Active teacher", async () => {
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);

    show();

    expect(await screen.findByText(/Not joined to an Active teacher/)).toBeTruthy();
  });
});
