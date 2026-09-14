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
});
