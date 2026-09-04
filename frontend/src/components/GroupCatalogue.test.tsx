import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupCatalogue } from "@/components/GroupCatalogue";
import * as publication from "@/services/publication";
import * as roster from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";
import type { WorkbookPreview } from "@/services/workbookReview";

const COHORT: database.Cohort = {
  id: "cohort-1",
  name: "Foundation Year",
  term: "S1 2026-27",
  notes: "",
  program: "",
  yearLevel: "",
  memberCount: 0,
  scopeCount: 1,
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
      courses: [
        { id: "course-1", code: "MATH001", name: "Pre-calculus 1", component: "TD" },
        { id: "course-2", code: "MATH009", name: "Linear Algebra", component: "TD" },
      ],
      groups: [
        {
          id: "group-5",
          label: "5",
          capacity: 0,
          note: "", program: "",
          assigned: 0,
          crns: {
            "course-1": { crn: "23563", teacher: "Jad Tarsissi" },
            "course-2": { crn: "23566", teacher: "Jad Tarsissi" },
          },
        },
      ],
    },
  ],
};

const PREVIEW: WorkbookPreview = {
  filename: "FYS-Groups-26-27-S1.xlsx",
  sheet: "Reference",
  style: "cohort",
  reference: {
    blocks: [
      {
        scopeCode: "TD",
        scopeName: "Tutorials",
        isNew: false,
        unchanged: 5,
        rows: [
          {
            kind: "cell",
            op: "setCell",
            key: "cell|TD|5|MATH001",
            status: "changed",
            label: "Group 5 · MATH001",
            detail: "CRN 23563 → 29999",
            scopeCode: "TD",
            groupLabel: "5",
            courseCode: "MATH001",
            before: "23563",
            after: "29999",
          },
        ],
      },
    ],
    summary: {
      blocksNew: 0,
      groupsAdded: 0,
      coursesAdded: 0,
      crnsChanged: 1,
      crnsAdded: 0,
      unchanged: 5,
      decisions: 1,
    },
  },
  placements: {
    rows: [
      {
        key: "place|A00021503|TD",
        op: "place",
        status: "placed",
        studentId: "A00021503",
        scopeCode: "TD",
        before: "",
        after: "5",
        groupId: "group-5",
        detail: "TD 5",
      },
    ],
    unchanged: 23,
    unknownGroups: [],
    unknownStudents: [],
    summary: { placed: 1, moved: 0, unchanged: 23, unknownGroups: 0, unknownStudents: 0, decisions: 1 },
    note: "",
  },
};

function upload_workbook() {
  const input = screen.getByText(/^Upload workbook$/).closest("label")?.querySelector("input");
  fireEvent.change(input as HTMLInputElement, {
    target: { files: [new File(["x"], "FYS-Groups-26-27-S1.xlsx")] },
  });
}

function renderCatalogue(termId = "") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GroupCatalogue cohort={COHORT} termId={termId} />
    </QueryClientProvider>,
  );
}

const cell = () => screen.getByLabelText("CRN for TD group 5, MATH001") as HTMLInputElement;

beforeEach(() => {
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue(CATALOGUE);
});

afterEach(() => vi.restoreAllMocks());

