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

  it("opens a newly added source in paste-friendly freeform mode", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    render(<QueryClientProvider client={queryClient}><BibliographyEditor value={{}} onChange={onChange} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    fireEvent.click(screen.getByRole("button", { name: "Add book" }));

    expect(onChange).toHaveBeenCalledWith({ books: [expect.objectContaining({ entryMode: "freeform" })] });
  });

  it("finds a book and copies the selected metadata into the editable card", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onChange = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{
        provider: "Open Library",
        kind: "book",
        title: "The Dispossessed",
        authors: ["Ursula K. Le Guin"],
        year: "1974",
        publisher: "Harper & Row",
        isbn: "9780061054884",
        journal: null,
        volume: null,
        issue: null,
        pages: null,
        doi: null,
        url: null,
      }],
    }), { status: 200 })));

    render(<QueryClientProvider client={queryClient}><BibliographyEditor value={{ books: [{ id: "book-1", entryMode: "freeform" }] }} onChange={onChange} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    expect(screen.queryByRole("button", { name: "Find reference" })).toBeNull();
    expect(screen.getByLabelText("Find book by ISBN, title, or author")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find book by ISBN, title, or author"), { target: { value: "The Dispossessed" } });
    fireEvent.click(screen.getByRole("button", { name: "Search references" }));
    fireEvent.click(await screen.findByRole("button", { name: /The Dispossessed/ }));

    expect(onChange).toHaveBeenLastCalledWith({
      books: [expect.objectContaining({
        entryMode: "structured",
        title: "The Dispossessed",
        authors: "Ursula K. Le Guin",
        publisher: "Harper & Row",
        isbn: "9780061054884",
      })],
    });
  });

  it("explains when a completed reference search finds no matches", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 })));

    render(<QueryClientProvider client={queryClient}><BibliographyEditor value={{ books: [{ id: "book-1", entryMode: "freeform" }] }} onChange={vi.fn()} syllabusId="syllabus-1" revision={1} onOpenHistory={vi.fn()} /></QueryClientProvider>);

    fireEvent.change(screen.getByLabelText("Find book by ISBN, title, or author"), { target: { value: "Principles & practice of physics Mazur 2016" } });
    fireEvent.click(screen.getByRole("button", { name: "Search references" }));

    expect((await screen.findByRole("status")).textContent).toContain("No matching references were found");
  });
});
