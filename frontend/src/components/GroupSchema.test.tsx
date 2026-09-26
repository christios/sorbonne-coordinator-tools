import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

describe("linking a set to another", () => {
  const td = {
    id: "s-td", code: "TD", name: "", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
    cohortId: "cohort-1", courses: [],
    groups: ["1", "2", "3"].map((label) => ({
      id: `td-${label}`, label, capacity: 0, note: "", parentGroupId: "", assigned: 0, crns: {},
    })),
  };
  const philosophy = (linked: boolean) => ({
    id: "s-phil", code: "PHIL-TD", name: "", note: "", termId: "term-1",
    kind: linked ? "nested" : "shared", parentScopeId: linked ? "s-td" : "", openToAll: false, cohortId: "cohort-1",
    courses: [],
    groups: [{ id: "phil-2", label: "2", capacity: 0, note: "", parentGroupId: "", parentGroupIds: [], assigned: 0, crns: {} }],
  });
  const withSets = (linked: boolean) =>
    ({ scopes: [philosophy(linked), td] }) as unknown as { scopes: database.CatalogueScope[] };

  it("is one choice — the set it is linked to — where there used to be a kind and an 'inside'", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(withSets(false));
    const update = vi.spyOn(database, "updateScope").mockResolvedValue(undefined as never);
    shown();

    fireEvent.click(await screen.findByRole("combobox", { name: "The set this one is linked to" }));
    fireEvent.click(await screen.findByRole("option", { name: "TD" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("s-phil", expect.objectContaining({ kind: "nested", parentScopeId: "s-td" })),
    );
    expect(screen.queryByRole("combobox", { name: "Kind of set" })).toBeNull();
  });

  it("lets a group go with several groups of that set", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(withSets(true));
    const update = vi.spyOn(database, "updateGroup").mockResolvedValue(undefined);
    shown();

    expect(await screen.findByText("nobody can be placed here")).toBeTruthy();
    fireEvent.click(await screen.findByRole("combobox", { name: "The groups 2 goes with" }));
    fireEvent.click(await screen.findByRole("option", { name: "2" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("phil-2", expect.objectContaining({ parentGroupIds: ["td-2"] })),
    );
  });

  it("says which major a group takes first", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(withSets(true));
    const update = vi.spyOn(database, "updateGroup").mockResolvedValue(undefined);
    shown();

    // On TD, whose groups are nobody's in particular until one is marked.
    fireEvent.click(await screen.findByRole("button", { name: /^TD\b/ }));
    fireEvent.click(await screen.findByRole("combobox", { name: "The major 3 takes first" }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "PHYS - Physics" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("td-3", expect.objectContaining({ firstFor: "PHYS - Physics" })));
  });
});
