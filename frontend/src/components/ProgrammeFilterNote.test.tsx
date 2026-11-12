import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgrammeFilterNote } from "@/components/ProgrammeFilterNote";

const note = (operator: string, values: string[]) => {
  render(<ProgrammeFilterNote filter={{ columnId: "programme", type: "multiOption", operator, values }} />);
  return screen.getByRole("status").textContent ?? "";
};

describe("the note a Program filter on Teacher hours shows", () => {
  it("says which teachers stay, and that their hours are not filtered", () => {
    expect(note("include", ["Mathematics"])).toBe(
      "Only teachers who teach courses in the Mathematics program stay. Their hours are not filtered: each total still counts all their courses.",
    );
  });

  it("follows the filter's operator", () => {
    expect(note("include any of", ["Mathematics", "Physics"])).toContain("Only teachers who teach courses in the Mathematics or Physics programs stay.");
  });

  it("says what an all-of filter keeps", () => {
    expect(note("include all of", ["Mathematics", "Physics"])).toContain("Only teachers who teach courses in the Mathematics and Physics programs stay.");
  });

  it("says what an exclusion leaves out", () => {
    expect(note("exclude", ["Physics"])).toContain("Teachers who teach courses in the Physics program are left out.");
  });
});
