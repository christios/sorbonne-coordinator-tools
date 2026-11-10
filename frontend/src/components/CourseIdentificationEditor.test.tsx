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

  it("asks for no contact hours: the course schedule adds them up", () => {
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

    // Since 10 Nov 2026 the hours come from the course schedule: no boxes here to type them in.
    expect(screen.queryByRole("spinbutton", { name: "Lectures" })).toBeNull();
    expect(screen.getByText(/Contact hours are added up from the course schedule/)).toBeTruthy();
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
    expect(screen.getByRole("heading", { name: "Credits" })).toBeTruthy();
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
  it("opens the course list ready to search on a syllabus just started, and only then", () => {
    const course = { courseCode: "PHYS-118", courseTitle: "Geometric Optics", credit: "6", level: "L1", department: "SCEN", college: "", contactHours: "", terms: [], crns: [], teachers: [] };
    const show = (courseTitle: string) => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(<QueryClientProvider client={queryClient}><CourseIdentificationEditor
        value={{}}
        courseTitle={courseTitle}
        courseCode=""
        academicYear="2026-2027"
        courses={[course]}
        onChange={vi.fn()}
        onMetadataChange={vi.fn()}
        syllabusId="syllabus-1"
        revision={1}
        onOpenHistory={vi.fn()}
      /></QueryClientProvider>);
    };

    const started = show("Untitled syllabus");
    expect(screen.getByRole("listbox", { name: "Course" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search Course" })).toBeTruthy();
    started.unmount();

    show("Geometric Optics");
    expect(screen.queryByRole("listbox", { name: "Course" })).toBeNull();
  });
});
