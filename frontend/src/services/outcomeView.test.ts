import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { readOutcomeView, useOutcomeView } from "@/services/outcomeView";

afterEach(() => window.localStorage.clear());

describe("how the outcome tables are shown", () => {
  it("shows both tables until the person chooses tabs, and remembers the choice", () => {
    expect(readOutcomeView()).toBe("both");

    const { result } = renderHook(() => useOutcomeView());
    act(() => result.current[1]("tabs"));

    expect(result.current[0]).toBe("tabs");
    expect(readOutcomeView()).toBe("tabs");
  });
});
