import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaceInBlock } from "@/components/PlaceInBlock";
import * as database from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "cohort-1",
  name: "Foundation Year",
  term: "S1 2026-27",
  notes: "",
  majors: [], terms: [],
  yearLevel: "", workbookTab: "", firstSemester: 0,
  memberCount: 239,
  scopeCount: 3,
  createdAt: "",
  updatedAt: "",
};

const CATALOGUE: database.Catalogue = {
  scopes: [
    {
      id: "scope-td",
      code: "TD",
      name: "Tutorials",
      note: "",
      kind: "shared", parentScopeId: "", openToAll: false,
      courses: [],
      groups: [
        { id: "group-1", label: "1", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 20, crns: {} },
        { id: "group-2", label: "2", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} },
      ],
    },
  ],
};

function show(studentIds = ["A00025735", "A00026351"]) {
  const onPlaced = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PlaceInBlock
        open
        cohort={COHORT}
        studentIds={studentIds}
        onClose={vi.fn()}
        onPlaced={onPlaced}
      />
    </QueryClientProvider>,
  );
  return onPlaced;
}

const pick = async (label: string, option: string | RegExp) => {
  // Each picker waits on the one before it — the blocks cannot be listed until the
  // semester's catalogue has arrived — so wait for it to open rather than for a fixed time.
  await waitFor(() =>
    expect((screen.getByRole("combobox", { name: label }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
};

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Physics & Maths — Semester 1" } as timetables.TimetableTerm,
    { id: "term-2", name: "Physics & Maths — Semester 2" } as timetables.TimetableTerm,
  ]);
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue(CATALOGUE);
});

afterEach(() => vi.restoreAllMocks());

describe("placing students in a group", () => {
  it("says how many are being placed, and into which cohort", () => {
    show();

    expect(screen.getByText(/Place 2 students in a group/)).toBeTruthy();
    expect(screen.getByText(/Foundation Year/)).toBeTruthy();
  });

  it("asks for the semester before the block, because a block belongs to one", async () => {
    show();

    // "TD" in one semester is not "TD" in the next, so there is nothing to offer yet.
    expect(screen.getByText(/Choose a semester first/)).toBeTruthy();

    await pick("Semester", "Physics & Maths — Semester 1");
    await waitFor(() => expect(database.fetchCatalogue).toHaveBeenCalledWith("cohort-1", "term-1", true));
  });

  it("places the selection in the chosen group", async () => {
    const assign = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    const onPlaced = show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    fireEvent.click(screen.getByRole("button", { name: /Place 2/ }));

    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith("scope-td", ["A00025735", "A00026351"], "group-2");
    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
  });

  it("can take students out of a set, which is not the same as leaving them alone", async () => {
    const assign = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    const onPlaced = show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Take them out of this set/);
    fireEvent.click(screen.getByRole("button", { name: /Take them out/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("scope-td", expect.any(Array), null));
    // The report has to know it was a removal, or the page says "2 students placed".
    expect(onPlaced).toHaveBeenCalledWith(expect.objectContaining({ removed: true }));
  });

  it("forgets the set and group when the semester changes", async () => {
    // The bug this pins: block and group ids belong to one semester. Left standing, a
    // semester switch would place students into the semester they stopped looking at.
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    expect((screen.getByRole("button", { name: /Place 2/ }) as HTMLButtonElement).disabled).toBe(false);

    await pick("Semester", "Physics & Maths — Semester 2");

    expect((screen.getByRole("button", { name: /Place 2/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("combobox", { name: "Block" }).textContent).toContain("Which set");
  });

  it("says so when the cohort has no sets in that semester yet", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
    show();

    await pick("Semester", "Physics & Maths — Semester 1");

    expect(await screen.findByText(/has no sets in this semester yet/)).toBeTruthy();
  });
});

describe("groups nobody should be placed into", () => {
  const section = (retired: boolean): database.Section => ({ ...database.EMPTY_SECTION, crn: "23456", retired });

  function withGroups(groups: database.CatalogueGroup[]) {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
      scopes: [{ ...CATALOGUE.scopes[0], groups }],
    });
  }

  it("does not offer a group whose every section is retired", async () => {
    withGroups([
      { id: "group-1", label: "1", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 20, crns: { "course-a": section(false) } },
      { id: "group-9", label: "9", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 0, crns: { "course-a": section(true) } },
    ]);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    fireEvent.click(screen.getByRole("combobox", { name: "Group" }));

    expect(await screen.findByRole("option", { name: /Group 1/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Group 9/ })).toBeNull();
  });

  it("still offers a group retired for one course of the set and live for another", async () => {
    // A set carries several courses and a group holds one section per course. Retiring
    // the section for one of them says nothing about whether the group still teaches.
    withGroups([
      { id: "group-3", label: "3", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 0, crns: { "course-a": section(true), "course-b": section(false) } },
    ]);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    fireEvent.click(screen.getByRole("combobox", { name: "Group" }));

    expect(await screen.findByRole("option", { name: /Group 3/ })).toBeTruthy();
  });

  it("still offers a group that has no sections yet", async () => {
    // Creating a group writes no sections, so a brand-new one holds none — and `every`
    // over an empty list is true. Without the length guard the fix would hide exactly
    // the groups somebody has just made in order to fill them.
    withGroups([
      { id: "group-new", label: "New", capacity: 24, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} },
    ]);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    fireEvent.click(screen.getByRole("combobox", { name: "Group" }));

    expect(await screen.findByRole("option", { name: /Group New/ })).toBeTruthy();
  });
});

describe("sets open to every cohort", () => {
  const LANG: database.CatalogueScope = {
    id: "scope-lang", code: "LANG", name: "Languages", note: "",
    kind: "shared", parentScopeId: "", openToAll: true, courses: [],
    groups: [{ id: "lang-a1", label: "A1", capacity: 18, note: "", program: "", parentGroupId: "", assigned: 3, crns: {} }],
  };

  it("offers the sets open to every cohort, not only this cohort's own", async () => {
    // Languages live on one cohort's row and are used by all of them, so a dialog that
    // asks only for a cohort's own sets can never place anybody in a language group.
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [...CATALOGUE.scopes, LANG] });
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await waitFor(() => expect(database.fetchCatalogue).toHaveBeenCalledWith("cohort-1", "term-1", true));

    fireEvent.click(screen.getByRole("combobox", { name: "Block" }));
    expect(await screen.findByRole("option", { name: /LANG/ })).toBeTruthy();
  });

  it("asks for the catalogue under its own cache key", async () => {
    // WorkbookTools and AddFromPortal read ["catalogue", cohort, term] WITHOUT the shared
    // sets. Sharing one key would let whichever landed first answer for both, so this
    // dialog would silently lose the languages again depending on what else was open.
    // staleTime makes the seeded entry actually bind — without it the query refetches
    // immediately and the collision this guards against cannot be observed.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["catalogue", "cohort-1", "term-1"], CATALOGUE);

    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [...CATALOGUE.scopes, LANG] });
    render(
      <QueryClientProvider client={client}>
        <PlaceInBlock open cohort={COHORT} studentIds={["A00025735"]} onClose={vi.fn()} onPlaced={vi.fn()} />
      </QueryClientProvider>,
    );

    await pick("Semester", "Physics & Maths — Semester 1");
    fireEvent.click(await screen.findByRole("combobox", { name: "Block" }));

    expect(await screen.findByRole("option", { name: /LANG/ })).toBeTruthy();
  });
});
