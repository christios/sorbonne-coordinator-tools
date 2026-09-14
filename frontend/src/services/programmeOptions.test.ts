import { describe, expect, it } from "vitest";

import { withStored } from "@/services/programmeOptions";

/**
 * The trap this exists for, in one line: a `<select>` whose value matches no option shows
 * the FIRST option instead, and says nothing.
 *
 * Both programme pickers list what the portal returned for this browser's students. The
 * programmes stored on production were written in the group labels' vocabulary — "Physics"
 * — while the portal spells it "PHYS - Physics", so every one of them read as "any" or
 * "everyone" while the database said otherwise. Two people spent a while disagreeing about
 * what the schema page was showing, and both were right.
 */
describe("what a programme picker offers", () => {
  const PORTAL = ["MATH - Mathematics", "PHYS - Physics"];

  it("offers what the portal returned, when the stored value is one of them", () => {
    expect(withStored(PORTAL, "PHYS - Physics")).toEqual([
      { value: "MATH - Mathematics", label: "MATH - Mathematics" },
      { value: "PHYS - Physics", label: "PHYS - Physics" },
    ]);
  });

  it("adds a stored value the portal's list does not know, rather than hiding it", () => {
    const offered = withStored(PORTAL, "Physics");

    expect(offered.map((option) => option.value)).toContain("Physics");
    // Marked, because it is a value that will match no student until somebody fixes it.
    expect(offered[offered.length - 1].label).toContain("not in this browser's pulls");
  });

  it("offers nothing extra when nothing is stored", () => {
    expect(withStored(PORTAL, "")).toHaveLength(2);
  });

  it("still shows a stored value when this browser holds no vocabulary at all", () => {
    // A browser that has never synced knows no programmes. Hiding the picker then hides a
    // value that is set, which is how one goes unnoticed.
    expect(withStored([], "PHYS - Physics")).toEqual([
      { value: "PHYS - Physics", label: "PHYS - Physics — not in this browser's pulls" },
    ]);
  });
});
