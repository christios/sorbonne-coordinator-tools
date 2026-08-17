import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { PloEditor } from "./StructuredEntryEditors";

describe("PloEditor", () => {
  it("generates PLO numbers instead of exposing an editable code field", () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PloEditor
          value={[{ id: "plo-1", code: "Legacy code", outcome: "PLO 1. Explain climate policy." }]}
          onChange={vi.fn()}
          syllabusId="syllabus-1"
          revision={1}
          onOpenHistory={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("PLO 1")).toBeTruthy();
    fireEvent.click(screen.getByText("PLO 1", { exact: true }));
    expect(screen.queryByText("PLO code")).toBeNull();
  });
});
