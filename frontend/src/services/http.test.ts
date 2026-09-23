import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFetch, SIGNED_OUT } from "@/services/http";

function answering(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("every call to our own API", () => {
  it("carries the staff session cookie, whatever the origin", async () => {
    answering(200);

    await apiFetch("/api/v1/anything");

    expect(fetch).toHaveBeenCalledWith("/api/v1/anything", expect.objectContaining({ credentials: "include" }));
  });

  it("says so when the server no longer knows who is asking", async () => {
    answering(401);
    const heard = vi.fn();
    window.addEventListener(SIGNED_OUT, heard);

    await apiFetch("/api/v1/anything");

    expect(heard).toHaveBeenCalled();
    window.removeEventListener(SIGNED_OUT, heard);
  });

  it("stays quiet when the answer is that this is not allowed", async () => {
    // Signed in and refused is a different thing from not signed in, and signing somebody
    // out of the application for asking about a page they cannot see would be absurd.
    answering(403);
    const heard = vi.fn();
    window.addEventListener(SIGNED_OUT, heard);

    await apiFetch("/api/v1/anything");

    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(SIGNED_OUT, heard);
  });

  it("hands the answer back untouched", async () => {
    answering(401);

    expect((await apiFetch("/api/v1/anything")).status).toBe(401);
  });
});
