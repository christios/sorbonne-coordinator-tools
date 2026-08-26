import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkbookReview } from "@/components/WorkbookReview";
import type { PlacementRow, ReferenceBlock, WorkbookPreview } from "@/services/workbookReview";

const BLOCK: ReferenceBlock = {
  scopeCode: "TD",
  scopeName: "Tutorials",
  isNew: false,
  unchanged: 4,
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
};

const MOVED: PlacementRow = {
  key: "place|A00021503|TD",
  op: "place",
  status: "moved",
  studentId: "A00021503",
  scopeCode: "TD",
  before: "3",
  after: "5",
  groupId: "group-5",
  detail: "TD 3 → 5",
};

function previewOf(
  blocks: ReferenceBlock[],
  rows: PlacementRow[],
  overrides: Partial<WorkbookPreview["placements"]> = {},
): WorkbookPreview {
  const referenceRows = blocks.flatMap((block) => block.rows);
  return {
    filename: "FYS-Groups-26-27-S1.xlsx",
    sheet: "Reference",
    style: "cohort",
    reference: {
      blocks,
      summary: {
        blocksNew: blocks.filter((block) => block.isNew).length,
        groupsAdded: referenceRows.filter((row) => row.kind === "group").length,
        coursesAdded: 0,
        crnsChanged: referenceRows.filter((row) => row.status === "changed").length,
        crnsAdded: 0,
        unchanged: 4,
        decisions: referenceRows.length,
      },
    },
    placements: {
      rows,
      unchanged: 20,
      unknownGroups: [],
      unknownStudents: [],
      summary: {
        placed: rows.filter((row) => row.status === "placed").length,
        moved: rows.filter((row) => row.status === "moved").length,
        unchanged: 20,
        unknownGroups: 0,
        unknownStudents: 0,
        decisions: rows.length,
      },
      note: "",
      ...overrides,
    },
  };
}

function show(preview: WorkbookPreview, onApply = vi.fn()) {
  render(
    <WorkbookReview
      preview={preview}
      busy={false}
      error={null}
      onApply={onApply}
      onCancel={vi.fn()}
    />,
  );
  return onApply;
}

const applyButton = () => screen.getByRole("button", { name: /^Apply / }) as HTMLButtonElement;

describe("reviewing a workbook", () => {
  it("opens with everything unticked and nothing appliable", () => {
    // A pre-ticked box is not a decision, and this screen exists to make decisions.
    show(previewOf([BLOCK], [MOVED]));

    screen.getAllByRole("checkbox").forEach((box) => expect((box as HTMLInputElement).checked).toBe(false));
    expect(applyButton().disabled).toBe(true);
    expect(screen.getByText(/of 2 change\(s\) approved/).textContent).toContain("0 of 2");
  });

  it("shows a changed CRN as both values, not just the new one", () => {
    show(previewOf([BLOCK], []));

    expect(screen.getByText("Group 5 · MATH001")).toBeTruthy();
    expect(screen.getByText("CRN 23563 → 29999")).toBeTruthy();
  });

  it("says which group a student is in now before offering to move them", () => {
    show(previewOf([], [MOVED]));

    expect(screen.getByText("group 3 → 5")).toBeTruthy();
    expect(screen.getByText("A00021503")).toBeTruthy();
  });

  it("sends only the ticked rows", () => {
    const onApply = show(previewOf([BLOCK], [MOVED]));

    fireEvent.click(screen.getByLabelText(/Approve Group 5 · MATH001/));
    fireEvent.click(applyButton());

    const [operations, approved] = onApply.mock.calls[0];
    expect(approved).toBe(1);
    expect(operations.map((operation: { op: string }) => operation.op)).toEqual(["setCell"]);
  });

  it("ticks a whole block at once, and unticks it again", () => {
    show(previewOf([BLOCK], []));

    const tickAll = screen.getByRole("button", { name: /Tick all 1/ });
    fireEvent.click(tickAll);
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Untick these/ }));
    expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(false);
  });

  it("keeps the count of students who would change group in front of the coordinator", () => {
    show(previewOf([], [MOVED]));

    fireEvent.click(screen.getByLabelText(/Approve A00021503/));
    expect(screen.getByText(/1 student\(s\) would change group/)).toBeTruthy();
  });

  it("names the groups the student tabs mention and the catalogue does not have", () => {
    // Usually it means the Reference sheet and the student tabs have drifted apart, and
    // skipping those rows in silence is how a student ends up in no group at all.
    show(previewOf([], [], { unknownGroups: ["TD 7", "CM 9"] }));

    expect(screen.getByText(/No such group in this semester: TD 7, CM 9/)).toBeTruthy();
  });

  it("says which ids it will not place rather than inventing those students", () => {
    // The guard the unreviewed importer had: the roster is the registrar's, and a typo in
    // the ID column must not become an assignment for somebody who does not exist here.
    show(previewOf([], [], { unknownStudents: ["A00099998", "A00099999"] }));

    expect(screen.getByText(/2 id\(s\) in this workbook are not students in this cohort/)).toBeTruthy();
  });

  it("says so plainly when the workbook and the semester already agree", () => {
    show(previewOf([{ ...BLOCK, rows: [] }], []));

    expect(screen.getByText(/matches the semester exactly/)).toBeTruthy();
    expect(applyButton().disabled).toBe(true);
  });
});
