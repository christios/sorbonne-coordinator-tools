import { describe, expect, it } from "vitest";

import { fittedRowHeight } from "@/services/timelineFit";

describe("how tall a class grows to fill the screen", () => {
  it("shares out the screen when the week needs less of it", () => {
    // Five days of one class each in 600px: every row gets a fifth, less its edges.
    const height = fittedRowHeight(600, [1, 1, 1, 1, 1], 22, 44);
    expect(height).toBeGreaterThan(100);
    expect(5 * (height + 6 + 1)).toBeLessThanOrEqual(600);
  });

  it("never goes below the height asked for, and lets a crowded week scroll", () => {
    expect(fittedRowHeight(300, [12, 16, 9, 14, 11], 22, 44)).toBe(22);
  });

  it("keeps to the height asked for where it cannot measure", () => {
    expect(fittedRowHeight(0, [1, 1], 30, 44)).toBe(30);
  });

  it("stops growing a class once it is only a taller colour", () => {
    expect(fittedRowHeight(5000, [1], 22, 44)).toBe(160);
  });

  it("counts a row as no shorter than its label", () => {
    // Two quiet rooms under one-line labels of 28px: a class grows only once its row outgrows the label.
    expect(fittedRowHeight(58, [1, 1], 22, 28)).toBe(22);
    expect(fittedRowHeight(80, [1, 1], 22, 28)).toBe(33);
  });
});