describe("GroupCatalogue", () => {
  it("shows a block as a matrix of groups and courses", async () => {
    renderCatalogue();

    expect(await screen.findByText("TD")).toBeTruthy();
    expect(screen.getByText("MATH001")).toBeTruthy();
    expect(cell().value).toBe("23563");
    expect(screen.getAllByText("Jad Tarsissi").length).toBe(2);
  });

  it("saves a CRN when it is changed", async () => {
    const save = vi.spyOn(database, "setGroupCrn").mockResolvedValue(undefined);
    renderCatalogue();
    await screen.findByText("TD");

    fireEvent.change(cell(), { target: { value: "29999" } });
    fireEvent.blur(cell());

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]).toEqual(["group-5", "course-1", { crn: "29999" }]);
  });

  it("saves nothing when a cell is left without being edited", async () => {
    // The bug this pins: an uncontrolled input kept whatever the DOM held, so a stray
    // focus and blur could write stale text back — or clear the CRN entirely.
    const save = vi.spyOn(database, "setGroupCrn").mockResolvedValue(undefined);
    renderCatalogue();
    await screen.findByText("TD");

    cell().focus();
    fireEvent.blur(cell());

    expect(save).not.toHaveBeenCalled();
    expect(cell().value).toBe("23563");
  });

  it("clears a cell only when a coordinator empties it", async () => {
    const save = vi.spyOn(database, "setGroupCrn").mockResolvedValue(undefined);
    renderCatalogue();
    await screen.findByText("TD");

    fireEvent.change(cell(), { target: { value: "  " } });
    fireEvent.blur(cell());

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][2]).toEqual({ crn: "" });
  });

  it("takes the stored value back when the catalogue changes underneath", async () => {
    // Editing one cell refetches the catalogue. If the registrar moved another CRN in the
    // meantime, that field has to follow the store rather than keep what the DOM held.
    const moved: database.Catalogue = {
      scopes: [
        {
          ...CATALOGUE.scopes[0],
          groups: [
            {
              ...CATALOGUE.scopes[0].groups[0],
              crns: {
                "course-1": { crn: "24000", teacher: "Jad Tarsissi" },
                "course-2": { crn: "23566", teacher: "Jad Tarsissi" },
              },
            },
          ],
        },
      ],
    };
    vi.spyOn(database, "fetchCatalogue")
      .mockResolvedValueOnce(CATALOGUE)
      .mockResolvedValue(moved);
    vi.spyOn(database, "setGroupCrn").mockResolvedValue(undefined);
    renderCatalogue();
    await screen.findByText("TD");

    const neighbour = screen.getByLabelText("CRN for TD group 5, MATH009");
    fireEvent.change(neighbour, { target: { value: "23567" } });
    fireEvent.blur(neighbour);

    await waitFor(() => expect(cell().value).toBe("24000"));
  });

  it("sends the semester with the workbook, or the blocks land beside the ones already there", async () => {
    const upload = vi.spyOn(database, "previewWorkbook").mockResolvedValue(PREVIEW);
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    upload_workbook();

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload).toHaveBeenCalledWith("cohort-1", "term-1", expect.any(File));
  });

  it("writes nothing on upload — it shows what the workbook would change", async () => {
    // Both halves used to land on drop, which silently rewrote corrected CRNs.
    const apply = vi.spyOn(database, "applyWorkbook");
    vi.spyOn(database, "previewWorkbook").mockResolvedValue(PREVIEW);
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    upload_workbook();

    expect(await screen.findByText(/against this semester/)).toBeTruthy();
    expect(screen.getByText(/CRN 23563 → 29999/)).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies only the rows that were ticked", async () => {
    vi.spyOn(database, "previewWorkbook").mockResolvedValue(PREVIEW);
    const apply = vi.spyOn(database, "applyWorkbook").mockResolvedValue({
      courses: 0,
      groups: 0,
      cells: 1,
      placements: 0,
    });
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    upload_workbook();
    fireEvent.click(await screen.findByLabelText(/Approve Group 5 · MATH001/));
    fireEvent.click(screen.getByRole("button", { name: /Apply 1 change/ }));

    await waitFor(() => expect(apply).toHaveBeenCalled());
    const [, term, operations] = apply.mock.calls[0];
    expect(term).toBe("term-1");
    // The placement row was left unticked, so it is not among what was sent.
    expect(operations.map((operation) => operation.op)).toEqual(["setCell"]);
  });

  it("says what landed, and that the rest is as it was", async () => {
    vi.spyOn(database, "previewWorkbook").mockResolvedValue(PREVIEW);
    vi.spyOn(database, "applyWorkbook").mockResolvedValue({
      courses: 0,
      groups: 2,
      cells: 6,
      placements: 24,
    });
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    upload_workbook();
    fireEvent.click(await screen.findByRole("button", { name: /Tick everything/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply 2 change/ }));

    expect(await screen.findByText(/2 approved change\(s\) applied/)).toBeTruthy();
    expect(screen.getByText(/24 student placement\(s\)/)).toBeTruthy();
  });

  it("is one upload, because the workbook is one document", async () => {
    // The Reference sheet and the student tabs were two buttons and are one.
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    expect(screen.getByText(/^Upload workbook$/)).toBeTruthy();
    expect(screen.queryByText(/Upload student groups/)).toBeNull();
  });

  it("says what the semester holds, rather than explaining itself in paragraphs", async () => {
    // Two headings and two blurbs stood above two buttons. What the numbers say cannot be
    // guessed from the page; what the blurbs said could be read once and never again.
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    expect(screen.getByText("1 block · 1 group · 2 courses · every CRN filled")).toBeTruthy();
    expect(screen.queryByText(/Fill this from a workbook/)).toBeNull();
    expect(screen.queryByText(/Take it back out/)).toBeNull();
  });

  it("keeps the explanation one press away, on the button it explains", async () => {
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    expect(screen.queryByText(/its Reference sheet is the blocks/i)).toBeNull();
    fireEvent.click(screen.getByLabelText("What an uploaded workbook must contain"));

    const hint = await screen.findByRole("dialog", { name: "Upload workbook" });
    expect(within(hint).getByText(/Nothing is written on upload/)).toBeTruthy();
  });

  it("cannot be used until a semester is chosen, because blocks belong to one", async () => {
    renderCatalogue();
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    const label = screen.getByText(/^Upload workbook$/).closest("label");
    const input = label?.querySelector("input");
    expect((input as HTMLInputElement).disabled).toBe(true);
    // Why it cannot be used, without having to open anything.
    expect(label?.getAttribute("title")).toMatch(/Choose a semester first/);
  });
});

