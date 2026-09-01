import { afterEach, describe, expect, it, vi } from "vitest";

import * as browser from "@/services/browserStore";
import { loadPull, rememberPull } from "@/services/rosterStore";

afterEach(async () => {
  vi.restoreAllMocks();
  await browser.drop("probe");
});

describe("the drawer the rosters live in", () => {
  it("gives back what was put in, as objects rather than text", async () => {
    await browser.write("probe", { rows: [{ SPRIDEN_ID: "A001" }], at: 1000 });

    expect(await browser.read("probe")).toEqual({ rows: [{ SPRIDEN_ID: "A001" }], at: 1000 });
  });

  it("says nothing about a key never written", async () => {
    expect(await browser.read("probe")).toBeNull();
  });

  it("forgets a key when asked", async () => {
    await browser.write("probe", { a: 1 });

    await browser.drop("probe");

    expect(await browser.read("probe")).toBeNull();
  });

  /*
   * The whole point of the move. localStorage gives an origin about five megabytes, and a
   * term is 2876 students across 45 fields — which did not fit beside the dozen views a
   * coordinator already had, so the write was refused and the names were never stored.
   *
   * jsdom's localStorage has no quota, so a test cannot make the old drawer overflow.
   * What it can check is that the roster went to the database and not to localStorage,
   * which is the difference that matters — and it fails if the fallback is taken.
   */
  it("holds a whole term, and keeps it out of localStorage", async () => {
    const fields = Array.from({ length: 45 }, (_, i) => `FIELD_${i}`);
    const rows = Array.from({ length: 2876 }, (_, i) => {
      const row: Record<string, string> = { SPRIDEN_ID: `A${String(i).padStart(6, "0")}` };
      for (const field of fields) row[field] = "Applied Mathematics and Physics";
      return row;
    });
    const asText = JSON.stringify(rows);
    // Bigger than the allowance localStorage would have given the whole origin.
    expect(asText.length).toBeGreaterThan(5 * 1024 * 1024);

    await rememberPull({
      presetId: "term", name: "Whole term", count: rows.length,
      expect: null, warning: null, fetchedAt: 1000, rows,
    });

    const stored = (await loadPull("term")).current;
    expect(stored?.rows).toHaveLength(2876);
    expect(stored?.rows[2875].SPRIDEN_ID).toBe("A002875");
    // The drawer it went into, and the one it stayed out of.
    expect(await browser.read("scen-rosters:v2")).toBeTruthy();
    expect(window.localStorage.getItem("scen-rosters:v2")).toBeNull();
  });

  it("falls back to localStorage when the browser will not open a database", async () => {
    // Private browsing, an old browser, or a policy that blocks storage.
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new Error("blocked");
    });
    browser.resetForTests();

    expect(await browser.write("probe", { a: 1 })).toBe(true);
    expect(await browser.read("probe")).toEqual({ a: 1 });
    expect(window.localStorage.getItem("probe")).toBe('{"a":1}');

    vi.restoreAllMocks();
    browser.resetForTests();
    window.localStorage.removeItem("probe");
  });
});
