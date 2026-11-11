import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ScheduleEditor } from "./ScheduleEditor";
import { scheduleOrder } from "@/services/syllabusContent";

describe("ScheduleEditor", () => {
  it("marks with a red asterisk what a session needs before the syllabus can go for review", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[{ id: "session-1", sessionType: "CM", week: "1", topic: "Climate governance", preClass: "", assessments: "" }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Expand topic: Climate governance (position 1)" }));

    // Required: type, week, topic and details (Christian's checklist, 10 Nov 2026).
    const marked = (label: string) => screen.queryAllByText((_, element) => {
      const text = element?.textContent?.trim() ?? "";
      return element?.tagName === "SPAN" && text.startsWith(label) && text.endsWith("*") && text.length <= label.length + 3;
    }).length > 0;
    for (const label of ["Session type", "Week", "Length (hours)", "Topic", "Session details"]) expect(marked(label), label).toBe(true);
    // Every contact-hour row of the template has a session type that adds up to it.
    fireEvent.click(screen.getByRole("combobox", { name: "Session 1 type" }));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "CM — Cours magistral", "TD — Travaux dirigés", "TP — Travaux pratiques", "Workshop", "Seminar", "Other",
    ]);
    expect(marked("Pre-class learning activities")).toBe(false);
    // The asterisk is for the eye only: the field's name stays its label.
    expect(screen.getByRole("textbox", { name: "Topic" })).toBeTruthy();
    expect(screen.getByLabelText("Pre-class learning activities")).toBeTruthy();
  });

  it("shows each closed session's week and length, the hours the document adds up", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[
        { id: "session-1", sessionType: "CM", week: "1", duration: "1,5", topic: "Climate governance", preClass: "", assessments: "" },
        { id: "session-2", sessionType: "TD", week: "", topic: "Problem solving", preClass: "", assessments: "" },
      ]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByText("Week 1 · 1.5 h")).toBeTruthy();
    expect(screen.getByText("No week set · No length set")).toBeTruthy();
  });

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
    expect(screen.getByLabelText(/^Week\*?$/)).toHaveProperty("value", "1");
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
    expect(screen.getByLabelText(/^Topic\*?$/)).toBeTruthy();
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
    expect(screen.getByLabelText(/^Topic\*?$/).tagName).toBe("TEXTAREA");
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
      const warning = screen.getByRole("alert");
      expect(warning.textContent).toContain("Give it a week");
      expect(screen.getByLabelText("Graded activity 1")).toBeTruthy();
      // What it is comes first, then when; the warning sits on the week's line, above the outcomes.
      const order = (text: string) => screen.getByText(text, { selector: "span" });
      expect(order("Assessment type").compareDocumentPosition(order("Week")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(warning.compareDocumentPosition(screen.getByRole("combobox", { name: "Add CLO assessed by assessment 1" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("in the Foundation Year, a graded card names the row of the form it fills and the outcomes it measures by number", async () => {
    const onChange = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ScheduleEditor
      rows={[{ id: "q1", kind: "graded", week: "2", name: "", type: "" }]}
      onChange={onChange}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
      holdsGradedActivities
      foundationYear
      outcomes={[{ id: "fys-clo-1", clo: "Solve equations." }, { id: "fys-clo-2", clo: "Sketch functions." }]}
    /></QueryClientProvider>);

    expect(screen.queryByText("Applicable AI policy")).toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Graded activity 1 row of the form" }));
    fireEvent.click(await screen.findByRole("option", { name: "Final assessment" }));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "q1", component: "final" })]);

    fireEvent.click(screen.getByRole("combobox", { name: "Add a CLO graded activity 1 measures" }));
    fireEvent.click(await screen.findByRole("option", { name: /CLO 2: Sketch functions/ }));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "q1", cloNumbers: ["2"] })]);
  });

  it("unfolds a card asked for from the list of what is still to fill in", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rows: Array<Record<string, string> & { id: string }> = [
      { id: "session-1", sessionType: "CM", week: "1", topic: "Rays", duration: "1.5" },
      { id: "essay", kind: "graded", name: "Essay", type: "Essay", week: "", weight: "40" },
    ];
    const props = { rows, onChange: vi.fn(), syllabusId: "syllabus-1", revision: 1, onOpenHistory: vi.fn(), holdsGradedActivities: true };
    const { rerender } = render(<QueryClientProvider client={queryClient}><ScheduleEditor {...props} /></QueryClientProvider>);

    // Named, so folded.
    expect(screen.getByRole("button", { name: /Expand graded activity: Essay/ }).getAttribute("aria-expanded")).toBe("false");

    rerender(<QueryClientProvider client={queryClient}><ScheduleEditor {...props} reveal={{ id: "essay", count: 1 }} /></QueryClientProvider>);

    expect(screen.getByRole("button", { name: /Collapse graded activity: Essay/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("switches an open card between a session and a graded activity", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    const rows: Array<Record<string, string> & { id: string }> = [
      { id: "essay", kind: "graded", name: "Essay", type: "Essay", week: "4", weight: "40" },
    ];
    render(<QueryClientProvider client={queryClient}><ScheduleEditor rows={rows} onChange={onChange} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} holdsGradedActivities reveal={{ id: "essay", count: 1 }} /></QueryClientProvider>);

    const kind = screen.getByRole("group", { name: "Kind of card: Essay" });
    expect(kind.querySelector("[aria-pressed=true]")?.textContent).toBe("Graded activity");
    fireEvent.click(screen.getByRole("button", { name: "Session" }));

    const [[card]] = onChange.mock.calls[0];
    expect(card.kind).toBeUndefined();
    expect(card).toMatchObject({ id: "essay", topic: "Essay", week: "4", weight: "40" });
  });

  it("keeps the cards where they were when one switches kind, until a week changes", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let rows: Array<Record<string, string> & { id: string }> = [
      { id: "a", topic: "Rays", week: "" },
      { id: "b", topic: "Mirrors", week: "" },
      { id: "c", topic: "Prisms", week: "" },
    ];
    const titles = () => Array.from(document.querySelectorAll("article[id^=schedule-]")).map((card) => card.querySelector(":scope > div > button[aria-expanded]")?.getAttribute("aria-label")?.replace(/^(Expand|Collapse) /, ""));
    const show = () => <QueryClientProvider client={queryClient}><ScheduleEditor rows={rows} onChange={(next) => { rows = next; }} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} holdsGradedActivities reveal={{ id: "a", count: 1 }} /></QueryClientProvider>;
    const { rerender } = render(show());

    // Undated, a graded activity belongs after every session: it stays put all the same.
    fireEvent.click(screen.getByRole("group", { name: "Kind of card: Rays" }).querySelector("button[aria-pressed=false]")!);
    rerender(show());
    expect(titles()).toEqual(["graded activity: Rays", "topic: Mirrors (position 2)", "topic: Prisms (position 3)"]);

    // Once a week changes, the schedule is in week order again.
    rows = rows.map((row) => (row.id === "c" ? { ...row, week: "1" } : row));
    rerender(show());
    expect(titles()).toEqual(["topic: Prisms (position 1)", "topic: Mirrors (position 2)", "graded activity: Rays"]);
  });
});
