import { describe, expect, it } from "vitest";

import { electiveOptions } from "@/services/electiveOptions";

describe("what the allowed list offers", () => {
  const took = (studentId: string, courseCode: string) => ({ studentId, courseCode });

  it("offers first the subjects and courses students take outside their groups, counted by student", () => {
    // Sport was the thing everybody wanted to allow and the one thing the list could not
    // offer: it is another department's, so the department's own courses never carried it.
    const options = electiveOptions(
      [took("A001", "SPRT-650"), took("A002", "SPRT-616"), took("A002", "SPRT-651"), took("A003", "ENGL-616")],
      ["MATH-001", "PHYS-118"],
    );

    expect(options.map((option) => [option.value, option.badge ?? ""])).toEqual([
      ["ENGL", "1 student"],
      ["ENGL-616", "1 student"],
      ["SPRT", "2 students"],
      ["SPRT-616", "1 student"],
      ["SPRT-650", "1 student"],
      ["SPRT-651", "1 student"],
      ["MATH", ""],
      ["MATH-001", ""],
      ["PHYS", ""],
      ["PHYS-118", ""],
    ]);
  });

  it("offers a code once, with its count, when the department lists it too", () => {
    const options = electiveOptions([took("A001", "ENGL-616")], ["ENGL-616", "MATH-001"]);

    expect(options.filter((option) => option.value === "ENGL-616")).toEqual([
      { value: "ENGL-616", label: "ENGL-616", badge: "1 student", badgeTone: "accent" },
    ]);
  });
});
