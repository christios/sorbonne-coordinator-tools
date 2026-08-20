import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SyllabusCatalogues } from "./SyllabusCatalogues";
import { listCatalogueEntries, updateCatalogueEntry } from "@/services/syllabusCatalogues";

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

  it("keeps catalogue creation actions on one line and stacks them in narrow catalogue columns", () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Programmes & PLOs" }));

    const addProgramme = screen.getByRole("button", { name: "Add programme" });
    expect(addProgramme.className).toContain("whitespace-nowrap");
    expect(addProgramme.parentElement?.className).not.toContain("sm:flex-row");
  });

  it("opens a catalogue entry for editing and closes it from its header", async () => {
    vi.mocked(listCatalogueEntries).mockResolvedValueOnce([
      { id: "person-1", category: "people", parentId: null, label: "Dr. Ada Lovelace", payload: {}, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
    ]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(await screen.findByText("Dr. Ada Lovelace"));

    const nameField = await screen.findByDisplayValue("Dr. Ada Lovelace");
    expect(nameField.closest("article")?.className).toContain("overflow-hidden");
    expect(screen.getByRole("button", { name: "Close editor for Dr. Ada Lovelace" }).className).toContain("focus-visible:ring-2");

    fireEvent.click(screen.getByText("Dr. Ada Lovelace"));
    expect(screen.queryByDisplayValue("Dr. Ada Lovelace")).toBeNull();
  });

  it("keeps a PLO card title to its code after saving an updated outcome", async () => {
    vi.mocked(listCatalogueEntries)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "programme-1", category: "programmes", parentId: null, label: "BSc Physics", payload: {}, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
      ])
      .mockResolvedValueOnce([
        { id: "plo-1", category: "plos", parentId: "programme-1", label: "PLO 1 · Previous outcome", payload: { code: "PLO 1", outcome: "Previous outcome" }, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
      ]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Programmes & PLOs" }));
    fireEvent.click(await screen.findByText("PLO 1 · Previous outcome"));
    fireEvent.change(screen.getByLabelText("Programme learning outcome"), { target: { value: "Updated outcome" } });
    fireEvent.click(screen.getByRole("button", { name: "Save PLO" }));

    await waitFor(() => expect(updateCatalogueEntry).toHaveBeenCalledWith("plos", "plo-1", expect.objectContaining({ label: "PLO 1" })));
  });

  it("confirms before collapsing a catalogue card with unsaved edits", async () => {
    vi.mocked(listCatalogueEntries).mockResolvedValueOnce([
      { id: "person-3", category: "people", parentId: null, label: "Dr. Grace Hopper", payload: {}, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
    ]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(await screen.findByText("Dr. Grace Hopper"));
    fireEvent.input(screen.getByDisplayValue("Dr. Grace Hopper"), { target: { value: "Dr. Grace Murray Hopper" } });
    fireEvent.click(screen.getByText("Dr. Grace Hopper"));

    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(screen.getByDisplayValue("Dr. Grace Murray Hopper")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByDisplayValue("Dr. Grace Murray Hopper")).toBeNull();
  });

  it("wraps long catalogue labels inside their cards", async () => {
    const longName = "Bachelor in Physics – Concentration in Quantum Technologies";
    vi.mocked(listCatalogueEntries).mockResolvedValueOnce([
      { id: "person-2", category: "people", parentId: null, label: longName, payload: {}, sortOrder: 0, isRetired: false, retiredAt: null, revision: 1, createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" },
    ]);
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SyllabusCatalogues onBack={vi.fn()} /></QueryClientProvider>);

    const label = await screen.findByText(longName);
    expect(label.className).toContain("break-words");
    expect(label.closest("article")?.className).toContain("min-w-0");
  });
});
