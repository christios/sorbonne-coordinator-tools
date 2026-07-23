import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { ScheduleEditor } from "./ScheduleEditor";

describe("ScheduleEditor", () => {
  it("keeps sessions compact until one is opened", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><ScheduleEditor
      rows={[{ id: "session-1", date: "2026-09-01", topic: "Climate governance", preClass: "Read the assigned chapter.", assessments: "" }]}
      onChange={vi.fn()}
      syllabusId="syllabus-1"
      revision={1}
      onOpenHistory={vi.fn()}
    /></QueryClientProvider>);

    expect(screen.getByText("Climate governance")).toBeTruthy();
    expect(screen.getByLabelText("Section 1")).toBeTruthy();
    expect(screen.queryByLabelText("Pre-class learning activities")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand topic: Climate governance (position 1)" }));

    expect(screen.getByLabelText("Pre-class learning activities")).toBeTruthy();
    expect(screen.getByLabelText("Date")).toHaveProperty("value", "2026-09-01");
    expect(screen.queryByLabelText("Session")).toBeNull();
  });
});
