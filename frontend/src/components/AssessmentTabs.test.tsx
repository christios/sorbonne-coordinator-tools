import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AssessmentTabs } from "./AssessmentTabs";
import { FieldHistoryProvider } from "./FieldHistory";
import { AssessmentItemsEditor } from "./StructuredEntryEditors";

describe("AssessmentTabs", () => {
  it("shows one focused assessment editor at a time", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentTabs value={{ aiPolicy: "AI Permitted as a Support Tool", aiOtherUse: "Use a transcription tool" }} outcomes={[]} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByText("Summary of graded learning activities")).toBeTruthy();
    expect(screen.queryByText("Grading rubrics")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Grading criteria" }));
    expect(screen.getByText("Grading rubrics")).toBeTruthy();
    expect(screen.queryByText("Summary of graded learning activities")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "AI policy" }));
    expect(screen.getByText("Course-level policy")).toBeTruthy();
    expect(screen.getByText("Other permitted uses")).toBeTruthy();
    expect(screen.getByLabelText("Other permitted use 1")).toHaveProperty("value", "Use a transcription tool");
    expect(screen.getByRole("button", { name: "Add permitted use" })).toBeTruthy();
    expect(screen.queryByText("Grading rubrics")).toBeNull();
  });

  it("anchors the CLO history action to the CLO section header, not an outcome row", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <FieldHistoryProvider enabled source={{ resourceType: "syllabus", resourceId: "syllabus-1", revision: 1, loadHistory: vi.fn().mockResolvedValue([]) }}>
          <AssessmentItemsEditor
            value={{ items: [{ id: "assessment-1" }] }}
            outcomes={[{ id: "clo-1", clo: "Explain the scientific method." }]}
            onChange={vi.fn()}
            syllabusId="syllabus-1"
            revision={1}
            onOpenHistory={vi.fn()}
          />
        </FieldHistoryProvider>
      </QueryClientProvider>,
    );

    const historyAction = screen.getByRole("button", { name: "View edit history for Assessment 1 · CLOs assessed" });
    expect(historyAction.parentElement?.parentElement?.tagName).toBe("DETAILS");
  });
});
