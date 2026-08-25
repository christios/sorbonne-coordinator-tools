import { describe, expect, it } from "vitest";

import {
  type PlacementRow,
  type ReferenceBlock,
  type WorkbookPreview,
  allKeys,
  blocksWithDecisions,
  countDecisions,
  operationsFrom,
  placementsByBlock,
  studentsMoved,
} from "@/services/workbookReview";

function cell(key: string, scopeCode = "TD"): ReferenceBlock["rows"][number] {
  return {
    kind: "cell",
    op: "setCell",
    key,
    status: "changed",
    label: "Group 5 · MATH001",
    detail: "CRN 23563 → 29999",
    scopeCode,
    groupLabel: "5",
    courseCode: "MATH001",
    before: "23563",
    after: "29999",
  };
}

function placement(overrides: Partial<PlacementRow>): PlacementRow {
  return {
    key: `place|${overrides.studentId ?? "A1"}|${overrides.scopeCode ?? "TD"}`,
    op: "place",
    status: "placed",
    studentId: "A1",
    scopeCode: "TD",
    before: "",
    after: "5",
    groupId: "group-5",
    detail: "TD 5",
    ...overrides,
  };
}

function preview(blocks: ReferenceBlock[], rows: PlacementRow[]): WorkbookPreview {
  return {
    filename: "FYS.xlsx",
    sheet: "Reference",
    style: "cohort",
    reference: {
      blocks,
      summary: {
        blocksNew: blocks.filter((block) => block.isNew).length,
        groupsAdded: 0,
        coursesAdded: 0,
        crnsChanged: blocks.flatMap((block) => block.rows).length,
        crnsAdded: 0,
        unchanged: 0,
        decisions: blocks.flatMap((block) => block.rows).length,
      },
    },
    placements: {
      rows,
      unchanged: 0,
      unknownGroups: [],
      unknownStudents: [],
      summary: {
        placed: rows.filter((row) => row.status === "placed").length,
        moved: rows.filter((row) => row.status === "moved").length,
        unchanged: 0,
        unknownGroups: 0,
        unknownStudents: 0,
        decisions: rows.length,
      },
      note: "",
    },
  };
}

const BLOCK: ReferenceBlock = {
  scopeCode: "TD",
  scopeName: "Tutorials",
  isNew: false,
  unchanged: 4,
  rows: [cell("cell|TD|5|MATH001")],
};

describe("what there is to decide", () => {
  it("counts both halves of the workbook as one set of decisions", () => {
    const payload = preview([BLOCK], [placement({})]);
    expect(countDecisions(payload)).toBe(2);
    expect(allKeys(payload)).toEqual(["cell|TD|5|MATH001", "place|A1|TD"]);
  });

  it("leaves out a block whose rows all agree, rather than showing an empty card", () => {
    const agreeing: ReferenceBlock = { ...BLOCK, scopeCode: "CM", rows: [] };
    expect(blocksWithDecisions([BLOCK, agreeing]).map((block) => block.scopeCode)).toEqual(["TD"]);
  });
});

describe("posting back only what was ticked", () => {
  it("sends nothing when nothing is ticked", () => {
    // The whole point: an upload that has not been approved changes nothing.
    expect(operationsFrom(preview([BLOCK], [placement({})]), new Set())).toEqual([]);
  });

  it("sends the ticked rows exactly as they arrived, operation and all", () => {
    const payload = preview([BLOCK], [placement({})]);
    const sent = operationsFrom(payload, new Set(["cell|TD|5|MATH001"]));

    expect(sent).toEqual([BLOCK.rows[0]]);
    expect(sent[0].op).toBe("setCell");
  });

  it("leaves an unticked correction alone while applying its neighbour", () => {
    const payload = preview(
      [{ ...BLOCK, rows: [cell("cell|TD|5|MATH001"), cell("cell|TD|6|MATH001")] }],
      [],
    );
    const sent = operationsFrom(payload, new Set(["cell|TD|6|MATH001"]));
    expect(sent.map((operation) => operation.key)).toEqual(["cell|TD|6|MATH001"]);
  });

  it("carries placements across too, since they came from the same file", () => {
    const payload = preview([BLOCK], [placement({ studentId: "A2" })]);
    const sent = operationsFrom(payload, new Set(["place|A2|TD"]));
    expect(sent.map((operation) => operation.op)).toEqual(["place"]);
  });
});

describe("the placements, arranged the way they are read", () => {
  it("groups them by block, blocks in order", () => {
    const rows = [
      placement({ studentId: "A1", scopeCode: "TD" }),
      placement({ studentId: "A2", scopeCode: "CM" }),
    ];
    expect(placementsByBlock(rows).map((entry) => entry.scopeCode)).toEqual(["CM", "TD"]);
  });

  it("puts the students already sitting somewhere else first", () => {
    // A move is the row with consequences; a student nobody has placed is not.
    const rows = [
      placement({ studentId: "A1" }),
      placement({ studentId: "A2", status: "moved", before: "3" }),
    ];
    expect(placementsByBlock(rows)[0].rows.map((row) => row.studentId)).toEqual(["A2", "A1"]);
  });

  it("counts only the ticked moves as students who would change group", () => {
    const rows = [
      placement({ studentId: "A1", status: "moved", before: "3" }),
      placement({ studentId: "A2", status: "moved", before: "4" }),
      placement({ studentId: "A3" }),
    ];
    expect(studentsMoved(rows, new Set(["place|A1|TD", "place|A3|TD"]))).toBe(1);
  });

  it("counts one student moved in two blocks once", () => {
    const rows = [
      placement({ studentId: "A1", scopeCode: "TD", status: "moved", before: "3" }),
      placement({ studentId: "A1", scopeCode: "CM", status: "moved", before: "1" }),
    ];
    expect(studentsMoved(rows, new Set(["place|A1|TD", "place|A1|CM"]))).toBe(1);
  });
});
