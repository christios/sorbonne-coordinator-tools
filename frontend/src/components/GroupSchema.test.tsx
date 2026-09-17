import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupSchema } from "@/components/GroupSchema";
import * as portal from "@/services/portalLists";
import { COHORT, SCHEMA_TERM } from "@/services/remembered";
import * as roster from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";
import type { TimetableTerm } from "@/services/timetables";

const cohort = (over: Partial<database.Cohort> = {}): database.Cohort =>
  ({
    id: "cohort-1", name: "L1-S1", term: "2026-27", notes: "", majors: ["MATH", "PHYS"], terms: [],
    yearLevel: "", workbookTab: "", firstSemester: 0, allowedCodes: [], memberCount: 0, scopeCount: 1,
    createdAt: "", updatedAt: "", ...over,
  }) as database.Cohort;

/** One set, one group, and whatever sub-rows the test is about. */
const catalogue = (programs: string[]) => ({
  scopes: [
    {
      id: "s-opt", code: "OPT-TD", name: "Optics", note: "", termId: "term-1", kind: "shared",
      parentScopeId: "", openToAll: false, cohortId: "cohort-1",
      courses: [{ id: "c1", code: "PHYS-118", name: "Geometric Optics", component: "TD", request: database.EMPTY_REQUEST }],
      groups: [
        {
          id: "g1", label: "1", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {},
          majors: programs.map((program, at) => ({ id: `m${at}`, program, seats: 0, assigned: 0 })),
        },
      ],
    },
  ],
}) as unknown as { scopes: database.CatalogueScope[] };

/** Two students, on the two programmes the department actually reads. */
const HELD = { A001: "MATH - Mathematics", A002: "PHYS - Physics" };

function shown(cohorts: database.Cohort[] = [cohort()]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GroupSchema cohorts={cohorts} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.setItem(`scen-remembered:${COHORT}`, "cohort-1");
  window.localStorage.setItem(`scen-remembered:${SCHEMA_TERM}`, "term-1");
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([{ id: "term-1", name: "Semester 1" } as TimetableTerm]);
  vi.spyOn(portal, "fetchActiveCourses").mockResolvedValue([]);
  vi.spyOn(roster, "fieldHeld").mockResolvedValue(HELD);
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("a sub-row that matches nobody", () => {
  it("says so, and names the group and the programme", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["CHEM - Chemistry"]));

    shown();

    expect(await screen.findByText("1 set has a sub-row no student is on")).toBeTruthy();
  });

  it("stays quiet while the sub-row is one somebody reads", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["PHYS - Physics"]));

    shown();

    expect(await screen.findByText(/1 set · 1 group/)).toBeTruthy();
    expect(screen.queryByText(/sub-row no student is on/)).toBeNull();
  });

  it("stays quiet after the registrar rewords the description", async () => {
    // The reason the code decides: "PHYS - Physics" and "PHYS - Physics (BSc)" are one
    // programme, and a sub-row written before the rewording must go on matching.
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["PHYS - Physics (BSc)"]));

    shown();

    expect(await screen.findByText(/1 set · 1 group/)).toBeTruthy();
    expect(screen.queryByText(/sub-row no student is on/)).toBeNull();
  });

  it("judges nothing at all when this browser has pulled nobody", async () => {
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({});
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["CHEM - Chemistry"]));

    shown();

    expect(await screen.findByText(/1 set · 1 group/)).toBeTruthy();
    expect(screen.queryByText(/sub-row no student is on/)).toBeNull();
  });
});

describe("a cohort expecting a major nobody is on", () => {
  it("names the cohort and says the rule is catching nobody", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["PHYS - Physics"]));

    shown([cohort({ majors: ["MATH", "ECMG"] })]);

    expect(await screen.findByText("L1-S1 expects a major no student is on")).toBeTruthy();
  });

  it("stays quiet for a cohort whose codes are written the registrar's long way", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(catalogue(["PHYS - Physics"]));

    shown([cohort({ majors: ["MATH - Mathematics", "PHYS - Physics"] })]);

    expect(await screen.findByText(/1 set · 1 group/)).toBeTruthy();
    expect(screen.queryByText(/expects a major no student is on/)).toBeNull();
  });
});
