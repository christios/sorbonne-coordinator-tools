import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PhoneField, ProfileOverview, RequisitionDetails, RequisitionHistory, TeacherAvatar } from "./TeacherDatabase";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });

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

    fireEvent.click(screen.getByRole("button", { name: "Edit title Semester 1" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Requisition title" }), { target: { value: "Semester 1 tutorial" } });
    fireEvent.click(screen.getByRole("button", { name: "Save title" }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith("request-1", "Semester 1 tutorial"));
  });
});

describe("RequisitionDetails", () => {
  it("marks every request-detail control as required", () => {
    render(<RequisitionDetails content={{ department: "", program: "", jobTitle: "", classType: "", employeeType: "PT", contractFrom: "", contractTo: "", courses: [] }} onChange={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "Hiring department" })).toHaveProperty("required", true);
    expect(screen.getByRole("combobox", { name: "Programme" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Job title" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Type of class" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("button", { name: "Contract from" }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("button", { name: "Contract to" }).getAttribute("aria-required")).toBe("true");
  });
});
