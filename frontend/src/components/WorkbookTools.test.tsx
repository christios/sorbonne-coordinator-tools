import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookTools } from "@/components/WorkbookTools";
import * as roster from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";
import * as workbook from "@/services/workbookExport";
import * as timetable from "@/services/timetableExport";
import type { Card } from "@/services/courseCards";
import type { TimetableTerm } from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "cohort-1", name: "Foundation Year", term: "S1 2026-27", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0, allowedCodes: [],
  memberCount: 0, scopeCount: 1, createdAt: "", updatedAt: "",
};
const TERMS = [{ id: "term-1", name: "Semester 1" } as TimetableTerm];


beforeEach(() => {
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
  // Which half each placement took, for a group written as its halves.
  vi.spyOn(database, "fetchAssignmentMajors").mockResolvedValue({});
});

afterEach(() => vi.restoreAllMocks());

describe("the workbook tools", () => {
  it("offers the two exports, and no way to read a workbook back in", async () => {
    const check = vi.spyOn(database, "previewWorkbook");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkbookTools open cohorts={[COHORT]} terms={TERMS} onClose={() => {}} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Export workbook/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Admissions list/ })).toBeTruthy();
    /*
     * Upload is off. It matched a file's sets by code and created what it could not
     * match, so a set renamed since the file was written came back as a second set with
     * the students moved into it.
     */
    expect(screen.queryByText("Upload workbook")).toBeNull();
    expect(screen.getByText(/Reading a workbook back in is off/)).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });
});

describe("who the exports are about", () => {
  it("leaves out students filed under this cohort only because it holds a shared set", async () => {
    /*
     * An assignment is filed under the cohort that owns the SET, not the cohort of the
     * student. The languages are open to every cohort and live on one cohort's row, so
     * every language student in the department is filed under whichever cohort holds that
     * set — and all three exports read the placements. On the real data Foundation Year's
     * workbook, admissions list and student handout each named seventy-eight people where
     * the cohort has one.
     */
    const exported = vi.fn();
    vi.spyOn(workbook, "downloadWorkbook").mockImplementation(async (input) => void exported(input));
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
      scopes: [
        {
          id: "scope-cm", code: "CM", name: "Lectures", note: "", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [], groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 1, crns: {} }],
        },
      ],
    });
    vi.spyOn(database, "fetchAssignments").mockResolvedValue({
      A001: { "scope-cm": "cm-a" },
      C7: { "scope-lang": "lang-1" },
    });
    vi.spyOn(database, "fetchMemberIds").mockResolvedValue(new Set(["A001"]));
    vi.spyOn(roster, "namesHeld").mockResolvedValue({});
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({});
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkbookTools open cohorts={[COHORT]} terms={TERMS} onClose={() => {}} />
      </QueryClientProvider>,
    );

    const button = await screen.findByRole("button", { name: /Export workbook/ });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(exported).toHaveBeenCalled());
    expect(exported.mock.calls[0][0].students.map((s: { studentId: string }) => s.studentId)).toEqual(["A001"]);
  });
});

describe("the timetable", () => {
  const L1: database.Cohort = { ...COHORT, id: "cohort-2", name: "L1-S1", term: "2026-27" };
  const card = (cohortId: string, termId = "term-1") => ({ key: `${cohortId}-${termId}`, cohortId, termId }) as unknown as Card;
  const CARDS = [card("cohort-1"), card("cohort-1"), card("cohort-2"), card("cohort-2", "term-2")];

  function openTools() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkbookTools open cohorts={[COHORT, L1]} terms={TERMS} cards={CARDS} onClose={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("is the chosen cohort's, for the chosen semester, unless every cohort is asked for", async () => {
    // It was "Timetable request" on every course card, where it read as that course's.
    const built = vi.spyOn(timetable, "requestSheets").mockReturnValue([]);
    const saved = vi.spyOn(timetable, "downloadTimetableWorkbook").mockResolvedValue();
    openTools();

    fireEvent.click(await screen.findByRole("button", { name: "Timetable" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(built.mock.calls[0][0]).toEqual([CARDS[0], CARDS[1]]);
    expect(saved.mock.calls[0][1]).toBe("Time-Tables-26-27-Foundation-Year.xlsx");

    fireEvent.click(screen.getByRole("radio", { name: "All cohorts" }));
    fireEvent.click(screen.getByRole("button", { name: "Timetable" }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    // Every cohort of the semester — and nothing of another semester.
    expect(built.mock.calls[1][0]).toEqual([CARDS[0], CARDS[1], CARDS[2]]);
    expect(saved.mock.calls[1][1]).toBe("Time-Tables-26-27.xlsx");
  });
});

