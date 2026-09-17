import { describe, expect, it } from "vitest";

import { amongPrograms, programCode, sameProgram } from "@/services/programmes";

describe("which programme a string names", () => {
  it("reads the code off the registrar's spelling", () => {
    expect(programCode("MATH - Mathematics")).toBe("MATH");
    expect(programCode("ECMG - Economics and Management")).toBe("ECMG");
  });

  it("takes a bare code as the code it plainly is", () => {
    // A cohort's expectations are written this way; a sub-row's programme is written the
    // other. They have to meet.
    expect(programCode("PHYS")).toBe("PHYS");
    expect(sameProgram("PHYS - Physics", "PHYS")).toBe(true);
  });

  it("does not mind the spacing around the dash", () => {
    expect(programCode("MATH  -  Mathematics")).toBe("MATH");
  });

  it("keeps a dash that is part of the words", () => {
    // Nothing is split on a hyphen inside a word, only on a dash standing on its own.
    expect(programCode("Pre-medical")).toBe("PRE-MEDICAL");
  });
});

describe("whether two spellings are one programme", () => {
  it("still matches when the registrar rewords the description", () => {
    // The whole point: the words after the code are theirs to change, and the day they do
    // every sub-row written the old way would otherwise match nobody.
    expect(sameProgram("MATH - Mathematics", "MATH - Mathematics (BSc)")).toBe(true);
  });

  it("does not match two different programmes", () => {
    expect(sameProgram("MATH - Mathematics", "PHYS - Physics")).toBe(false);
  });

  it("ignores case and the spaces around it", () => {
    expect(sameProgram("  math - Mathematics ", "MATH - Mathematics")).toBe(true);
  });

  it("matches nothing against a blank, rather than everything", () => {
    expect(sameProgram("", "MATH - Mathematics")).toBe(false);
    expect(sameProgram("MATH - Mathematics", "   ")).toBe(false);
  });

  it("says whether a programme is among a list of them", () => {
    const held = ["MATH - Mathematics", "PHYS - Physics"];
    expect(amongPrograms(held, "PHYS")).toBe(true);
    expect(amongPrograms(held, "ECMG - Economics and Management")).toBe(false);
    expect(amongPrograms([], "MATH")).toBe(false);
  });
});
