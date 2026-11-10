import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useTicks } from "@/components/useTicks";

describe("ticks held for one semester", () => {
  it("reads nothing once the semester changes, and does not bring the old ticks back", () => {
    const { result, rerender } = renderHook(({ term }) => useTicks(term), { initialProps: { term: "262710" } });

    act(() => result.current[1](new Set(["23304", "23305"])));
    expect([...result.current[0]]).toEqual(["23304", "23305"]);

    rerender({ term: "262720" });
    expect(result.current[0].size).toBe(0);

    rerender({ term: "262710" });
    expect(result.current[0].size).toBe(0);
  });

  it("adds to the ticks of the semester on screen only", () => {
    const { result, rerender } = renderHook(({ term }) => useTicks(term), { initialProps: { term: "262710" } });
    act(() => result.current[1](new Set(["23304"])));

    rerender({ term: "262720" });
    act(() => result.current[1]((current) => new Set([...current, "30001"])));

    expect([...result.current[0]]).toEqual(["30001"]);
  });

  it("keeps what was ticked while the page was still learning its semester", () => {
    const { result, rerender } = renderHook(({ term }) => useTicks(term), { initialProps: { term: "" } });
    act(() => result.current[1](new Set(["23304"])));

    rerender({ term: "262710" });

    expect([...result.current[0]]).toEqual(["23304"]);
  });
});
