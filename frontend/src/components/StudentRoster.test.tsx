import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StudentRoster } from "@/components/StudentRoster";
import { forgetHistory, recordPull } from "@/services/pullHistory";
import { forgetRosters, rememberPull, rememberSync } from "@/services/rosterStore";
import * as rosters from "@/services/scenRosters";
import * as database from "@/services/studentDatabase";

/** The columns come from the portal's own grid, so the tests describe one. */
/** The roster is always showing one view, and everything stored is that view's. */
const VIEW_ID = "view-1";

const SCHEMA: rosters.PortalSchema = {
  ok: true,
  source: "portal",
  // What the grid shows, which is what the table may show.
  columns: [
    { key: "FULL_NAME", label: "Student" },
    { key: "YEARLEVEL_CODE", label: "Year" },
    { key: "MAJOR_CODE_DESC", label: "Major" },
    { key: "PSUAD_EMAIL", label: "E-mail" },
  ],
  // What the grid filters by, which only decides how a column filters.
  fields: [
    { key: "FULL_NAME", label: "Student", options: [] },
    { key: "YEARLEVEL_CODE", label: "Year", options: [
      { value: "FY", label: "FY" },
      { value: "L1", label: "L1" },
    ] },
    { key: "MAJOR_CODE_DESC", label: "Major", options: [
      { value: "Mathematics", label: "Mathematics" },
      { value: "Physics", label: "Physics" },
    ] },
    { key: "PSUAD_EMAIL", label: "E-mail", options: [] },
    { key: "NATION_DESC", label: "Nationality", options: [] },
  ],
  term: null,
  harvestedAt: null,
  error: "",
};

const COHORTS: database.Cohort[] = [
  {
    id: "cohort-1",
    name: "Foundation Year",
    term: "S1 2026-27",
    notes: "",
    memberCount: 1,
    scopeCount: 3,
    createdAt: "",
    updatedAt: "",
  },
  {
    id: "cohort-2",
    name: "L1",
    term: "S1 2026-27",
    notes: "",
    memberCount: 0,
    scopeCount: 0,
    createdAt: "",
    updatedAt: "",
  },
];

const SYNCED = "2026-08-22T09:00:00+00:00";
const EARLIER = "2026-08-01T09:00:00+00:00";

/** What our side holds: ids, a status and a cohort. Never a name. */
const HELD: database.Student[] = [
  {
    studentId: "A001",
    status: "in_portal",
    cohortId: "cohort-1",
    cohortName: "Foundation Year",
    firstSeenAt: EARLIER,
    lastSeenAt: SYNCED,
    groups: [],
  },
  {
    studentId: "A002",
    status: "in_portal",
    cohortId: null,
    cohortName: "",
    firstSeenAt: EARLIER,
    lastSeenAt: SYNCED,
    groups: [],
  },
  {
    studentId: "A003",
    status: "in_portal",
    cohortId: null,
    cohortName: "",
    firstSeenAt: SYNCED,
    lastSeenAt: SYNCED,
    groups: [],
  },
  {
    studentId: "A999",
    status: "not_in_portal",
    cohortId: "cohort-1",
    cohortName: "Foundation Year",
    firstSeenAt: EARLIER,
    lastSeenAt: EARLIER,
    groups: [],
  },
];

