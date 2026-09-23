import { describe, expect, it } from "vitest";

import { ageInWords, isStale, STALE_AFTER } from "@/services/syncFreshness";

const NOON = new Date("2026-09-23T12:00:00Z").getTime();
const hoursAgo = (hours: number) => NOON - hours * 3_600_000;

describe("whether the pages are too old to work from", () => {
  it("says nothing until the department's own limit is reached", () => {
    expect(isStale({ syncedAt: hoursAgo(7.5), now: NOON })).toBe(false);
    expect(isStale({ syncedAt: hoursAgo(9), now: NOON })).toBe(true);
    expect(STALE_AFTER).toBe(8);
  });

  it("takes the limit from the check rather than from the code", () => {
    expect(isStale({ syncedAt: hoursAgo(9), now: NOON, hours: 24 })).toBe(false);
    expect(isStale({ syncedAt: hoursAgo(3), now: NOON, hours: 2 })).toBe(true);
  });

  it("stays quiet when the check is switched off", () => {
    // Which is the only honest setting while the portal itself is down.
    expect(isStale({ syncedAt: hoursAgo(80), now: NOON, hours: 0 })).toBe(false);
  });

  it("says nothing about a department that has never synced at all", () => {
    // Not staleness: there is nothing to be stale. An empty register reads as empty.
    expect(isStale({ syncedAt: null, now: NOON })).toBe(false);
  });
});

describe("how old, in words", () => {
  it("counts whole hours, then whole days", () => {
    expect(ageInWords(hoursAgo(1), NOON)).toBe("1 hour");
    expect(ageInWords(hoursAgo(9.7), NOON)).toBe("9 hours");
    expect(ageInWords(hoursAgo(50), NOON)).toBe("2 days");
  });
});
