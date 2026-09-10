import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlaceInBlock } from "@/components/PlaceInBlock";
import * as publicationService from "@/services/publication";
import * as roster from "@/services/rosterStore";
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

describe("placing into several sets at once", () => {
  const THREE: database.Catalogue = {
    scopes: [
      CATALOGUE.scopes[0],
      { ...CATALOGUE.scopes[0], id: "scope-cm", code: "CM", name: "Lectures",
        groups: [{ id: "cm-a", label: "A", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} }] },
      { ...CATALOGUE.scopes[0], id: "scope-lang", code: "LANG", name: "Languages", openToAll: true,
        groups: [{ id: "lang-a1", label: "A1", capacity: 0, note: "", program: "", parentGroupId: "", assigned: 0, crns: {} }] },
    ],
  };

  const addRow = () => fireEvent.click(screen.getByRole("button", { name: /Another set/ }));

  it("places one selection into three sets, one request per set", async () => {
    // A student joining mid-term needs a TD, a CM and a language. Three passes through a
    // dialog that forgets everything each time is how one of them gets missed.
    const assign = vi.spyOn(database, "assignStudents").mockResolvedValue({ assigned: 2, skipped: [] });
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(THREE);
    const onPlaced = show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    addRow();
    await pick("Block 2", /CM/);
    await pick("Group 2", /Group A/);
    addRow();
    await pick("Block 3", /LANG/);
    await pick("Group 3", /Group A1/);

    fireEvent.click(screen.getByRole("button", { name: /Place 2/ }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(3));
    expect(assign.mock.calls.map((call) => [call[0], call[2]])).toEqual([
      ["scope-td", "group-2"],
      ["scope-cm", "cm-a"],
      ["scope-lang", "lang-a1"],
    ]);
    await waitFor(() => expect(onPlaced).toHaveBeenCalled());
    expect(onPlaced.mock.calls[0][0].assigned).toBe(6);
  });

  it("will not offer the same set twice", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(THREE);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    addRow();

    fireEvent.click(screen.getByRole("combobox", { name: "Block 2" }));
    expect(await screen.findByRole("option", { name: /CM/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /TD/ })).toBeNull();
  });

  it("says which sets were written when a later one fails", async () => {
    // The write is per set, so a failure halfway leaves the earlier ones already written.
    // Saying nothing would invite a retry that places them twice over.
    vi.spyOn(database, "assignStudents")
      .mockResolvedValueOnce({ assigned: 2, skipped: [] })
      .mockRejectedValueOnce(new Error("The server is having a moment."));
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(THREE);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    await pick("Group", /Group 2/);
    addRow();
    await pick("Block 2", /CM/);
    await pick("Group 2", /Group A/);

    fireEvent.click(screen.getByRole("button", { name: /Place 2/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("TD");
    expect(alert.textContent).toContain("The server is having a moment.");
  });

  it("forgets every set row when the semester changes", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue(THREE);
    show();

    await pick("Semester", "Physics & Maths — Semester 1");
    await pick("Block", /TD/);
    addRow();
    expect(screen.getByRole("combobox", { name: "Block 2" })).toBeTruthy();

    await pick("Semester", "Physics & Maths — Semester 2");

    // One row again, so it loses its number too.
    expect(screen.queryByRole("combobox", { name: "Block 2" })).toBeNull();
    expect((screen.getByRole("combobox", { name: "Block" }) as HTMLElement).textContent).toContain("Which set");
  });
});

describe("proposing the groups instead of naming them", () => {
  const publication = (clashes: publicationService.GroupClash[] = []) =>
    ({
      termId: "term-1",
      portalTermCode: "262710",
      linked: true,
      coverage: {},
      cohorts: [{ cohortId: "cohort-1", cohortName: "Foundation Year", clashes, groups: [], unassigned: {} }],
    }) as unknown as publicationService.Publication;

  beforeEach(() => {
    vi.spyOn(database, "fetchAssignments").mockResolvedValue({});
    vi.spyOn(publicationService, "fetchPublication").mockResolvedValue(publication());
    vi.spyOn(roster, "namesHeld").mockResolvedValue({ A00025735: "Amira Haddad" });
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({});
  });

  const propose = async () => {
    await pick("Groups", "Propose them");
    await pick("Semester", "Physics & Maths — Semester 1");
  };

  it("offers to place a student in every set of a semester from their record", async () => {
    show(["A00025735"]);
    await propose();

    const list = await screen.findByLabelText("Proposed for TD");
    expect(list.textContent).toContain("Amira Haddad");
    // Group 2 is empty and group 1 holds twenty, so balanced sends them to the emptier one.
    expect(list.textContent).toContain("→ Group 2");
  });

  it("writes one request per set, and reports the sets it could not place", async () => {
    const place = vi.spyOn(database, "placeStudents").mockResolvedValue({ assigned: 1, skipped: [] });
    const onPlaced = show(["A00025735"]);
    await propose();
    await screen.findByLabelText("Proposed for TD");

    fireEvent.click(screen.getByRole("button", { name: /Place 1 in 1 set/ }));

    await waitFor(() => expect(place).toHaveBeenCalledWith("scope-td", { "group-2": ["A00025735"] }));
    await waitFor(() => expect(onPlaced).toHaveBeenCalledWith({ assigned: 1, skipped: [], removed: false }));
  });

  it("will not propose groups while the timetable's word on clashes is not in", async () => {
    // Without it the walk could seat somebody in two rooms at once, so it waits exactly as
    // a fill does rather than guessing.
    vi.spyOn(publicationService, "fetchPublication").mockRejectedValue(new Error("no timetable"));
    show(["A00025735"]);
    await propose();

    expect(await screen.findByText(/word on clashes is not in/)).toBeTruthy();
    expect(screen.queryByLabelText("Proposed for TD")).toBeNull();
  });

  it("asks for the semester first here too, because a code means different groups in each", async () => {
    show(["A00025735"]);
    await pick("Groups", "Propose them");

    expect(screen.getByText(/Choose a semester/)).toBeTruthy();
  });

  it("names a set where every group is full rather than failing the whole proposal", async () => {
    vi.spyOn(database, "fetchCatalogue").mockResolvedValue({
      scopes: [
        {
          ...CATALOGUE.scopes[0],
          groups: [{ id: "group-1", label: "1", capacity: 1, note: "", program: "", parentGroupId: "", assigned: 1, crns: {} }],
        },
      ],
    });
    show(["A00025735"]);
    await propose();

    const stuck = await screen.findByLabelText("Sets with nowhere to put them");
    expect(stuck.textContent).toContain("every group is full");
  });
});
