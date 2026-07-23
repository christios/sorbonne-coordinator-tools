import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AssessmentTabs } from "./AssessmentTabs";

describe("AssessmentTabs", () => {
  it("shows one focused assessment editor at a time", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentTabs value={{}} outcomes={[]} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByText("Summary of graded learning activities")).toBeTruthy();
    expect(screen.queryByText("Grading rubrics")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Grading criteria" }));
    expect(screen.getByText("Grading rubrics")).toBeTruthy();
    expect(screen.queryByText("Summary of graded learning activities")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "AI policy" }));
    expect(screen.getByText("Course-level policy")).toBeTruthy();
    expect(screen.queryByText("Grading rubrics")).toBeNull();
  });
});