describe("checking the CRNs against the timetable", () => {
  const verdicts = (validation: Record<string, publication.CrnVerdict>) =>
    vi.spyOn(publication, "fetchPublication").mockResolvedValue({
      cohorts: [],
      validation,
      unmatchedCrns: Object.values(validation).filter((v) => v.status !== "matched").length,
      sections: 43,
      resolved: { students: 0, enrolments: 0 },
      isReady: true,
    });

  it("ticks a CRN the timetable holds", async () => {
    verdicts({
      "group-5|MATH001": {
        status: "matched",
        detail: "",
        section: { crn: "23563", code: "MATH-001-TD-Gr.5", kind: "Tutorial", groupLabel: "Gr. 5" },
      },
    });
    renderCatalogue("term-1");

    expect(await screen.findByLabelText("In the timetable")).toBeTruthy();
  });

  it("marks a CRN the timetable has never held, and says why", async () => {
    // The real case: a group carrying CRNs the export no longer contains.
    verdicts({
      "group-5|MATH001": { status: "unknown", detail: "CRN 23563 is not in this semester's timetable." },
    });
    renderCatalogue("term-1");

    expect(await screen.findByLabelText(/not in this semester's timetable/)).toBeTruthy();
  });

  it("marks a CRN that is real but belongs to another course", async () => {
    verdicts({
      "group-5|MATH001": {
        status: "mismatched",
        detail: "CRN 23563 is MATH-011 in the timetable, not MATH001.",
      },
    });
    renderCatalogue("term-1");

    expect(await screen.findByLabelText(/is MATH-011 in the timetable/)).toBeTruthy();
  });

  it("says nothing at all when there is no semester to check against", async () => {
    const asked = verdicts({});
    renderCatalogue();

    await screen.findByLabelText(/CRN for TD group 5, MATH001/);
    expect(asked).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("In the timetable")).toBeNull();
  });
});

describe("adding a block", () => {
  it("gives it the semester the page is showing, or it would vanish on save", async () => {
    // Blocks are per semester. One added without one is filtered straight back out, so the
    // coordinator types a code, presses Add, and watches nothing happen.
    const create = vi.spyOn(database, "addScope").mockResolvedValue({ id: "scope-new" });
    renderCatalogue("term-1");
    await screen.findByLabelText(/CRN for TD group 5, MATH001/);

    const form = screen.getByPlaceholderText(/TD, CM/).closest("form") as HTMLFormElement;
    fireEvent.change(screen.getByPlaceholderText(/TD, CM/), { target: { value: "LANG" } });
    fireEvent.click(within(form).getByRole("button", { name: /Add/ }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith("cohort-1", { code: "LANG", termId: "term-1" });
  });
});

describe("what a group prefers", () => {
  it("is chosen from the programmes this browser has seen, and saved on the group", async () => {
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({ A1: "Physics", A2: "Maths", A3: "Physics" });
    const update = vi.spyOn(database, "updateGroup").mockResolvedValue();
    renderCatalogue("term-1");

    const control = (await screen.findByLabelText("Programme TD group 5 prefers")) as HTMLSelectElement;
    await waitFor(() => expect(within(control).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Any programme",
      "Prefers Maths",
      "Prefers Physics",
    ]));

    fireEvent.change(control, { target: { value: "Physics" } });
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("group-5", { label: "5", capacity: 0, note: "", program: "Physics" }),
    );
  });
});

describe("groups that meet at the same hour", () => {
  const withClashes = (clashes: publication.GroupClash[]) =>
    vi.spyOn(publication, "fetchPublication").mockResolvedValue({
      cohorts: [
        {
          cohortId: "cohort-1",
          cohort: "Foundation Year",
          students: 24,
          studentsResolved: 24,
          unassigned: {},
          warnings: [],
          clashes,
          isReady: true,
        },
      ],
      validation: {},
      unmatchedCrns: 0,
      sections: 43,
      resolved: { students: 24, enrolments: 140 },
      isReady: true,
    });

  it("names the pair, the hour, and who sits in both", async () => {
    withClashes([
      {
        groups: [
          { id: "group-a", scopeId: "scope-cm", scopeCode: "CM", label: "A" },
          { id: "group-5", scopeId: "scope-td", scopeCode: "TD", label: "5" },
        ],
        windows: [{ weekday: "Mon", start: "08:30", end: "10:00", crns: ["22151", "23563"], dates: 14 }],
        students: ["A1", "A2"],
      },
    ]);
    const onShow = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GroupCatalogue cohort={COHORT} termId="term-1" onShowStudents={onShow} />
      </QueryClientProvider>,
    );

    const line = (await screen.findByText("CM A × TD 5")).closest("li");
    expect(line?.textContent).toContain("Mon 08:30–10:00 (22151 / 23563) ×14");
    expect(line?.textContent).toContain("2 students in both");

    fireEvent.click(within(line as HTMLElement).getByText("Show them in Students"));
    expect(onShow).toHaveBeenCalledWith(["A1", "A2"]);
  });

  it("shows the worst five and keeps the rest behind a click", async () => {
    const pair = (label: string, students: string[]): publication.GroupClash => ({
      groups: [
        { id: `rdns-${label}`, scopeId: "scope-rdns", scopeCode: "RDNS", label },
        { id: "group-5", scopeId: "scope-td", scopeCode: "TD", label: "5" },
      ],
      windows: [{ weekday: "Tue", start: "13:15", end: "14:45", crns: ["24000", "23563"], dates: 1 }],
      students,
    });
    withClashes([pair("1", ["A1"]), ...["2", "3", "4", "5", "6", "7"].map((label) => pair(label, []))]);
    renderCatalogue("term-1");

    await screen.findByText("RDNS 1 × TD 5");
    expect(screen.getByText("RDNS 5 × TD 5")).toBeTruthy();
    expect(screen.queryByText("RDNS 6 × TD 5")).toBeNull();

    fireEvent.click(screen.getByText("Show all 7 pairs"));
    expect(screen.getByText("RDNS 7 × TD 5")).toBeTruthy();

    fireEvent.click(screen.getByText("Show fewer"));
    expect(screen.queryByText("RDNS 7 × TD 5")).toBeNull();
  });

  it("says nothing when the timetable finds no overlap", async () => {
    withClashes([]);
    renderCatalogue("term-1");
    await screen.findByText(/1 block/);
    expect(screen.queryByText(/at the same hour/)).toBeNull();
  });
});

