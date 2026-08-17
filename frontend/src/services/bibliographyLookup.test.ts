import { describe, expect, it, vi } from "vitest";

import { lookupBibliography } from "./bibliographyLookup";

describe("bibliography lookup service", () => {
  it("sends a bounded lookup through the backend rather than directly to a provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await lookupBibliography("article", "climate law");

    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/api\/v1\/bibliography\/lookup\?kind=article&q=climate\+law$/));
  });
});
