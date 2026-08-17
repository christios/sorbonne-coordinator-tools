import { describe, expect, it, vi } from "vitest";

import { createCatalogueEntry, listCatalogueEntries, retireCatalogueEntry } from "./syllabusCatalogues";

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

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringMatching(/syllabus-catalogues\/people\?query=Amira/), undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringMatching(/syllabus-catalogues\/people$/), expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, expect.stringMatching(/people\/person-1\/retire$/), expect.objectContaining({ method: "POST" }));
  });
});
