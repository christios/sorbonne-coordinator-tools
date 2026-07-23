import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { AcademicContactsEditor } from "./AcademicContactsEditor";

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
});
