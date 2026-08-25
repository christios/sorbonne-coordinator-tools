import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupCatalogue } from "@/components/GroupCatalogue";
import * as publication from "@/services/publication";
import * as database from "@/services/studentDatabase";

const COHORT: database.Cohort = {
  id: "cohort-1",
  name: "Foundation Year",
  term: "S1 2026-27",
  notes: "",
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
          note: "",
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

  it("reports what a workbook upload read", async () => {
    vi.spyOn(database, "importReferenceWorkbook").mockResolvedValue({
      filename: "FYS.xlsx",
      sheet: "Reference",
      style: "cohort",
      read: { scopes: 3, groups: 21, crns: 39 },
      added: { scopes: 3, courses: 7, groups: 21, crns: 39 },
    });
    renderCatalogue();
    await screen.findByText("TD");

    const file = new File(["x"], "FYS.xlsx", { type: "application/vnd.ms-excel" });
    fireEvent.change(screen.getByLabelText(/Upload workbook/i), { target: { files: [file] } });

    expect(await screen.findByText(/39 CRNs/)).toBeTruthy();
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
