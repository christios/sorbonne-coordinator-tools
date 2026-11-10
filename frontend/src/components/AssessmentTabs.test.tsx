import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AssessmentTabs } from "./AssessmentTabs";
import { FieldHistoryProvider } from "./FieldHistory";
import { AssessmentAiPolicyEditor, AssessmentItemsEditor } from "./StructuredEntryEditors";

describe("AssessmentTabs", () => {
  it("shows one focused assessment editor at a time", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentTabs value={{ items: [{ id: "a1", name: "Project", aiPolicy: "AI Permitted as a Support Tool" }], aiOtherUse: "Use a transcription tool" }} outcomes={[]} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByText("Summary of graded learning activities")).toBeTruthy();
    expect(screen.queryByText(/One rubric per assessment type/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Grading rubrics" }));
    expect(screen.getByText(/One rubric per assessment type/)).toBeTruthy();
    expect(screen.queryByText("Summary of graded learning activities")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "AI policy" }));
    // No course-wide choice any more: the option the activity applies is shown, open.
    expect(screen.queryByText("Course-level policy")).toBeNull();
    expect(screen.getByRole("article", { name: "AI Permitted as a Support Tool" })).toBeTruthy();
    expect(screen.getByText("Applied by Project")).toBeTruthy();
    expect(screen.getByText("Other permitted uses")).toBeTruthy();
    expect(screen.getByLabelText("Other permitted use 1")).toHaveProperty("value", "Use a transcription tool");
    expect(screen.getByRole("button", { name: "Add permitted use" })).toBeTruthy();
    expect(screen.queryByText(/One rubric per assessment type/)).toBeNull();
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

    // One history action for the whole field, anchored beside its label rather than
    // repeated against each outcome the assessment covers.
    const historyActions = screen.getAllByRole("button", { name: "View edit history for Assessment 1 · CLOs assessed" });
    expect(historyActions).toHaveLength(1);
    expect(historyActions[0].closest("[role=\"group\"]")?.getAttribute("aria-label")).toBe("CLOs assessed");
    expect(historyActions[0].closest("li")).toBeNull();
  });
});

describe("Choosing an assessment type", () => {
  it("keeps the catalogue link and the label from discarding each other", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <FieldHistoryProvider enabled source={{ resourceType: "syllabus", resourceId: "s1", revision: 1, loadHistory: vi.fn().mockResolvedValue([]) }}>
          <AssessmentItemsEditor
            value={{ items: [{ id: "a1" }] }}
            outcomes={[]}
            assessmentTypes={[
              { id: "assessment-type-1", category: "assessment-types", parentId: null, label: "Written test", payload: {}, sortOrder: 1, isRetired: false, retiredAt: null, revision: 1, createdAt: "", updatedAt: "" },
            ]}
            onChange={onChange}
            syllabusId="s1"
            revision={1}
            onOpenHistory={vi.fn()}
          />
        </FieldHistoryProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Assessment 1 type" }));
    fireEvent.click(screen.getByRole("option", { name: "Written test" }));

    // Both fields have to travel in one update: two writes off the same render
    // would leave only the second, losing the link the dropdown displays.
    const calls = onChange.mock.calls;
    const written = calls[calls.length - 1][0].items[0];
    expect(written.assessmentTypeId).toBe("assessment-type-1");
    expect(written.type).toBe("Written test");
  });

  it("shows one open section per AI option the graded activities apply, in the template's order", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentAiPolicyEditor
      value={{ items: [
        { id: "a1", name: "Essay", aiPolicy: "Other (Specify)", aiOtherText: "Translation tools for sources only" },
        { id: "a2", name: "Midterm", aiPolicy: "AI Prohibited" },
        { id: "a3", name: "Quiz", aiPolicy: "AI Prohibited" },
      ] }}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    const sections = screen.getAllByRole("article").map((section) => section.getAttribute("aria-label"));
    expect(sections).toEqual(["AI Prohibited", "Other (Specify)"]);
    expect(screen.getByText("Applied by Midterm, Quiz")).toBeTruthy();
    expect(screen.getByLabelText("Verification mechanism")).toBeTruthy();
    expect(screen.getByText("Translation tools for sources only")).toBeTruthy();
  });

  it("says what to do when no graded activity has an AI policy yet", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentAiPolicyEditor value={{ items: [{ id: "a1", name: "Quiz" }] }} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByText(/Choose an AI policy for each graded activity/)).toBeTruthy();
  });

  it("asks an activity under Other (Specify) to describe its policy, and shows an older course policy as the default", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AssessmentItemsEditor
      value={{ aiPolicy: "AI Prohibited", items: [{ id: "a1", name: "Essay", aiPolicy: "Other (Specify)" }, { id: "a2", name: "Quiz" }] }}
      outcomes={[]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // Both cards open, as new unfinished activities do.
    expect(screen.getByLabelText("Describe the AI policy for this activity")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Assessment 2 AI policy" }).textContent).toContain("From the course: AI Prohibited");
  });

  it("in Head-of-Department mode, an activity assesses the catalogue's outcomes and keeps its own picks apart", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    render(<QueryClientProvider client={queryClient}><AssessmentItemsEditor
      value={{ items: [{ id: "a1", name: "Quiz", cloIds: ["teacher-clo"], catalogueCloIds: [] }] }}
      outcomes={[{ id: "hod-1", clo: "Trace rays." }, { id: "hod-2", clo: "Image formation." }]}
      cloKey="catalogueCloIds"
      onChange={onChange}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // The teacher's own pick does not show against the catalogue's outcomes.
    expect(screen.getByText("No course outcomes selected yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("combobox", { name: "Add CLO assessed by assessment 1" }));
    fireEvent.click(await screen.findByRole("option", { name: /Image formation/ }));

    expect(onChange).toHaveBeenLastCalledWith({ items: [{ id: "a1", name: "Quiz", cloIds: ["teacher-clo"], catalogueCloIds: ["hod-2"] }] });
  });

  it("once the schedule holds the graded activities, summarises them as 9.1 and sends the teacher to the schedule to edit them", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onOpenSchedule = vi.fn();
    render(<QueryClientProvider client={queryClient}><AssessmentTabs
      value={{ methodologies: "Written tests.", lateSubmissionPolicy: "" }}
      activities={[
        { id: "g1", kind: "graded", name: "Quiz 1", week: "1", date: "2026-09-10", weight: "10", cloIds: ["clo-1"], aiPolicy: "AI Prohibited" },
        { id: "g2", kind: "graded", name: "Midterm", week: "6", weight: "40", aiPolicy: "Other (Specify)", aiOtherText: "Calculators only" },
      ]}
      holdsGradedActivities
      onOpenSchedule={onOpenSchedule}
      outcomes={[{ id: "clo-1", clo: "Trace rays." }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    const rows = screen.getAllByRole("row").slice(1).map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["10/09/2026", "Quiz 1", "10%", "CLO 1", "AI Prohibited"],
      ["Week 6", "Midterm", "40%", "—", "Other: Calculators only"],
    ]);
    // Nothing to add or edit here any more; the methodology and late policy still are.
    expect(screen.queryByRole("button", { name: "Add assessment" })).toBeNull();
    expect(screen.getByLabelText("Assessment methodologies")).toHaveProperty("value", "Written tests.");
    fireEvent.click(screen.getByRole("button", { name: "Edit in the course schedule" }));
    expect(onOpenSchedule).toHaveBeenCalledOnce();
  });
});
