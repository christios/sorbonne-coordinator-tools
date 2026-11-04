import { describe, expect, it } from "vitest";

import { FACTS_LINE, linesIn } from "@/services/boxFit";

describe("how many lines of a class's box fit", () => {
  it("counts whole lines only, never half of one", () => {
    expect(linesIn(FACTS_LINE)).toBe(1);
    expect(linesIn(FACTS_LINE - 1)).toBe(0);
    expect(linesIn(2 * FACTS_LINE)).toBe(2);
    expect(linesIn(2 * FACTS_LINE - 1)).toBe(1);
  });

  it("counts a box measured in whole pixels as holding what it was measured for", () => {
    // Three lines are 41.25px, which a browser reports as 41.
    expect(linesIn(41)).toBe(3);
  });

  it("is nought for a box with no room at all", () => {
    expect(linesIn(0)).toBe(0);
    expect(linesIn(-4)).toBe(0);
  });
});
