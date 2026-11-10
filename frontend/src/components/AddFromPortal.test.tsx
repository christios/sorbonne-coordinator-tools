import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddFromPortal } from "@/components/AddFromPortal";
import * as lists from "@/services/portalLists";
import * as database from "@/services/studentDatabase";
import type { Cohort } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";
import type { TimetableTerm } from "@/services/timetables";

const cohort = (id: string, name: string): Cohort => ({
  id,
  name,
  term: "2026-27",
  notes: "",
  majors: [],
  terms: [],
  yearLevel: "",
  workbookTab: "",
  firstSemester: 0,
  allowedCodes: [],
  memberCount: 0,
  scopeCount: 0,
  createdAt: "",
  updatedAt: "",
});

const TERMS = [
  { id: "plan:262710", name: "Semester 1" } as TimetableTerm,
  { id: "plan:262720", name: "Semester 2" } as TimetableTerm,
];

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue(TERMS);
  vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({ crns: {} } as Awaited<ReturnType<typeof lists.fetchTermCrns>>);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
});

afterEach(() => vi.restoreAllMocks());

describe("a course card from the portal", () => {
  it("is made for the cohort and semester the page has on screen", async () => {
    // It opened on the first cohort and Semester 1: built quickly while looking at
    // Semester 2, the course, its groups and its CRNs landed in Semester 1.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AddFromPortal
          open
          cohorts={[cohort("fys", "FYS"), cohort("l1", "L1")]}
          terms={TERMS}
          activeCourses={[]}
          cohortShown="l1"
          semesterShown="plan:262720"
          onClose={vi.fn()}
          onAdded={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(database.fetchCatalogue).toHaveBeenCalledWith("l1", "plan:262720", true));
    expect(lists.fetchTermCrns).toHaveBeenCalledWith("plan:262720");
    expect(database.fetchCatalogue).not.toHaveBeenCalledWith("fys", expect.anything(), true);
  });
});