/** The names, as the extension left them in this browser. */
const PULLED = [
  { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
  { SPRIDEN_ID: "A002", FULL_NAME: "Karim Nasser", YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" },
  { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
];

async function withNames() {
  await rememberPull({
    // Stored under the view that pulled it: another view's pull answered another question.
    presetId: VIEW_ID,
    name: "Sync",
    count: PULLED.length,
    expect: null,
    warning: null,
    fetchedAt: Date.now(),
    rows: PULLED,
  });
  rememberSync(VIEW_ID, SYNCED);
}

function renderRoster(preselect: string[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudentRoster cohorts={COHORTS} viewId={VIEW_ID} preselect={preselect} />
    </QueryClientProvider>,
  );
}

/** SelectMenu is a button and a listbox, not a native select — see the UI decisions doc.
 *  A multi-select stays open between picks, so only open it when it is not already. */
async function choose(label: string, option: string | RegExp) {
  const trigger = await screen.findByRole("combobox", { name: label });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

/** Compose a column filter the way a coordinator does: pick the column, then the value. */
async function addFilter(column: string) {
  fireEvent.click(screen.getByRole("button", { name: /^(Filter|Add filter)$/ }));
  fireEvent.click(await screen.findByRole("button", { name: column }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(database, "fetchStudents").mockResolvedValue(HELD);
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await forgetRosters();
  await forgetHistory();
  window.localStorage.clear();
});

describe("StudentRoster", () => {
  it("shows every held student, with the ids the server keeps", async () => {
    renderRoster();

    expect(await screen.findByText("A001")).toBeTruthy();
    expect(screen.getByText("A999")).toBeTruthy();
    expect(screen.getByText(/4 students held/)).toBeTruthy();
  });

  it("names them from the pull this browser is holding", async () => {
    await withNames();
    renderRoster();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
    expect(within(rowFor("Amira Haddad")).getByText("Foundation Year")).toBeTruthy();
  });

  it("marks a student the last sync brought in as new", async () => {
    await withNames();
    renderRoster();

    expect(within(await waitFor(() => rowFor("Nadia Newcomer"))).getByText("New")).toBeTruthy();
    expect(within(rowFor("Amira Haddad")).queryByText("New")).toBeNull();
  });

  it("shows a student the portal stopped returning without pretending to know their name", async () => {
    await withNames();
    renderRoster();

    const gone = (await screen.findByText("A999")).closest("tr") as HTMLElement;
    expect(within(gone).getByText("Not in portal")).toBeTruthy();
    expect(within(gone).getByText(/name not pulled yet/)).toBeTruthy();
  });

  it("has no sync control of its own — the roster is not where the list is built", async () => {
    renderRoster();
    await screen.findByText("A001");

    expect(screen.queryByRole("button", { name: /sync/i })).toBeNull();
  });

  describe("column filters", () => {
    it("narrows by a column's own values", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      await addFilter("Year");
      await choose("Year value", "L1");

      expect(screen.getByText("Karim Nasser")).toBeTruthy();
      expect(screen.queryByText("Amira Haddad")).toBeNull();
    });

    it("turns the operator plural on its own when a second value is chosen", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      await addFilter("Year");
      await choose("Year value", "L1");
      expect(screen.getByRole("button", { name: "Year operator" }).textContent).toBe("is");

      await choose("Year value", "FY");

      expect(screen.getByRole("button", { name: "Year operator" }).textContent).toBe("is any of");
      expect(screen.getByText("Amira Haddad")).toBeTruthy();
    });

    it("inverts when the operator is changed, keeping the values", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      await addFilter("Year");
      await choose("Year value", "L1");
      fireEvent.click(screen.getByRole("button", { name: "Year operator" }));
      fireEvent.click(await screen.findByRole("button", { name: "is not" }));

      expect(screen.queryByText("Karim Nasser")).toBeNull();
      expect(screen.getByText("Amira Haddad")).toBeTruthy();
    });

    it("removes one chip without disturbing the others", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      await addFilter("Year");
      await choose("Year value", "FY");
      await addFilter("Student");
      fireEvent.change(screen.getByLabelText("Student value"), { target: { value: "nadia" } });
      expect(screen.queryByText("Amira Haddad")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Remove the Student filter" }));

      expect(screen.getByText("Amira Haddad")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Year operator" })).toBeTruthy();
    });

    it("clears every filter at once", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      await addFilter("Year");
      await choose("Year value", "L1");
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

      expect(screen.getByText("Amira Haddad")).toBeTruthy();
    });
  });

  describe("columns", () => {
    it("adds a column that was put away, and remembers it", async () => {
      await withNames();
      const { unmount } = renderRoster();
      await screen.findByText("Amira Haddad");
      expect(screen.queryByRole("button", { name: "Sort by E-mail" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Columns/ }));
      fireEvent.click(screen.getByLabelText("E-mail"));

      expect(await screen.findByRole("button", { name: "Sort by E-mail" })).toBeTruthy();

      // The arrangement is a preference, so it survives leaving the page.
      unmount();
      renderRoster();
      expect(await screen.findByRole("button", { name: "Sort by E-mail" })).toBeTruthy();
    });

    it("moves a column along, and will not move it off either end", async () => {
      renderRoster();
      await screen.findByText("A001");
      fireEvent.click(screen.getByRole("button", { name: /Columns/ }));

      fireEvent.click(screen.getByRole("button", { name: "Move Student left" }));

      const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
      expect(headers[1]).toContain("Student");
      // Student is first now, so there is nowhere further left for it to go.
      expect(screen.getByRole("button", { name: "Move Student left" })).toHaveProperty("disabled", true);
    });

    it("will not let go of the columns that carry the row's identity", async () => {
      renderRoster();
      await screen.findByText("A001");
      fireEvent.click(screen.getByRole("button", { name: /Columns/ }));

      expect(screen.getByLabelText(/^Id/)).toHaveProperty("disabled", true);
      expect(screen.getByLabelText(/^Status/)).toHaveProperty("disabled", true);
    });

    it("tracks the pointer when the edge is dragged", async () => {
      renderRoster();
      await screen.findByText("A001");
      const handle = screen.getByRole("separator", { name: "Resize Student" });
      const started = Number.parseInt(
        screen.getByRole("columnheader", { name: /Student/ }).style.width,
        10,
      );

      // jsdom's PointerEvent carries no coordinates, so these are MouseEvents of the
      // pointer types — which is what the component reads clientX from anyway.
      const at = (type: string, clientX: number) =>
        new MouseEvent(type, { clientX, bubbles: true, cancelable: true });

      fireEvent(handle, at("pointerdown", 700));
      // A stray second press must not re-anchor the drag to the width reached so far.
      fireEvent(handle, at("pointerdown", 760));
      fireEvent(window, at("pointermove", 800));

      // 100px of pointer travel from the anchor, and the stray press changed nothing.
      expect(screen.getByRole("columnheader", { name: /Student/ }).style.width).toBe(
        `${started + 100}px`,
      );
    });

    it("reorders when a header is dragged onto another", async () => {
      renderRoster();
      await screen.findByText("A001");
      const before = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
      expect(before[1]).toContain("Status");

      const handle = screen.getByRole("button", { name: "Drag Cohort to reorder" });
      const target = screen.getByRole("columnheader", { name: /Status/ });
      const transfer = { effectAllowed: "", setData: () => {}, getData: () => "" };
      fireEvent.dragStart(handle, { dataTransfer: transfer });
      fireEvent.dragOver(target, { dataTransfer: transfer });
      fireEvent.drop(target, { dataTransfer: transfer });

      const after = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
      expect(after[1]).toContain("Cohort");
    });

    it("drops a column after the one it was dragged past the middle of", async () => {
      renderRoster();
      await screen.findByText("A001");

      const handle = screen.getByRole("button", { name: "Drag Cohort to reorder" });
      const target = screen.getByRole("columnheader", { name: /Status/ });
      // jsdom measures nothing, so the header is given a width to have a middle.
      target.getBoundingClientRect = () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 40, height: 40, x: 0, y: 0, toJSON: () => ({}) });
      const transfer = { effectAllowed: "", setData: () => {}, getData: () => "", setDragImage: () => {} };

      fireEvent.dragStart(handle, { dataTransfer: transfer });
      fireEvent.dragOver(target, { dataTransfer: transfer, clientX: 80 });
      fireEvent.drop(target, { dataTransfer: transfer, clientX: 80 });

      // Dropped on Status's right half, so it lands after Status rather than before it.
      const after = screen.getAllByRole("columnheader").map((cell) => cell.textContent ?? "");
      expect(after[1]).toContain("Status");
      expect(after[2]).toContain("Cohort");
    });

    it("resizes a column from the keyboard, and remembers the width", async () => {
      const { unmount } = renderRoster();
      await screen.findByText("A001");
      const header = screen.getByRole("columnheader", { name: /Student/ });
      const before = header.style.width;

      fireEvent.keyDown(screen.getByRole("separator", { name: "Resize Student" }), { key: "ArrowRight" });

      expect(screen.getByRole("columnheader", { name: /Student/ }).style.width).not.toBe(before);
      unmount();
      renderRoster();
      expect((await screen.findByRole("columnheader", { name: /Student/ })).style.width).not.toBe(before);
    });
  });

  it("moves the selected students into a cohort, sending ids and nothing else", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(2);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByLabelText("Select Karim Nasser"));
    fireEvent.click(screen.getByLabelText("Select Nadia Newcomer"));
    await choose("Move to cohort", "L1");
    fireEvent.click(screen.getByRole("button", { name: /Move 2/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    const [ids, cohortId] = move.mock.calls[0];
    expect([...ids].sort()).toEqual(["A002", "A003"]);
    expect(cohortId).toBe("cohort-2");
    // The privacy rule, pinned: no name may cross to our API.
    expect(JSON.stringify(ids)).not.toContain("Karim");
  });

  it("moves without a word when the students hold no groups, which is most moves", async () => {
    // The confirmation is only worth reading if it is rare. Nobody in HELD is placed.
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByLabelText("Select Karim Nasser"));
    await choose("Move to cohort", "L1");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stops first when the move would drop placements, and names every semester", async () => {
    // Leaving a cohort deletes the groups held in it — in every semester, not the one
    // being looked at. That is the deletion nobody can see coming.
    vi.spyOn(database, "fetchStudents").mockResolvedValue(
      HELD.map((student) =>
        student.studentId === "A001"
          ? {
              ...student,
              groups: [
                { termId: "term-1", scopeCode: "TD", groupLabel: "1" },
                { termId: "term-2", scopeCode: "TD", groupLabel: "3" },
              ],
            }
          : student,
      ),
    );
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByLabelText("Select Amira Haddad"));
    await choose("Move to cohort", "L1");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 student would lose 2 group placements/)).toBeTruthy();
    expect(within(dialog).getByText(/across 2 semesters/)).toBeTruthy();
    expect(move).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Move anyway" }));
    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(move.mock.calls[0]).toEqual([["A001"], "cohort-2"]);
  });

  it("lets the move be called off, and nothing is written", async () => {
    vi.spyOn(database, "fetchStudents").mockResolvedValue(
      HELD.map((student) =>
        student.studentId === "A001"
          ? { ...student, groups: [{ termId: "term-1", scopeCode: "TD", groupLabel: "1" }] }
          : student,
      ),
    );
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByLabelText("Select Amira Haddad"));
    await choose("Move to cohort", "L1");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(move).not.toHaveBeenCalled();
  });

  it("takes students out of a cohort with a null, not a delete", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByLabelText("Select Amira Haddad"));
    await choose("Move to cohort", "Take out of their cohort");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(move.mock.calls[0]).toEqual([["A001"], null]);
  });

  it("selects everyone shown, respecting the filter", async () => {
    const move = vi.spyOn(database, "setCohort").mockResolvedValue(1);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");
    await addFilter("Year");
    await choose("Year value", "L1");

    fireEvent.click(screen.getByLabelText("Select everyone shown"));
    await choose("Move to cohort", "L1");
    fireEvent.click(screen.getByRole("button", { name: /Move 1/ }));

    await waitFor(() => expect(move).toHaveBeenCalled());
    expect(move.mock.calls[0][0]).toEqual(["A002"]);
  });

  describe("searching", () => {
    it("looks in every column on screen, not a chosen few", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      // Major is a column, so its values are searchable without naming the field.
      fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "physics" } });

      expect(screen.getByText("Karim Nasser")).toBeTruthy();
      expect(screen.queryByText("Amira Haddad")).toBeNull();
    });

    it("finds a student by the cohort they are in", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "foundation" } });

      expect(screen.getByText("Amira Haddad")).toBeTruthy();
      expect(screen.queryByText("Karim Nasser")).toBeNull();
    });

    it("still finds by id and by name", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "karim" } });
      expect(screen.queryByText("Amira Haddad")).toBeNull();

      fireEvent.change(screen.getByLabelText("Search students"), { target: { value: "A999" } });
      expect(screen.getByText("A999")).toBeTruthy();
    });
  });

  describe("the history panel", () => {
    it("lists only the pulls something changed in, and says how many were quiet", async () => {
      const at = (n: number) => 1_700_000_000_000 + n * 86_400_000;
      await recordPull(VIEW_ID, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" }], at(1));
      await recordPull(VIEW_ID, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" }], at(2));
      await recordPull(VIEW_ID, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "L1" }], at(3));
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));

      const panel = await screen.findByRole("complementary", { name: "Student history" });
      expect(within(panel).getByText("FY")).toBeTruthy();
      expect(within(panel).getByText("L1")).toBeTruthy();
      expect(within(panel).getByText(/1 of 3 pulls changed something/)).toBeTruthy();
      expect(within(panel).getByText(/2 pulls with no change/)).toBeTruthy();
    });

    it("says so plainly when a student has never changed", async () => {
      await recordPull(VIEW_ID, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }], 1_000);
      await recordPull(VIEW_ID, [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }], 2_000);
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));

      const panel = await screen.findByRole("complementary", { name: "Student history" });
      expect(within(panel).getByText(/Nothing about this student has changed across 2 pulls/)).toBeTruthy();
    });

    it("closes when the pointer goes down on the table behind it", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");
      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));
      await screen.findByRole("complementary", { name: "Student history" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
      });

      fireEvent(
        screen.getByText("Karim Nasser"),
        new MouseEvent("pointerdown", { bubbles: true, cancelable: true }),
      );

      expect(screen.queryByRole("complementary", { name: "Student history" })).toBeNull();
    });

    it("stays open when the pointer goes down inside it", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");
      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));
      const panel = await screen.findByRole("complementary", { name: "Student history" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
      });

      fireEvent(panel, new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));

      expect(screen.getByRole("complementary", { name: "Student history" })).toBeTruthy();
    });

    it("swaps to another student rather than closing when their history is asked for", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");
      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
      });

      const other = screen.getByRole("button", { name: "History for Karim Nasser" });
      fireEvent(other, new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
      fireEvent.click(other);

      const panel = await screen.findByRole("complementary", { name: "Student history" });
      expect(within(panel).getByText("Karim Nasser")).toBeTruthy();
    });

    it("closes again", async () => {
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");
      fireEvent.click(screen.getByRole("button", { name: "History for Amira Haddad" }));

      fireEvent.click(await screen.findByRole("button", { name: "Close student history" }));

      expect(screen.queryByRole("complementary", { name: "Student history" })).toBeNull();
    });
  });

  describe("copying", () => {
    it("copies a column as a spreadsheet reads one", async () => {
      const written: string[] = [];
      Object.assign(navigator, {
        clipboard: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
      });
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.click(screen.getByRole("button", { name: "Copy the Student column" }));

      await waitFor(() => expect(written).toHaveLength(1));
      expect(written[0].split("\n")).toContain("Karim Nasser");
    });

    it("copies a row tab-separated, so each value lands in its own cell", async () => {
      const written: string[] = [];
      Object.assign(navigator, {
        clipboard: { writeText: (text: string) => (written.push(text), Promise.resolve()) },
      });
      await withNames();
      renderRoster();
      await screen.findByText("Amira Haddad");

      fireEvent.click(screen.getByRole("button", { name: "Copy the row for Amira Haddad" }));

      await waitFor(() => expect(written).toHaveLength(1));
      expect(written[0].split("\t")).toContain("Amira Haddad");
      expect(written[0]).not.toContain("\n");
    });
  });

  it("keeps every student when the stored rosters are forgotten", async () => {
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByRole("button", { name: /forget stored rosters/i }));
    expect(await screen.findByText(/No student leaves the list/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget rosters" }));

    await waitFor(() => expect(screen.queryByText("Amira Haddad")).toBeNull());
    expect(screen.getByText("A001")).toBeTruthy();
    expect(screen.getByText(/4 students held/)).toBeTruthy();
  });

  it("uses the shared select control, not a native one", async () => {
    // docs/handoffs/ui-ux-decisions.md: no native <select> in product UI.
    renderRoster();
    await screen.findByText("A001");

    expect(document.querySelector("select")).toBeNull();
  });
});

