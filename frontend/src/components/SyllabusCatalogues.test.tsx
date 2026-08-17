import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyllabusCatalogues } from "./SyllabusCatalogues";

vi.mock("@/services/syllabusCatalogues", () => ({
  createCatalogueEntry: vi.fn(),
  listCatalogueEntries: vi.fn().mockResolvedValue([]),
  retireCatalogueEntry: vi.fn(),
  updateCatalogueEntry: vi.fn(),
}));

describe("SyllabusCatalogues", () => {
  it("groups the public catalogue workspace and returns to the library", () => {
    const onBack = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={onBack} /></QueryClientProvider>);

    expect(screen.getByRole("button", { name: "People" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Programmes & PLOs" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Teaching presets" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to syllabus library" }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
