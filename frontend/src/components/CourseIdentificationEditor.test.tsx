import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { CourseIdentificationEditor } from "./CourseIdentificationEditor";

describe("CourseIdentificationEditor", () => {
  it("keeps a legacy prerequisite readable now that prerequisites are chosen courses", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{ prerequisites: "Foundational statistics", equipment: "Laptop computer" }}
      courseTitle="Climate Change Law"
      courseCode="PA585"
      academicYear="2026-2027"
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // Prerequisites are now picked from the course catalogue, so a legacy free-text
    // value is shown as a selected entry rather than an editable box.
    expect(screen.getByText("Foundational statistics")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Foundational statistics from prerequisites" })).toBeTruthy();
    expect(screen.getByLabelText("Equipment 1")).toHaveProperty("value", "Laptop computer");
    expect(screen.getByRole("button", { name: "Add equipment item" })).toBeTruthy();
  });

  it("gives contact hours a number stepper", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{ contactHours: { Lectures: "20" } }}
      courseTitle="Climate Change Law"
      courseCode="PA585"
      academicYear="2026-2027"
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // Arrows are wanted; HistoryTextField stops the wheel changing a focused number,
    // which is what made the old stepper feel twitchy.
    const lectures = screen.getByRole("spinbutton", { name: "Lectures" });
    expect(lectures.getAttribute("type")).toBe("number");
    expect(lectures.getAttribute("step")).toBe("1");
    expect(lectures).toHaveProperty("value", "20");
  });

  it("groups course-identification fields into named subsections", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{}}
      courseTitle="Climate Change Law"
      courseCode="PA585"
      academicYear="2026-2027"
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByRole("heading", { name: "Course details" })).toBeTruthy();
    // The programme sits with the course it belongs to, and the credit with the hours it counts.
    expect(screen.getByRole("heading", { name: "Credits and contact hours" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Requirements and equipment" })).toBeTruthy();
  });
});

describe("Course details taken from the other app", () => {
  it("offers the academic year and the level, keeping whatever the syllabus already says", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{ degreeLevelAndSemester: "L1-S1" }}
      courseTitle="Geometric Optics"
      courseCode="PHYS-118"
      academicYear="2024-2025"
      academicYears={["2026-2027", "2025-2026"]}
      semesters={["L1-S1", "L1-S2"]}
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // A year the imported terms no longer list must stay selectable, or opening an
    // older syllabus would silently change what it says.
    expect(screen.getByRole("combobox", { name: "Academic year" }).textContent).toContain("2024-2025");
    expect(screen.getByRole("combobox", { name: "Degree level and semester" }).textContent).toContain("L1-S1");
  });

  it("asks for the programme as a required choice, with no local-outcomes way out", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{}}
      courseTitle="Geometric Optics"
      courseCode="PHYS-118"
      academicYear="2026-2027"
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      programmes={[{ value: "programme-physics", label: "Bachelor in Physics" }]}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    // The label's row reads "Programme" followed by the required star, with no "(optional)".
    const field = screen.getByRole("combobox", { name: "Programme" }).closest("div.grid");
    expect(field?.textContent).toMatch(/^Programme\s*\*/);
    expect(field?.textContent).not.toContain("optional");
    expect(screen.queryByText("Use local programme learning outcomes")).toBeNull();
    // With a programme catalogue and nothing typed before, there is no free-text box.
    expect(screen.queryByLabelText("Programme title")).toBeNull();
  });

  it("keeps an older syllabus's typed programme title readable", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
      value={{ programmeTitle: "Bachelor in Physics" }}
      courseTitle="Geometric Optics"
      courseCode="PHYS-118"
      academicYear="2026-2027"
      onChange={vi.fn()}
      onMetadataChange={vi.fn()}
      programmes={[{ value: "programme-physics", label: "Bachelor in Physics" }]}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByLabelText(/^Programme title\*?$/)).toHaveProperty("value", "Bachelor in Physics");
  });
});