describe("sorting", () => {
  /** Who is on screen, in the order the table has them. */
  const shown = () =>
    screen
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label") ?? "")
      .filter((label) => label.startsWith("Select ") && label !== "Select everyone shown")
      .map((label) => label.replace("Select ", ""));

  it("sorts by a portal column, not just by our own", async () => {
    // The bug: sorting read the column id off the row, so anything reached through
    // `portal` compared as blank and the table stayed in id order however you clicked.
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByRole("button", { name: "Sort by Year" }));

    // FY, FY, L1 — which is not the order the ids are in. A999 is the student the portal
    // no longer returns, so this browser knows no year for them: blanks last, either way.
    expect(shown()).toEqual(["Amira Haddad", "Nadia Newcomer", "Karim Nasser", "A999"]);
  });

  it("turns the sort around when the same column is clicked again", async () => {
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByRole("button", { name: "Sort by Year" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by Year" }));

    expect(shown()).toEqual(["Karim Nasser", "Nadia Newcomer", "Amira Haddad", "A999"]);
  });

  it("ignores case, because the registrar's is not a decision about order", async () => {
    // The portal hands back whatever case it holds. Sorted case-sensitively, "nasser"
    // lands after every capitalised name instead of beside them.
    await rememberPull({
      presetId: VIEW_ID,
      name: "Sync",
      count: 3,
      expect: null,
      warning: null,
      fetchedAt: Date.now(),
      rows: [
        { SPRIDEN_ID: "A001", FULL_NAME: "amira haddad", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
        { SPRIDEN_ID: "A002", FULL_NAME: "KARIM NASSER", YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" },
        { SPRIDEN_ID: "A003", FULL_NAME: "Nadia Newcomer", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
      ],
    });
    rememberSync(VIEW_ID, SYNCED);
    renderRoster();
    await screen.findByText("amira haddad");

    fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));

    expect(shown()).toEqual(["amira haddad", "KARIM NASSER", "Nadia Newcomer", "A999"]);
  });

  it("treats names that differ only in case as the same name", async () => {
    // Default collation ranks case, so "martin" and "MARTIN" land in an order decided by
    // capitalisation. They are one name: order them by id instead, so the list is stable.
    await rememberPull({
      presetId: VIEW_ID,
      name: "Sync",
      count: 3,
      expect: null,
      warning: null,
      fetchedAt: Date.now(),
      rows: [
        { SPRIDEN_ID: "A001", FULL_NAME: "MARTIN", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
        { SPRIDEN_ID: "A002", FULL_NAME: "martin", YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" },
        { SPRIDEN_ID: "A003", FULL_NAME: "Zoe", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
      ],
    });
    rememberSync(VIEW_ID, SYNCED);
    renderRoster();
    await screen.findByText("Zoe");

    fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));

    expect(shown()).toEqual(["MARTIN", "martin", "Zoe", "A999"]);
  });

  it("keeps accents apart, which case-folding must not flatten", async () => {
    // Case is noise; an accent is a different letter. Léa and Lea are two people.
    await rememberPull({
      presetId: VIEW_ID,
      name: "Sync",
      count: 3,
      expect: null,
      warning: null,
      fetchedAt: Date.now(),
      rows: [
        { SPRIDEN_ID: "A001", FULL_NAME: "LÉA", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
        { SPRIDEN_ID: "A002", FULL_NAME: "lea", YEARLEVEL_CODE: "L1", MAJOR_CODE_DESC: "Physics" },
        { SPRIDEN_ID: "A003", FULL_NAME: "Leb", YEARLEVEL_CODE: "FY", MAJOR_CODE_DESC: "Mathematics" },
      ],
    });
    rememberSync(VIEW_ID, SYNCED);
    renderRoster();
    await screen.findByText("Leb");

    fireEvent.click(screen.getByRole("button", { name: "Sort by Student" }));

    // lea before LÉA before Leb: the accent still decides, the case does not.
    expect(shown()).toEqual(["lea", "LÉA", "Leb", "A999"]);
  });

  it("sorts by our own columns too", async () => {
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    // The table opens sorted by id, so the first click on that column reverses it.
    expect(shown()).toEqual(["Amira Haddad", "Karim Nasser", "Nadia Newcomer", "A999"]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by Id" }));

    expect(shown()).toEqual(["A999", "Nadia Newcomer", "Karim Nasser", "Amira Haddad"]);
  });
});

describe("the toolbar", () => {
  it("keeps the cohort control on screen, disabled until something is selected", async () => {
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    // It used to appear only once a row was ticked, which moved the table down under the
    // cursor at the moment of clicking.
    expect(screen.getByText("None selected")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Move to cohort" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /^Move$/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByLabelText("Select Karim Nasser"));

    expect(screen.getByText("1 selected")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Move to cohort" })).toHaveProperty("disabled", false);
  });

  it("searches every student we hold when told to, not only this view", async () => {
    const fetched = vi.spyOn(database, "fetchStudents").mockResolvedValue(HELD);
    await withNames();
    renderRoster();
    await screen.findByText("Amira Haddad");

    fireEvent.click(screen.getByRole("button", { name: /This view/ }));

    // No view named: the whole record, so a student can be found without knowing which
    // population holds them.
    await waitFor(() => expect(fetched).toHaveBeenCalledWith(""));
    expect(await screen.findByRole("button", { name: /All students/ })).toBeTruthy();
  });
});

describe("students sent here from Groups & CRNs", () => {
  it("narrows the table to them, rather than ticking rows you cannot see", async () => {
    // Nine ticks among 2803 rows are nine rows nobody can find. "Show them" has to show them.
    renderRoster(["A001", "A003"]);

    expect(await screen.findByText("A001")).toBeTruthy();
    expect(screen.getByText("A003")).toBeTruthy();
    expect(screen.queryByText("A002")).toBeNull();
    expect(screen.queryByText("A999")).toBeNull();
  });

  it("says why the table is short, and offers the way back", async () => {
    renderRoster(["A001", "A003"]);

    const banner = await screen.findByText(/sent from Groups & CRNs/);
    expect(banner.textContent).toContain("2 students");

    fireEvent.click(screen.getByRole("button", { name: /Show everyone again/ }));

    expect(await screen.findByText("A002")).toBeTruthy();
    expect(screen.queryByText(/sent from Groups & CRNs/)).toBeNull();
  });

  it("ticks them too, so they can be placed straight away", async () => {
    renderRoster(["A001", "A003"]);

    await screen.findByText("A001");
    expect(screen.getByText(/2 selected/)).toBeTruthy();
    const place = screen.getByRole("button", { name: /Place in a block/ }) as HTMLButtonElement;
    // A001 is in a cohort and A003 is not, so this selection has no single block list.
    expect(place.disabled).toBe(true);
  });

  it("says when somebody sent here is not in the record at all", async () => {
    renderRoster(["A001", "A00099999"]);

    const banner = await screen.findByText(/sent from Groups & CRNs/);
    expect(banner.textContent).toContain("1 of them are in this record");
  });
});

describe("selecting a run of students", () => {
  /** The ids in the order the table is showing them, which is the order a range follows. */
  const shownIds = () =>
    [...screen.getAllByRole("row")]
      .slice(1)
      .map((row) => row.textContent?.match(/A\d+/)?.[0])
      .filter(Boolean) as string[];

  const tick = (id: string, shift = false) =>
    fireEvent.click(screen.getByLabelText(new RegExp(`^Select ${id}$`)), shift ? { shiftKey: true } : {});

  it("takes everything between the last tick and a shift-click", async () => {
    renderRoster();
    await screen.findByText("A001");
    const ids = shownIds();

    tick(ids[0]);
    tick(ids[ids.length - 1], true);

    expect(screen.getByText(`${ids.length} selected`)).toBeTruthy();
  });

  it("works upwards as well as downwards", async () => {
    renderRoster();
    await screen.findByText("A001");
    const ids = shownIds();

    tick(ids[2]);
    tick(ids[0], true);

    expect(screen.getByText("3 selected")).toBeTruthy();
  });

  it("follows the rows on screen, not the order they are held in", async () => {
    // Sorted the other way, a range between the same two clicks covers different students.
    renderRoster();
    await screen.findByText("A001");
    fireEvent.click(screen.getByRole("button", { name: /Sort by Id/ }));
    fireEvent.click(screen.getByRole("button", { name: /Sort by Id/ }));
    const reversed = shownIds();

    tick(reversed[0]);
    tick(reversed[1], true);

    expect(screen.getByText("2 selected")).toBeTruthy();
  });

  it("a plain click after a range starts a new anchor rather than extending", async () => {
    renderRoster();
    await screen.findByText("A001");
    const ids = shownIds();

    tick(ids[0]);
    tick(ids[1], true);
    tick(ids[3]);

    expect(screen.getByText("3 selected")).toBeTruthy();
  });
});

describe("sorting by status", () => {
  it("ranks by the pills the cell shows, not by the portal state alone", async () => {
    // The bug: three signals in one cell, and only one of them reached the sort. Two rows
    // both "In portal", one of them flagged New, sorted into id order as if identical.
    await withNames();
    renderRoster();
    await screen.findByText("A001");

    fireEvent.click(screen.getByRole("button", { name: /Sort by Status/ }));

    const shown = [...screen.getAllByRole("row")].slice(1).map((row) => row.textContent ?? "");
    const notInPortal = shown.findIndex((text) => text.includes("Not in portal"));
    const isNew = shown.findIndex((text) => text.includes("New"));
    const quiet = shown.map((text) => !/Not in portal|New|Changed/.test(text)).lastIndexOf(true);

    expect(notInPortal).toBeLessThan(isNew);
    expect(isNew).toBeLessThan(quiet);
  });
});

/*
 * A student in two views is one student. Syncing them in the whole-term view used to
 * leave them stale in the L1 view, because the table read only the view it was showing.
 */
describe("a student who is in more than one view", () => {
  it("shows what another view's sync last learned about them", async () => {
    // This view has never been synced; a different one pulled this student just now.
    await rememberPull({
      presetId: "some-other-view",
      name: "Whole term",
      count: 1,
      expect: null,
      warning: null,
      fetchedAt: Date.now(),
      rows: [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", YEARLEVEL_CODE: "FY" }],
    });

    renderRoster();

    expect(await screen.findByText("Amira Haddad")).toBeTruthy();
  });

  it("prefers the newer sync when two views disagree", async () => {
    await rememberPull({
      presetId: VIEW_ID,
      name: "This view",
      count: 1,
      expect: null,
      warning: null,
      fetchedAt: 1_000,
      rows: [{ SPRIDEN_ID: "A001", FULL_NAME: "Old Spelling", YEARLEVEL_CODE: "FY" }],
    });
    await rememberPull({
      presetId: "some-other-view",
      name: "Whole term",
      count: 1,
      expect: null,
      warning: null,
      fetchedAt: 2_000,
      rows: [{ SPRIDEN_ID: "A001", FULL_NAME: "New Spelling", YEARLEVEL_CODE: "L1" }],
    });

    renderRoster();

    // The other view synced later, so its answer is the better one — here too.
    expect(await screen.findByText("New Spelling")).toBeTruthy();
    expect(screen.queryByText("Old Spelling")).toBeNull();
  });
});
