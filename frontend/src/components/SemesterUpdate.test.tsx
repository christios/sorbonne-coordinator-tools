import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SemesterUpdate } from "@/components/SemesterUpdate";
import type { TimetablePreview } from "@/services/timetableDiff";
import * as timetables from "@/services/timetables";

const TERM: timetables.TimetableTerm = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "physics-maths-semester-1",
  timezone: "Asia/Dubai",
  isPublished: true,
  courseCount: 43,
  sessionCount: 975,
  studentCount: 180,
  timetableFilename: "PHYS-MATHS-FY-SEM.1.xls",
  enrolmentFilename: "students.xlsx",
  updatedAt: "2026-08-21T18:00:00Z",
};

const AFTER = { date: "2026-08-31", start: "08:30", end: "10:00", room: "9.001", isExam: false };

const PREVIEW: TimetablePreview = {
  term: { id: "term-1", name: TERM.name },
  baseUpdatedAt: TERM.updatedAt,
  filename: "revised.xls",
  summary: {
    unchanged: 970,
    changed: 1,
    added: 0,
    removed: 0,
    courseChanges: 0,
    coursesAdded: 0,
    coursesRemoved: 1,
    uncertainMatches: 0,
    studentsLosingCourses: 34,
  },
  courses: [
    {
      crn: "22151",
      code: "MATH-001-CM-GR.A",
      title: "Pre-Calculus",
      groupLabel: "Gr. A",
      kind: "Lecture",
      status: "present",
      courseChanges: [],
      before: null,
      after: null,
      enrolledStudents: 60,
      sessions: [
        {
          status: "changed",
          sessionId: "s1",
          before: { ...AFTER, room: "7.113" },
          after: AFTER,
          changes: ["room 7.113 → 9.001"],
          matchRule: "same_day_and_start",
          matchedOn: "same day, same start time",
          isCertain: true,
        },
      ],
    },
    {
      crn: "23302",
      code: "SCEN-101-F1",
      title: "French Language",
      groupLabel: "Group F1",
      kind: "",
      status: "removed",
      courseChanges: [],
      before: null,
      after: null,
      enrolledStudents: 34,
      sessions: [
        {
          status: "removed",
          sessionId: "s9",
          before: { date: "2026-09-08", start: "16:30", end: "18:00", room: "5.113", isExam: false },
          after: null,
          changes: [],
          matchRule: "",
          matchedOn: "",
          isCertain: true,
        },
      ],
    },
  ],
};

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SemesterUpdate term={TERM} onBack={() => {}} />
    </QueryClientProvider>,
  );
}

/** Pick an export and ask what it would change, the way a coordinator does. */
async function review() {
  const file = new File(["x"], "revised.xls", { type: "application/vnd.ms-excel" });
  fireEvent.change(screen.getByLabelText(/New timetable export/), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: /See what would change/ }));
  await screen.findByText(/revised.xls against/);
}

beforeEach(() => {
  vi.spyOn(timetables, "previewTimetableUpdate").mockResolvedValue(PREVIEW);
  vi.spyOn(timetables, "applyTimetableUpdate").mockResolvedValue({ ...TERM, sessionCount: 974 });
});

afterEach(() => vi.restoreAllMocks());

it("asks for a file before it will say anything", () => {
  renderScreen();
  expect((screen.getByRole("button", { name: /See what would change/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows what moved, in the coordinator's words", async () => {
  renderScreen();
  await review();

  expect(screen.getByText("room 7.113 → 9.001")).toBeTruthy();
  expect(screen.getByText(/CRN 22151/)).toBeTruthy();
});

it("approves nothing until it is ticked", async () => {
  renderScreen();
  await review();

  expect((screen.getByRole("button", { name: /Apply 0 change/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/of 2 change/).textContent).toContain("0");
});

it("sends only the ticked row", async () => {
  renderScreen();
  await review();

  fireEvent.click(screen.getByRole("checkbox", { name: /Approve Changed on/ }));
  fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

  await waitFor(() => expect(timetables.applyTimetableUpdate).toHaveBeenCalled());
  const sent = vi.mocked(timetables.applyTimetableUpdate).mock.calls[0][0];
  expect(sent.operations).toEqual([{ op: "updateSession", sessionId: "s1", ...AFTER }]);
  expect(sent.baseUpdatedAt).toBe(TERM.updatedAt);
});

it("warns before a dropped course takes its students with it", async () => {
  renderScreen();
  await review();

  expect(screen.getByText(/34 student\(s\) would lose the course/)).toBeTruthy();

  fireEvent.click(screen.getByRole("checkbox", { name: /Approve the course change for CRN 23302/ }));
  expect(screen.getByText(/34 student\(s\) would be unenrolled/)).toBeTruthy();
});

it("makes a dropped course one decision rather than one per session", async () => {
  renderScreen();
  await review();

  // The French session is listed so it can be seen, but it carries no tick of its own.
  expect(screen.queryByRole("checkbox", { name: /Approve Cancelled on/ })).toBeNull();

  fireEvent.click(screen.getByRole("checkbox", { name: /Approve the course change for CRN 23302/ }));
  fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

  await waitFor(() => expect(timetables.applyTimetableUpdate).toHaveBeenCalled());
  expect(vi.mocked(timetables.applyTimetableUpdate).mock.calls[0][0].operations).toEqual([
    { op: "removeCourse", crn: "23302" },
  ]);
});

it("reports what the platform says when the review has gone stale", async () => {
  vi.mocked(timetables.applyTimetableUpdate).mockRejectedValue(
    new Error("This semester was changed by somebody else since you uploaded the file."),
  );
  renderScreen();
  await review();

  fireEvent.click(screen.getByRole("checkbox", { name: /Approve Changed on/ }));
  fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

  expect((await screen.findByRole("alert")).textContent).toContain("changed by somebody else");
});

it("confirms what landed once the changes are applied", async () => {
  renderScreen();
  await review();

  fireEvent.click(screen.getByRole("checkbox", { name: /Approve Changed on/ }));
  fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

  expect(await screen.findByText(/Physics & Maths — Semester 1 updated/)).toBeTruthy();
  expect(screen.getByText(/974 sessions/)).toBeTruthy();
});
