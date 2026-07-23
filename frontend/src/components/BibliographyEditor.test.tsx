import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { BibliographyEditor } from "./StructuredEntryEditors";

describe("BibliographyEditor", () => {
  it("shows one bibliography resource type at a time", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><BibliographyEditor value={{}} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.getByRole("heading", { name: "Books", level: 4 })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Websites" }));
    expect(screen.getByRole("heading", { name: "Websites", level: 4 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Books", level: 4 })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Journal articles" }));
    expect(screen.getByRole("heading", { name: "Journal articles", level: 4 })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Websites", level: 4 })).toBeNull();
  });
});
