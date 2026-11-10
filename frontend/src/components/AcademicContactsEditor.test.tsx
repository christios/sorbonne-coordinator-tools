import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AcademicContactsEditor } from "./AcademicContactsEditor";
import type { CatalogueEntry } from "@/services/syllabusCatalogues";

describe("AcademicContactsEditor", () => {
  it("turns affiliations into a list and structures office hours", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AcademicContactsEditor
      value={{ instructor: { "Affiliation(s)": "Sorbonne University Abu Dhabi", officeHours: [{ id: "office-1", day: "Tuesday", startTime: "10:00", endTime: "12:00", location: "Room 101" }] } }}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByLabelText("Affiliation 1")).toHaveProperty("value", "Sorbonne University Abu Dhabi");
    expect(screen.getByRole("button", { name: "Add affiliation" })).toBeTruthy();
    expect(screen.getByText("Tuesday · 10:00–12:00 · Room 101")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Office hour 1/ }));
    expect(screen.getByRole("combobox", { name: "Office hour 1 day" })).toBeTruthy();
    expect(screen.getByLabelText("Location")).toHaveProperty("value", "Room 101");
  });

  it("offers everyone in the People directory as coordinator, coordinators first, with no manual entry", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const people: CatalogueEntry[] = [
      { id: "p-instructor", category: "people", parentId: null, label: "Dr Instructor", payload: { roles: ["instructor"] }, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
      { id: "p-retired", category: "people", parentId: null, label: "Dr Retired", payload: { roles: ["coordinator"] }, sortOrder: 0, isRetired: true, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
      { id: "p-coordinator", category: "people", parentId: null, label: "Dr Coordinator", payload: { roles: ["coordinator"] }, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
    ];
    render(<QueryClientProvider client={queryClient}><AcademicContactsEditor
      value={{}}
      people={people}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("combobox", { name: "Academic coordinator" }));
    const listbox = await screen.findByRole("listbox", { name: "Academic coordinator" });
    const names = within(listbox).getAllByRole("option").map((option) => option.textContent);
    expect(names).toEqual(["Dr Coordinator", "Dr Instructor"]);
    // Nothing to type by hand any more: no manual option and no name/details boxes.
    expect(screen.queryByLabelText("Academic coordinator name")).toBeNull();
  });

  it("keeps a coordinator an older syllabus typed by hand, until someone is chosen", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><AcademicContactsEditor
      value={{ administrativeContact: { name: "Christian Khairallah", contactDetails: "christian@suad.ae" } }}
      people={[]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByLabelText("Academic coordinator name")).toHaveProperty("value", "Christian Khairallah");
  });
});
