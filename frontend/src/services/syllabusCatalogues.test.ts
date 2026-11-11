import { describe, expect, it, vi } from "vitest";

import { createCatalogueEntry, listCatalogueEntries, rankOptions, retireCatalogueEntry, type CatalogueEntry } from "./syllabusCatalogues";

describe("syllabus catalogue service", () => {
  it("lists, creates, and retires catalogue entries through the public API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "person-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "person-1", isRetired: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await listCatalogueEntries("people", { query: "Amira" });
    await createCatalogueEntry("people", { label: "Dr Amira", payload: { roles: ["instructor"] } });
    await retireCatalogueEntry("people", "person-1", 1);

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/syllabus-catalogues\/people\?query=Amira/), expect.objectContaining({ credentials: "include" }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/syllabus-catalogues\/people$/), expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringMatching(/people\/person-1\/retire$/), expect.objectContaining({ method: "POST" }));
  });
});

describe("choosing an academic rank", () => {
  const rank = (label: string, isRetired = false): CatalogueEntry => ({
    id: label, category: "academic-ranks", parentId: null, label, payload: {}, sortOrder: 0, isRetired, retiredAt: null, revision: 1, createdAt: "", updatedAt: "",
  });

  it("offers the current ranks and keeps a stored rank that is no longer listed", () => {
    const ranks = [rank("Professor"), rank("Lecturer"), rank("Reader", true)];

    expect(rankOptions(ranks, "").map((option) => option.label)).toEqual(["Professor", "Lecturer"]);
    expect(rankOptions(ranks, "Lecturer").map((option) => option.label)).toEqual(["Professor", "Lecturer"]);
    expect(rankOptions(ranks, "Reader")[2]).toEqual({ value: "Reader", label: "Reader (not in the list)" });
  });
});
