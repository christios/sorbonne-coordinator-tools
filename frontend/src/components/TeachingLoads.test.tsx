import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeachingLoads } from "@/components/TeachingLoads";
import * as lists from "@/services/portalLists";
import type { ActiveTeacher } from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import { EMPTY_REQUEST, EMPTY_SECTION, type CohortCatalogue } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";
import type { TimetableTerm } from "@/services/timetables";

/** A lecture of 50 hours in each of three semesters: this year's two, and last year's first. */
const lecture = (termId: string, crn: string) => ({
  id: `cm-${termId}`, code: "CM", name: "CM", note: "", termId, kind: "shared", parentScopeId: "", openToAll: false,
  courses: [{ id: `c-${termId}`, code: "MATH-001", name: "Pre-calculus", component: "CM", request: { ...EMPTY_REQUEST, hours: "50" } }],
  groups: [{ id: `g-${termId}`, label: "1", capacity: 120, note: "", parentGroupId: "", assigned: 0, crns: { [`c-${termId}`]: { ...EMPTY_SECTION, crn, teacherId: "act-1" } } }],
});
const CATALOGUES = [
  { cohort: { id: "fy", name: "Foundation Year", term: "2026-27" }, scopes: [lecture("s1", "22151"), lecture("s2", "24100"), lecture("old", "11111")] },
] as unknown as CohortCatalogue[];

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TeachingLoads />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue(CATALOGUES);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "old", name: "Semester 1 2025-26" },
    { id: "s1", name: "Semester 1 2026-27" },
    { id: "s2", name: "Semester 2 2026-27" },
  ] as TimetableTerm[]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([{ id: "act-1", fullName: "Bilal Maaz", type: "Full Time", source: "portal" } as ActiveTeacher]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ old: "252610", s1: "262710", s2: "262720" });
  vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({ s1: "S1", s2: "S2" });
  // The semester chosen in the header.
  window.localStorage.setItem("scen-remembered:schema-term", "s2");
});
afterEach(() => vi.restoreAllMocks());

describe("Teaching loads", () => {
  it("covers both semesters of the chosen one's academic year, and no other year", async () => {
    show();

    expect(await screen.findByText("The academic year 2026-2027, as planned")).toBeTruthy();
    // 50 hours in each of this year's semesters; last year's lecture is not counted.
    const split = (await screen.findByText(/Who teaches the department/)).closest("section") as HTMLElement;
    expect(split.textContent).toContain("S1 · Semester 1");
    expect(split.textContent).toContain("S2 · Semester 2");
    expect(screen.getByText("Total").closest("tr")?.textContent).toContain("100");
    expect(screen.getByText("2 of 2 sections")).toBeTruthy();
  });
});
