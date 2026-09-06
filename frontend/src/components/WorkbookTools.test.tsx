import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkbookTools } from "@/components/WorkbookTools";
import * as database from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

const COHORT: database.Cohort = {
  id: "cohort-1", name: "Foundation Year", term: "S1 2026-27", notes: "", majors: [], terms: [], yearLevel: "", workbookTab: "", firstSemester: 0,
  memberCount: 0, scopeCount: 1, createdAt: "", updatedAt: "",
};
const TERMS = [{ id: "term-1", name: "Semester 1" } as TimetableTerm];


beforeEach(() => {
  vi.spyOn(database, "fetchCatalogue").mockResolvedValue({ scopes: [] });
});

afterEach(() => vi.restoreAllMocks());

describe("the workbook tools", () => {
  it("offers the two exports, and no way to read a workbook back in", async () => {
    const check = vi.spyOn(database, "previewWorkbook");
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <WorkbookTools open cohorts={[COHORT]} terms={TERMS} onClose={() => {}} />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Export workbook/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Admissions list/ })).toBeTruthy();
    /*
     * Upload is off. It matched a file's sets by code and created what it could not
     * match, so a set renamed since the file was written came back as a second set with
     * the students moved into it.
     */
    expect(screen.queryByText("Upload workbook")).toBeNull();
    expect(screen.getByText(/Reading a workbook back in is off/)).toBeTruthy();
    expect(check).not.toHaveBeenCalled();
  });
});
