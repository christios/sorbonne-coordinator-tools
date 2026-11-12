import { describe, expect, it } from "vitest";

import { codePrefix, programmeFromCode, programmeName, programmeOf, withProgrammeColumn } from "@/services/coursePrograms";
import type { GridColumn } from "@/services/studentColumns";

/** SCEN's programmes: MATH's course codes are MATH and CPSC, PHYS's are PHYS. */
const SCEN = {
  programmes: [
    { code: "MATH", name: "Mathematics", officialName: "", registrarName: "Mathematics", aliases: [], prefixes: ["MATH", "CPSC"] },
    { code: "PHYS", name: "Physics", officialName: "", registrarName: "Physics", aliases: [], prefixes: ["PHYS"] },
  ],
  courses: {},
};

describe("a course's programme", () => {
  it("is the student programme listing its code's prefix — none in a department with none", () => {
    expect(programmeFromCode("MATH-100", SCEN)).toBe("MATH");
    // The workbook lists Computer Science on its Maths tab.
    expect(programmeFromCode("CPSC-100", SCEN)).toBe("MATH");
    expect(programmeFromCode("phys-125", SCEN)).toBe("PHYS");
    // The Foundation Year's own courses are neither.
    expect(programmeFromCode("SCEN-102", SCEN)).toBe("");
    expect(programmeFromCode("MATH-100")).toBe("");
    // The longest prefix wins.
    const nested = { programmes: [...SCEN.programmes, { code: "STAT", name: "Statistics", officialName: "", registrarName: "", aliases: [], prefixes: ["MATH3"] }], courses: {} };
    expect(programmeFromCode("MATH350", nested)).toBe("STAT");
    expect(programmeName("PHYS", SCEN)).toBe("Physics");
    expect(programmeName("", SCEN)).toBe("No programme");
  });

  it("is where the department has put the course by hand, whatever its code says", () => {
    const said = { ...SCEN, courses: { "CPSC-100": "PHYS", "MATH-113": "NONE", "SCEN-102": "MATH", "MATH-009": "CHEM" } };
    expect(programmeOf("CPSC-100", said)).toBe("PHYS");
    expect(programmeOf("math-113", said)).toBe("");
    expect(programmeOf("SCEN-102", said)).toBe("MATH");
    // Put in a programme the department no longer has: by its code again.
    expect(programmeOf("MATH-009", said)).toBe("MATH");
  });

  it("reads the letters a course code starts with", () => {
    expect(codePrefix("math-100")).toBe("MATH");
    expect(codePrefix("CPSC100")).toBe("CPSC");
    expect(codePrefix("")).toBe("");
  });
});

describe("a page's Program filter", () => {
  type Row = { code: string };
  const COLUMNS: GridColumn<Row>[] = [
    { id: "cohort", displayName: "Cohort", type: "option", accessor: () => "L1", defaultWidth: 100 },
    { id: "code", displayName: "Course", type: "option", accessor: (row) => row.code, defaultWidth: 100 },
    { id: "crn", displayName: "CRN", type: "text", accessor: () => "", defaultWidth: 100 },
  ];

  it("sits after the column named, and names each row's course's programme", () => {
    const columns = withProgrammeColumn(COLUMNS, SCEN, (row) => row.code, "code");
    expect(columns.map((column) => column.id)).toEqual(["cohort", "code", "programme", "crn"]);
    expect(columns[2].accessor({ code: "CPSC-100" })).toBe("Mathematics");
    expect(columns[2].accessor({ code: "SCEN-101" })).toBe("No programme");
  });

  it("is not offered in a department with no programme", () => {
    expect(withProgrammeColumn(COLUMNS, { programmes: [], courses: {} }, (row) => row.code)).toBe(COLUMNS);
  });
});
