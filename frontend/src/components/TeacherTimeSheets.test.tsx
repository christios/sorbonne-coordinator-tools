import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeSheetsCard } from "@/components/TeacherTimeSheets";
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

const submitted = (over = {}) => ({
  periodId: "41", version: 1, teacherId: "pt-1", periodStart: "2026-10-15", periodEnd: "2026-11-14",
  periodLabel: "Oct–Nov 2026",
  staff: { name: "Bilal Maaz", staffId: "A001", email: "b@sorbonne.ae", department: "SCEN", position: "Lecturer" },
  claimedHours: 1.5, approvedBy: "Christian Khairallah", approvedByEmail: "c@sorbonne.ae",
  approvedOn: "2026-11-16T08:00:00Z",
  days: [{ day: "Wed", date: "2026-10-21", from: "08:30", to: "10:00", hours: 1.5, details: "" }],
  sentAt: "", receivedAt: "2026-11-16T08:02:00Z", ...over,
}) as never;

const sheet = (over = {}) => ({
  id: "ts-1", teacherId: "pt-1", label: "Part time sheet, SepOct", academicYear: "2026-2027",
  url: "https://psuadacae.sharepoint.com/sheet.xlsx", periodStart: "2026-09-15", ...over,
}) as never;

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TimeSheetsCard teacherId="pt-1" />
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
  vi.spyOn(sessions, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([]);
  vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
    termCode: "262710",
    pulledAt: "",
    sections: [
      {
        crn: "23644", courseCode: "MATH-100", title: "Analysis", teacherName: "", state: "published",
        meetings: [
          { meetsOn: "2026-09-16", startsAt: "08:30", endsAt: "10:00", room: "5.101" },
          { meetsOn: "2026-10-21", startsAt: "08:30", endsAt: "10:00", room: "5.101" },
        ],
      },
    ],
  });
});
afterEach(() => vi.restoreAllMocks());

describe("time sheets, read by pay period", () => {
  it("is one card: a period, what was taught in it, and the sheet claiming it", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([sheet()]);

    show();

    // The hours last: the period appears from the filed sheet before the registrar's
    // meetings have arrived, and reads zero until they do.
    // Two periods, one class of 90 minutes in each, so both read 1.5 h.
    expect(await screen.findAllByText("1.5 h")).toHaveLength(2);
    expect(screen.getByText("15 Sep – 14 Oct 2026")).toBeTruthy();
    expect(screen.getByText("Part time sheet, SepOct")).toBeTruthy();
  });

  it("says where a period has no sheet, which a list of sheets cannot show", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([sheet()]);

    show();

    // The October period has a class and no sheet.
    expect(await screen.findByText("15 Oct – 14 Nov 2026")).toBeTruthy();
    expect(screen.getByText("No sheet filed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "File a sheet for 15 Oct – 14 Nov 2026" })).toBeTruthy();
  });

  it("opens the form against that period, with the period already named", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);

    show();
    fireEvent.click(await screen.findByRole("button", { name: "File a sheet for 15 Sep – 14 Oct 2026" }));

    await waitFor(() => expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("15 Sep – 14 Oct 2026"));
  });

  it("keeps a sheet filed against no period rather than losing it", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([
      sheet({ id: "ts-old", label: "An older sheet", periodStart: "" }),
    ]);

    show();

    expect(await screen.findByText("Not against a period here")).toBeTruthy();
    expect(screen.getByText("An older sheet")).toBeTruthy();
  });

  it("says what is wrong when nobody has joined them to an Active teacher", async () => {
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);

    show();

    expect(await screen.findByText(/Not joined to an Active teacher/)).toBeTruthy();
  });
});

describe("a period the Part-Time Timesheets app has had approved", () => {
  it("fills the period rather than leaving it reading as unfiled", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([submitted()]);

    show();

    expect(await screen.findByText("Submitted 1.5 h")).toBeTruthy();
    expect(screen.getByText(/approved by Christian Khairallah/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "File a sheet for 15 Oct – 14 Nov 2026" })).toBeNull();
  });

  it("says how far the claim is from what the timetable has, which nobody would check by hand", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([submitted({ claimedHours: 4 })]);

    show();

    expect(await screen.findByText("2.5 h more than the timetable has")).toBeTruthy();
  });

  it("says so plainly when the two agree", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([submitted()]);

    show();

    expect(await screen.findByText("matching the timetable")).toBeTruthy();
  });
});

describe("opening a submitted sheet", () => {
  it("shows the days that were worked, which the total alone asks you to take on trust", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([
      submitted({
        days: [
          { day: "Mon", date: "2026-10-19", from: "08:30", to: "10:30", hours: 2, details: "PHYS-101 TD" },
          { day: "Wed", date: "2026-10-21", from: "08:30", to: "12:30", hours: 4, details: "" },
        ],
      }),
    ]);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Submitted 1.5 h/ }));

    expect(screen.getByText("Mon 19 Oct")).toBeTruthy();
    expect(screen.getByText("08:30–10:30")).toBeTruthy();
    expect(screen.getByText("PHYS-101 TD")).toBeTruthy();
    expect(screen.getByText("Wed 21 Oct")).toBeTruthy();
  });

  it("opens closed, so a card of periods is not a wall of days", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([submitted()]);

    show();

    expect(await screen.findByText("Submitted 1.5 h")).toBeTruthy();
    expect(screen.queryByText("Wed 21 Oct")).toBeNull();
  });

  it("says so when a sheet arrived with no days on it", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([submitted({ days: [] })]);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Submitted 1.5 h/ }));

    expect(screen.getByText(/came through with no days on it/)).toBeTruthy();
  });

  it("adds the days up itself, and says so when the app's total is not what they come to", async () => {
    vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
    vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([
      submitted({
        claimedHours: 58,
        days: [
          { day: "Mon", date: "2026-10-19", from: "08:30", to: "10:30", hours: 2, details: "" },
          { day: "Wed", date: "2026-10-21", from: "08:30", to: "12:30", hours: 4, details: "" },
        ],
      }),
    ]);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Submitted 58 h/ }));

    expect(screen.getByText(/The app sent a total of 58 h, which these days do not come to/)).toBeTruthy();
  });
});