describe("students nobody has placed", () => {
  const withUnassigned = (unassigned: Record<string, string[]>) =>
    vi.spyOn(publication, "fetchPublication").mockResolvedValue({
      cohorts: [
        {
          cohortId: "cohort-1",
          cohort: "Foundation Year",
          students: 24,
          studentsResolved: 20,
          unassigned,
          warnings: [],
          clashes: [],
          isReady: false,
        },
      ],
      validation: {},
      unmatchedCrns: 0,
      sections: 43,
      resolved: { students: 20, enrolments: 140 },
      isReady: false,
    });

  it("recounts the moment a group is removed, without a page refresh", async () => {
    /*
     * The warning is read from the publication and the matrix from the catalogue, and
     * only the catalogue was being refetched. Removing a group changed the table and left
     * the sentence above it describing the semester as it was a moment ago.
     */
    let unassigned: Record<string, string[]> = { TD: ["A1", "A2", "A3"] };
    vi.spyOn(publication, "fetchPublication").mockImplementation(async () => ({
      cohorts: [
        {
          cohortId: "cohort-1",
          cohort: "Foundation Year",
          students: 24,
          studentsResolved: 20,
          unassigned,
          warnings: [],
          clashes: [],
          isReady: false,
        },
      ],
      validation: {},
      unmatchedCrns: 0,
      sections: 43,
      resolved: { students: 20, enrolments: 140 },
      isReady: false,
    }));
    vi.spyOn(database, "deleteGroup").mockResolvedValue();
    renderCatalogue("term-1");
    expect((await screen.findByText(/in no group for/)).textContent).toContain("TD (3)");

    // Removing the group leaves everybody who sat in it unplaced.
    unassigned = { TD: ["A1", "A2", "A3", "A4", "A5"] };
    fireEvent.click(screen.getByLabelText("Remove group 5"));
    fireEvent.click(await screen.findByRole("button", { name: "Remove group" }));

    await waitFor(() =>
      expect(screen.getByText(/in no group for/).textContent).toContain("TD (5)"),
    );
  });

  it("warns while the blocks are being filled, not only when publishing", async () => {
    withUnassigned({ TD: ["A1", "A2", "A3"], CM: ["A1"] });
    renderCatalogue("term-1");

    const warning = await screen.findByText(/in no group for/);
    expect(warning.textContent).toContain("TD (3), CM (1)");
    expect(warning.textContent).toContain("blank timetable");
  });

  it("counts people, not gaps — somebody missing from two blocks is one student to find", async () => {
    withUnassigned({ TD: ["A1"], CM: ["A1"] });
    renderCatalogue("term-1");

    const warning = await screen.findByText(/in no group for/);
    expect(warning.textContent).toContain("1 student in this cohort is in no group");
  });

  it("hands the ids to the Students table rather than describing them", async () => {
    withUnassigned({ TD: ["A2", "A1"] });
    const onShow = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GroupCatalogue cohort={COHORT} termId="term-1" onShowStudents={onShow} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Show them in Students/ }));

    expect(onShow).toHaveBeenCalledWith(["A1", "A2"]);
  });

  it("says nothing when everybody has a group", async () => {
    withUnassigned({});
    renderCatalogue("term-1");

    await screen.findByLabelText(/CRN for TD group 5, MATH001/);
    expect(screen.queryByText(/in no group for/)).toBeNull();
  });
});
