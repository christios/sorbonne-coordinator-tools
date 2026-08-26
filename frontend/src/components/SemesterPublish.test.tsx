import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemesterPublish } from "@/components/SemesterPublish";
import type { Publication, PublicationPreview } from "@/services/publication";
import * as publication from "@/services/publication";
import type { TimetableTerm } from "@/services/timetables";

const TERM: TimetableTerm = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "physics-maths-semester-1",
  timezone: "Asia/Dubai",
  isPublished: true,
  courseCount: 43,
  sessionCount: 975,
  studentCount: 180,
  timetableFilename: "PHYS-MATHS.xls",
  enrolmentFilename: "students.xlsx",
  updatedAt: "2026-08-25T00:00:00Z",
};

const READY: Publication = {
  cohorts: [
    {
      cohortId: "c1",
      cohort: "Foundation Year",
      students: 24,
      studentsResolved: 24,
      unassigned: {},
      warnings: [],
      isReady: true,
    },
  ],
  validation: {},
  unmatchedCrns: 0,
  sections: 43,
  resolved: { students: 24, enrolments: 168 },
  isReady: true,
};

function previewOf(summary: Partial<PublicationPreview["summary"]>): PublicationPreview {
  return {
    term: { id: TERM.id, name: TERM.name, updatedAt: TERM.updatedAt },
    baseUpdatedAt: TERM.updatedAt,
    summary: {
      studentsBefore: 24,
      studentsAfter: 24,
      enrolmentsAdded: 0,
      enrolmentsRemoved: 0,
      enrolmentsUnchanged: 168,
      studentsGaining: 0,
      studentsLosing: 0,
      studentsLosingEverything: 0,
      unknownCrns: 0,
      ...summary,
    },
    gaining: [],
    losing: [],
    unknownCrns: [],
  };
}

function renderScreen() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SemesterPublish term={TERM} onBack={() => {}} />
    </QueryClientProvider>,
  );
}

async function look() {
  fireEvent.click(await screen.findByRole("button", { name: /See what would change/ }));
}

beforeEach(() => {
  vi.spyOn(publication, "fetchPublication").mockResolvedValue(READY);
  vi.spyOn(publication, "publishEnrolments").mockResolvedValue({ studentCount: 24 });
});

afterEach(() => vi.restoreAllMocks());

describe("before anything is sent", () => {
  it("says who would be enrolled, and that everything is in order", async () => {
    renderScreen();
    expect(await screen.findByText(/24 student\(s\) would be enrolled in 168/)).toBeTruthy();
    expect(screen.getByText(/Everyone has a group and every CRN is in the timetable/)).toBeTruthy();
  });

  it("warns that publishing replaces rather than adds", async () => {
    renderScreen();
    await screen.findByRole("button", { name: /See what would change/ });
    expect(screen.getByText(/loses their timetable/)).toBeTruthy();
  });

  it("names a CRN that is not in the timetable as blocking", async () => {
    // The real case: TD group 7 pointing at sections the export no longer has.
    vi.mocked(publication.fetchPublication).mockResolvedValue({
      ...READY,
      unmatchedCrns: 3,
      isReady: false,
    });
    renderScreen();

    expect(await screen.findByText(/3 CRNs not in the timetable/)).toBeTruthy();
    expect(screen.getByText(/fix the above before sending it to students/)).toBeTruthy();
  });

  it("names the cohort whose students have no group", async () => {
    vi.mocked(publication.fetchPublication).mockResolvedValue({
      ...READY,
      isReady: false,
      cohorts: [
        {
          ...READY.cohorts[0],
          cohort: "L1",
          studentsResolved: 20,
          isReady: false,
          unassigned: { TD: ["A1", "A2", "A3", "A4"] },
          warnings: ["4 with no Tutorials group"],
        },
      ],
    });
    renderScreen();

    expect(await screen.findByText("L1: 4 students with no group")).toBeTruthy();
  });
});

describe("looking at what would change", () => {
  it("will not publish when nothing would move", async () => {
    vi.spyOn(publication, "previewPublication").mockResolvedValue(previewOf({}));
    renderScreen();
    await look();

    const button = await screen.findByRole("button", { name: /Nothing to publish/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends the version it was looking at, so a stale review is refused", async () => {
    vi.spyOn(publication, "previewPublication").mockResolvedValue(previewOf({ enrolmentsAdded: 12 }));
    renderScreen();
    await look();

    fireEvent.click(await screen.findByRole("button", { name: /Publish to students/ }));

    await waitFor(() => expect(publication.publishEnrolments).toHaveBeenCalled());
    expect(publication.publishEnrolments).toHaveBeenCalledWith(TERM.id, TERM.updatedAt);
  });

  it("makes a publish that empties timetables look like one", async () => {
    // 165 of 180 students losing everything is what a forgotten cohort looks like.
    vi.spyOn(publication, "previewPublication").mockResolvedValue(
      previewOf({
        studentsBefore: 180,
        studentsAfter: 24,
        enrolmentsAdded: 114,
        enrolmentsRemoved: 1334,
        studentsLosing: 180,
        studentsLosingEverything: 165,
      }),
    );
    renderScreen();
    await look();

    expect(await screen.findByText(/165 student\(s\) would be left with no timetable at all\./)).toBeTruthy();
    // Still possible — removing people is sometimes right — but it no longer reads as routine.
    expect(screen.getByRole("button", { name: /Publish anyway/ })).toBeTruthy();
  });

  it("reports what the platform says when the review has gone stale", async () => {
    vi.spyOn(publication, "previewPublication").mockResolvedValue(previewOf({ enrolmentsAdded: 12 }));
    vi.mocked(publication.publishEnrolments).mockRejectedValue(
      new Error("This semester was changed by somebody else since you checked."),
    );
    renderScreen();
    await look();

    fireEvent.click(await screen.findByRole("button", { name: /Publish to students/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("changed by somebody else");
  });

  it("confirms who can look themselves up once it is sent", async () => {
    vi.spyOn(publication, "previewPublication").mockResolvedValue(previewOf({ enrolmentsAdded: 12 }));
    renderScreen();
    await look();

    fireEvent.click(await screen.findByRole("button", { name: /Publish to students/ }));

    expect(await screen.findByText(/24 student\(s\) can now look up their timetable/)).toBeTruthy();
  });
});
