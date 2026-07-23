import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { CourseIdentificationEditor } from "./CourseIdentificationEditor";

describe("CourseIdentificationEditor", () => {
  it("preserves legacy prerequisites and equipment as editable list entries", () => {
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

    expect(screen.getByLabelText("Prerequisites and co-requisites 1")).toHaveProperty("value", "Foundational statistics");
    expect(screen.getByLabelText("Equipment 1")).toHaveProperty("value", "Laptop computer");
    expect(screen.getByRole("button", { name: "Add prerequisite or co-requisite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add equipment item" })).toBeTruthy();
  });
});
