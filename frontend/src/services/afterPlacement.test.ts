import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { afterPlacement } from "@/services/afterPlacement";

/*
 * Changing a student's groups changes which sections the registrar is expected to have
 * them in — so every registration warning on their row is wrong the instant the move
 * lands. The check is cached per cohort, so they stayed wrong until the page was
 * reloaded: a coordinator fixing a placement watched the warning it was meant to clear
 * sit there unchanged.
 */
describe("what a change of placement makes stale", () => {
  const keysInvalidatedBy = (act: (client: QueryClient) => void) => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");
    act(client);
    return spy.mock.calls.map(([arg]) => (arg as { queryKey: string[] }).queryKey[0]);
  };

  it("includes the register's verdict, which is the one it used to miss", () => {
    expect(keysInvalidatedBy(afterPlacement)).toContain("registration-check");
  });

  it("includes who is in which group, and everything read off it", () => {
    const keys = keysInvalidatedBy(afterPlacement);

    expect(keys).toEqual(expect.arrayContaining(["students", "cohorts", "catalogue", "assignments", "publication"]));
  });

  it("names each of them once, so the list can be read as the answer to one question", () => {
    const keys = keysInvalidatedBy(afterPlacement);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
