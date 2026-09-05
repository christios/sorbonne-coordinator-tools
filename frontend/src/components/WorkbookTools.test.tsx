import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookTools } from "@/components/WorkbookTools";
import * as database from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";
import type { WorkbookPreview } from "@/services/workbookReview";

const COHORT: database.Cohort = {
  id: "cohort-1", name: "Foundation Year", term: "S1 2026-27", notes: "", program: "", yearLevel: "",
  memberCount: 0, scopeCount: 1, createdAt: "", updatedAt: "",
};
const TERMS = [{ id: "term-1", name: "Semester 1" } as TimetableTerm];

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

beforeEach(() => {
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
});

afterEach(() => vi.restoreAllMocks());

describe("the workbook upload", () => {
  it("writes nothing on upload — it hands back what the workbook would change, for review", async () => {
    const check = vi.spyOn(database, "previewWorkbook").mockResolvedValue(PREVIEW);
    const apply = vi.spyOn(database, "applyWorkbook");
    const onPreview = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkbookTools open cohorts={[COHORT]} terms={TERMS} onClose={() => {}} onPreview={onPreview} />
      </QueryClientProvider>,
    );

    const input = (await screen.findByText("Upload workbook")).closest("label")!.querySelector("input") as HTMLInputElement;
    const file = new File(["x"], "FYS-Groups.xlsx");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(check).toHaveBeenCalledWith("cohort-1", "term-1", file));
    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(PREVIEW, COHORT, "term-1"));
    expect(apply).not.toHaveBeenCalled();
  });
});
