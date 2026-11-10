import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ScheduleEditor } from "./ScheduleEditor";
import { scheduleOrder } from "@/services/syllabusContent";

describe("ScheduleEditor", () => {
  it("keeps sessions compact until one is opened", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[{ id: "session-1", sessionType: "CM", week: "1", topic: "Climate governance", preClass: "Read the assigned chapter.", assessments: "" }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByText("Climate governance")).toBeTruthy();
    expect(screen.getByLabelText("Session CM 1")).toBeTruthy();
    expect(screen.queryByLabelText("Pre-class learning activities")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand topic: Climate governance (position 1)" }));

    expect(screen.getByLabelText("Pre-class learning activities")).toBeTruthy();
    expect(screen.getByLabelText("Week")).toHaveProperty("value", "1");
    expect(screen.getByText("Session type")).toBeTruthy();
    expect(screen.queryByLabelText("Session")).toBeNull();
  });

  it("opens a blank session so its fields are ready to complete", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[{ id: "session-blank", sessionType: "CM", week: "", topic: "", preClass: "", assessments: "" }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByRole("button", { name: "Collapse topic: Untitled topic (position 1)" })).toBeTruthy();
    expect(screen.getByLabelText("Topic")).toBeTruthy();
  });

  it("keeps the session title concise and provides a separate details field with an end-of-list add action", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[{ id: "session-1", sessionType: "CM", week: "", topic: "Climate governance", preClass: "", assessments: "" }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Expand topic: Climate governance (position 1)" }));

    // A topic is one line that wraps rather than scrolling, so it is a growing box.
    expect(screen.getByLabelText("Topic").tagName).toBe("TEXTAREA");
    // Session details is written with formatting, in an editor rather than a plain box.
    expect(screen.getByRole("textbox", { name: "Session details" }).getAttribute("contenteditable")).toBe("true");
    expect(screen.getByRole("button", { name: "Add session at end" })).toBeTruthy();
  });

  describe("once the schedule holds the graded activities", () => {
    const wrap = (node: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;

    it("reads by week: a week's sessions as placed, then its graded activities by date", () => {
      const cards = [
        { id: "final", kind: "graded", name: "Final" },
        { id: "s2", week: "2", topic: "Mirrors" },
        { id: "quiz", kind: "graded", week: "1", name: "Quiz", date: "2026-09-11" },
        { id: "lab", kind: "graded", week: "1", name: "Lab report" },
        { id: "s1", week: "1", topic: "Rays" },
        { id: "s1b", week: "1", topic: "Ray exercises" },
      ];

      expect(scheduleOrder(cards).map((card) => card.id)).toEqual(["s1", "s1b", "quiz", "lab", "s2", "final"]);
    });

    it("adds a graded activity as a card of its own, asking for its week", () => {
      const onChange = vi.fn();
      render(wrap(<ScheduleEditor rows={[]} onChange={onChange} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} holdsGradedActivities />));

      fireEvent.click(screen.getByRole("button", { name: "Add graded activity" }));

      const [cards] = onChange.mock.calls[0];
      expect(cards).toEqual([expect.objectContaining({ kind: "graded", week: "", date: "" })]);
    });

    it("shows a graded card's fields and asks for the week it is missing", () => {
      render(wrap(<ScheduleEditor
        rows={[{ id: "quiz", kind: "graded", name: "Quiz", week: "", date: "" }]}
        onChange={vi.fn()}
        syllabusId="syllabus-1"
        revision={1}
        onOpenHistory={vi.fn()}
        holdsGradedActivities
      />));

      fireEvent.click(screen.getByRole("button", { name: "Expand graded activity: Quiz" }));

      expect(screen.getByLabelText("Assessment date (optional)")).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toContain("Give it a week");
      expect(screen.getByLabelText("Graded activity 1")).toBeTruthy();
    });

    it("drops a session's deadline and assessment boxes, keeping an older note until it is removed", () => {
      const onChange = vi.fn();
      render(wrap(<ScheduleEditor
        rows={[{ id: "s1", week: "1", topic: "Rays", deadline: "End of week 1", assessments: "Quiz 1" }]}
        onChange={onChange}
        syllabusId="syllabus-1"
        revision={1}
        onOpenHistory={vi.fn()}
        holdsGradedActivities
      />));

      fireEvent.click(screen.getByRole("button", { name: "Expand topic: Rays (position 1)" }));

      expect(screen.queryByText("Deadline", { selector: "span" })).toBeNull();
      expect(screen.queryByLabelText("Assessments")).toBeNull();
      expect(screen.getByRole("note").textContent).toContain("Quiz 1");
      fireEvent.click(screen.getByRole("button", { name: "Remove note" }));
      expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: "s1", assessments: "", deadline: "" })]);
    });
  });
});
