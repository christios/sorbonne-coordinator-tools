import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneField, ProfileOverview, RequisitionDetails, RequisitionHistory, RequisitionReview, TeacherAvatar, TeacherRequisitionEditor } from "./TeacherDatabase";

const teacherService = vi.hoisted(() => ({
  getTeacherRequisition: vi.fn(),
  getTeacher: vi.fn(),
  listCourseCatalogue: vi.fn(),
  updateTeacherRequisition: vi.fn(),
}));

vi.mock("@/services/teachers", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/services/teachers")>(),
  getTeacherRequisition: teacherService.getTeacherRequisition,
  getTeacher: teacherService.getTeacher,
  listCourseCatalogue: teacherService.listCourseCatalogue,
  updateTeacherRequisition: teacherService.updateTeacherRequisition,
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ProfileOverview", () => {
  it("shows profile information until the coordinator chooses to edit it", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfileOverview
        teacher={{
          id: "teacher-private-id",
          folderId: null,
          fullName: "Marie Curie",
          email: "marie@example.edu",
          phone: "+33 1 23 45 67 89",
          notes: "Available for physics modules.",
          archivedAt: null,
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        }}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("marie@example.edu")).toBeTruthy();
    expect(screen.getByText("Available for physics modules.")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Full name" })).toBeNull();
    expect(screen.queryByText(/Internal ID/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Full name" }), { target: { value: "Marie Skłodowska-Curie" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      fullName: "Marie Skłodowska-Curie",
      email: "marie@example.edu",
      phone: "+33 1 23 45 67 89",
      notes: "Available for physics modules.",
    }));
  });
});

describe("TeacherAvatar", () => {
  it("provides an accessible profile photo placeholder for a teacher", () => {
    render(<TeacherAvatar fullName="Marie Curie" />);

    expect(screen.getByRole("img", { name: "Profile photo placeholder for Marie Curie" })).toBeTruthy();
  });
});

