import { beforeEach, describe, expect, it, vi } from "vitest";

import { COHORT, recall, remember } from "@/services/remembered";

describe("remembered", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("gives back what was put in", () => {
    remember(COHORT, "c2");
    expect(recall(COHORT)).toBe("c2");
  });

  it("starts empty, so the page falls back to its own first choice", () => {
    expect(recall(COHORT)).toBe("");
  });

  it("forgets rather than remembering nothing", () => {
    remember(COHORT, "c2");
    remember(COHORT, "");
    expect(window.localStorage.getItem("scen-remembered:cohort")).toBeNull();
  });

  it("keeps two choices apart", () => {
    remember(COHORT, "c2");
    remember("schema-term", "t1");
    expect(recall(COHORT)).toBe("c2");
    expect(recall("schema-term")).toBe("t1");
  });

  it("survives a browser that refuses to store", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => remember(COHORT, "c2")).not.toThrow();
    setItem.mockRestore();
  });
});
