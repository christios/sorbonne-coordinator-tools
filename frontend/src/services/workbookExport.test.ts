import { describe, expect, it } from "vitest";

import {
  type ExportBlock,
  buildWorkbookBuffer,
  crnFormula,
  helperKey,
  prefixOf,
  referenceRows,
} from "@/services/workbookExport";

const BLOCK: ExportBlock = {
  code: "TD",
  name: "Tutorials",
  courses: [
    { id: "c1", code: "MATH001", name: "Pre-calculus 1", component: "TD" },
    { id: "c2", code: "MATH009", name: "Linear Algebra", component: "TD" },
  ],
  groups: [
    {
      id: "g1",
      label: "1",
      capacity: 0,
      note: "",
      crns: { c1: { crn: "23652", teacher: "Dr Maaz" }, c2: { crn: "23364", teacher: "Dr Ahmed" } },
    },
    { id: "g2", label: "2", capacity: 0, note: "", crns: { c1: { crn: "22151", teacher: "Dr X" } } },
  ],
};

const STUDENTS = [
  { studentId: "A00021503", name: "Ali Nasser", groups: { TD: "1" } },
  { studentId: "A00021506", name: "Mariam Nasser", groups: { TD: "2" } },
];

describe("the keys the workbook looks itself up by", () => {
  it("builds the helper key the student tabs match on", () => {
    expect(helperKey("TD", "3", "MATH001")).toBe("TD|3|MATH001");
  });

  it("writes a formula the importer can read the block back out of", () => {
    // parse_group_assignments finds the block in the MATCH prefix, so the shape matters.
    const formula = crnFormula("FYS", "TD", "C", "MATH001", 2);
    expect(formula).toContain('MATCH("TD|"&$C2&"|MATH001",FYS_KEY,0)');
    expect(formula).toContain("INDEX(FYS_CRN,");
  });

  it("makes a defined-name prefix Excel will accept", () => {
    expect(prefixOf("Foundation Year")).toBe("FOUNDATION_YEAR");
    expect(prefixOf("2026 intake")).toMatch(/^C_/); // a name may not start with a digit
  });
});

describe("the Reference sheet", () => {
  it("carries one row per CRN, sorted the way the sheet is", () => {
    const rows = referenceRows([BLOCK]);
    expect(rows.map((row) => row[0])).toEqual(["22151", "23364", "23652"]);
  });

  it("says the block, the group and the course for each", () => {
    const row = referenceRows([BLOCK]).find((entry) => entry[0] === "23652");
    expect(row?.slice(1, 4)).toEqual(["1", "TD", "MATH001"]);
    expect(row?.[9]).toBe("TD|1|MATH001");
  });

  it("leaves out a cell with no CRN rather than writing a blank row", () => {
    const half: ExportBlock = {
      ...BLOCK,
      groups: [{ ...BLOCK.groups[0], crns: { c1: { crn: "", teacher: "" } } }],
    };
    expect(referenceRows([half])).toEqual([]);
  });
});

describe("the file it writes", () => {
  it("is a workbook with a Reference sheet and one tab per block", async () => {
    const buffer = await buildWorkbookBuffer({
      cohortName: "Foundation Year",
      prefix: "FYS",
      blocks: [BLOCK],
      students: STUDENTS,
    });

    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Reference", "TD"]);
  });

  it("fills the name column, which is the whole reason it is built here", async () => {
    const buffer = await buildWorkbookBuffer({
      cohortName: "Foundation Year",
      prefix: "FYS",
      blocks: [BLOCK],
      students: STUDENTS,
    });

    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const tab = book.getWorksheet("TD");

    expect(tab?.getCell("A2").value).toBe("A00021503");
    expect(tab?.getCell("B2").value).toBe("Ali Nasser");
    expect(tab?.getCell("C2").value).toBe("1");
  });

  it("writes the CRN columns as formulas, not as the numbers they resolve to", async () => {
    const buffer = await buildWorkbookBuffer({
      cohortName: "Foundation Year",
      prefix: "FYS",
      blocks: [BLOCK],
      students: STUDENTS,
    });

    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);
    const cell = book.getWorksheet("TD")?.getCell("D2");

    expect((cell?.value as { formula?: string })?.formula).toContain('MATCH("TD|"&$C2&"|MATH001"');
  });

  it("defines the ranges those formulas resolve through", async () => {
    // Without them every CRN cell opens as #NAME? and the file is not the one it claims.
    const buffer = await buildWorkbookBuffer({
      cohortName: "Foundation Year",
      prefix: "FYS",
      blocks: [BLOCK],
      students: STUDENTS,
    });

    const ExcelJS = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer);

    const names = book.definedNames.model.map((entry: { name: string }) => entry.name);
    expect(names).toEqual(expect.arrayContaining(["FYS_CRN", "FYS_KEY", "FYS_LOOKUP"]));
  });
});