describe("PhoneField", () => {
  it("uses the searchable country-code combobox from Zenith alongside a telephone input", () => {
    const onChange = vi.fn();
    render(<PhoneField value="" onChange={onChange} />);

    fireEvent.click(screen.getByRole("combobox", { name: "Country code" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search country" }), { target: { value: "France" } });
    fireEvent.click(screen.getByRole("option", { name: /France \+33/i }));

    const phoneNumber = screen.getByRole("textbox", { name: "Phone number" });
    expect(phoneNumber.getAttribute("type")).toBe("tel");
    fireEvent.change(phoneNumber, { target: { value: "1 23 45 67 89" } });

    expect(onChange).toHaveBeenLastCalledWith("+33 1 23 45 67 89");
  });
});

describe("RequisitionHistory", () => {
  it("opens a requisition when the coordinator clicks anywhere on its card outside its controls", () => {
    const onOpen = vi.fn();
    render(
      <RequisitionHistory
        requisitions={[{ id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z" }]}
        onOpen={onOpen}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        deleting={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Semester 1" }));

    expect(onOpen).toHaveBeenCalledWith("request-1");
  });

  it("shows outlined requisition items and filters them by label or academic year", () => {
    render(
      <RequisitionHistory
        requisitions={[
          { id: "request-1", teacherId: "teacher-1", label: "Physics lab", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z" },
          { id: "request-2", teacherId: "teacher-1", label: "Calculus tutorial", academicYear: "2027-2028", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z" },
        ]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        deleting={false}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Physics lab").closest("article")?.className).toContain("border");

    fireEvent.change(screen.getByRole("searchbox", { name: "Search requisitions" }), { target: { value: "2027-2028" } });

    expect(screen.queryByText("Physics lab")).toBeNull();
    expect(screen.getByText("Calculus tutorial")).toBeTruthy();
  });

  it("lets the coordinator rename a requisition directly from its history card", async () => {
    const onRename = vi.fn();
    render(
      <RequisitionHistory
        requisitions={[{ id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z" }]}
        onOpen={vi.fn()}
        onRename={onRename}
        onDelete={vi.fn()}
        deleting={false}
      />,
    );

    fireEvent.click(screen.getByText("Semester 1"));
    fireEvent.change(screen.getByRole("textbox", { name: "Requisition title" }), { target: { value: "Semester 1 tutorial" } });
    fireEvent.blur(screen.getByRole("textbox", { name: "Requisition title" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("request-1", "Semester 1 tutorial"));
    expect(screen.queryByRole("button", { name: "Save title" })).toBeNull();
  });
});

describe("RequisitionDetails", () => {
  it("marks every request-detail control as required with a visible red marker", () => {
    render(<RequisitionDetails content={{ department: "", program: "", jobTitle: "", classType: "", employeeType: "PT", contractFrom: "", contractTo: "", courses: [] }} onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Hiring department" })).toHaveProperty("required", true);
    expect(screen.getByRole("combobox", { name: "Programme" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Job title" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Type of class" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("button", { name: "Contract from" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("button", { name: "Contract to" }).getAttribute("aria-required")).toBe("true");
    const requiredMarkers = screen.getAllByText("*", { selector: "span[aria-hidden='true']" });
    expect(requiredMarkers).toHaveLength(6);
    requiredMarkers.forEach((marker) => expect(marker.className).toContain("text-[#a6292f]"));
  });
});

describe("TeacherRequisitionEditor", () => {
  it("edits the requisition title inline and returns to text when focus leaves", async () => {
    const requisition = { id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z", content: { department: "Science", program: "Foundation year in Sciences", jobTitle: "Part Time Lecturer", classType: "TD", employeeType: "PT" as const, contractFrom: "2026-09-01", contractTo: "2026-12-20", courses: [{ id: "course-1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "24" }] } };
    teacherService.getTeacherRequisition.mockResolvedValue(requisition);
    teacherService.getTeacher.mockResolvedValue({ id: "teacher-1", fullName: "Sachin Valera" });
    teacherService.listCourseCatalogue.mockResolvedValue([]);

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TeacherRequisitionEditor requisitionId="request-1" teacherId="teacher-1" onBack={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Semester 1" }));
    const title = screen.getByRole("textbox", { name: "Requisition title" });
    fireEvent.change(title, { target: { value: "Semester 1 tutorial" } });
    fireEvent.blur(title);

    expect(screen.queryByRole("textbox", { name: "Requisition title" })).toBeNull();
    expect(screen.getByRole("button", { name: "Semester 1 tutorial" })).toBeTruthy();
  });

  it("autosaves edits and replaces the manual save action with the syllabus-style status", async () => {
    const requisition = { id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z", content: { department: "Science", program: "Foundation year in Sciences", jobTitle: "Part Time Lecturer", classType: "TD", employeeType: "PT" as const, contractFrom: "2026-09-01", contractTo: "2026-12-20", courses: [{ id: "course-1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "24" }] } };
    teacherService.getTeacherRequisition.mockResolvedValue(requisition);
    teacherService.getTeacher.mockResolvedValue({ id: "teacher-1", fullName: "Sachin Valera" });
    teacherService.listCourseCatalogue.mockResolvedValue([]);
    teacherService.updateTeacherRequisition.mockImplementation(async (input) => ({ ...input, revision: 2, updatedAt: "2026-07-24T09:00:00Z" }));

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TeacherRequisitionEditor requisitionId="request-1" teacherId="teacher-1" onBack={vi.fn()} /></QueryClientProvider>);

    const academicYear = await screen.findByRole("textbox", { name: "Academic year" });
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    fireEvent.change(academicYear, { target: { value: "2027-2028" } });
    expect(screen.getByText("Saved")).toBeTruthy();

    await waitFor(() => expect(teacherService.updateTeacherRequisition).toHaveBeenCalledWith(expect.objectContaining({ academicYear: "2027-2028", revision: 1 })), { timeout: 1500 });
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("takes export validation to the missing teaching-load field", async () => {
    const requisition = { id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z", content: { department: "Science", program: "Foundation year in Sciences", jobTitle: "Part Time Lecturer", classType: "TD", employeeType: "PT" as const, contractFrom: "2026-09-01", contractTo: "2026-12-20", courses: [{ id: "course-1", title: "", subjectCode: "PHY", courseNumber: "101", level: "", hours: "24" }] } };
    teacherService.getTeacherRequisition.mockResolvedValue(requisition);
    teacherService.getTeacher.mockResolvedValue({ id: "teacher-1", fullName: "Sachin Valera" });
    teacherService.listCourseCatalogue.mockResolvedValue([]);

    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TeacherRequisitionEditor requisitionId="request-1" teacherId="teacher-1" onBack={vi.fn()} /></QueryClientProvider>);

    await screen.findByRole("button", { name: "Export DOCX" });
    fireEvent.click(screen.getByRole("button", { name: "Export DOCX" }));

    const courseTitle = await screen.findByRole("textbox", { name: "Course title as per Sorbonne Space" });
    await waitFor(() => expect(document.activeElement).toBe(courseTitle));
  });
});

describe("RequisitionReview", () => {
  it("summarises the teacher, request details, load, and export readiness", () => {
    render(<RequisitionReview teacherName="Sachin Valera" requisition={{ id: "request-1", teacherId: "teacher-1", label: "Semester 1", academicYear: "2026-2027", revision: 1, createdAt: "2026-07-24T08:00:00Z", updatedAt: "2026-07-24T08:00:00Z", content: { department: "Science", program: "Foundation year in Sciences", jobTitle: "Part Time Lecturer", classType: "TD", employeeType: "PT", contractFrom: "2026-09-01", contractTo: "2026-12-20", courses: [{ id: "course-1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "24" }] } }} totalHours={24} />);

    expect(screen.getByText("Sachin Valera")).toBeTruthy();
    expect(screen.getByText("1 course · 24 hours")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Ready to export");
  });
});
