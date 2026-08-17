import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FieldHistoryProvider } from "./FieldHistory";
import { HistoryTextField } from "./HistoryTextField";

describe("HistoryTextField", () => {
  it("centers the history action inside a single-line input", () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <FieldHistoryProvider enabled source={{ resourceType: "example", resourceId: "record-1", revision: 1, loadHistory: vi.fn() }}>
          <HistoryTextField
            label="Course learning outcome"
            value=""
            onChange={vi.fn()}
            history={{ field: { path: "learningOutcomes.clos[clo-1].clo", label: "CLO 1 · Course learning outcome" }, onOpenHistory: vi.fn() }}
          />
        </FieldHistoryProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "View edit history for CLO 1 · Course learning outcome" }).parentElement?.className)
      .toContain("inset-y-0 right-2 items-center");
    expect(screen.getByRole("textbox", { name: "Course learning outcome" }).className)
      .toContain("block");
    expect(screen.getByRole("textbox", { name: "Course learning outcome" }).parentElement?.className)
      .toContain("leading-none");
    expect(screen.getByRole("textbox", { name: "Course learning outcome" }).parentElement?.className)
      .toContain("h-10");
    expect(screen.getByRole("textbox", { name: "Course learning outcome" }).parentElement?.parentElement?.className)
      .toContain("content-start");
  });
});
