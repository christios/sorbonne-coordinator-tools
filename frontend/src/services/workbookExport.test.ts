import { describe, expect, it } from "vitest";

import {
  type ExportBlock,
  type ExportStudent,
  buildWorkbookBuffer,
  columnLetter,
  columnsOf,
  crnFormula,
  groupsName,
  helperKey,
  prefixOf,
  referenceRows,
  tabsOf,
} from "@/services/workbookExport";

const TD: ExportBlock = {
  code: "TD",
  name: "Tutorials",
  tab: "TD",
  groupColumn: "TD group",
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

/** Readiness rides on the tutorials tab, as it does in the coordinator's own workbook. */
const RDNS: ExportBlock = {
  code: "RDNS",
  name: "Readiness",
  tab: "TD",
  groupColumn: "Readiness group",
  courses: [{ id: "c9", code: "SCEN102", name: "Mathematics Readiness", component: "TD" }],
  groups: [{ id: "r1", label: "1", capacity: 0, note: "", crns: { c9: { crn: "23998", teacher: "TBD" } } }],
};

const STUDENTS: ExportStudent[] = [
  { studentId: "A00021503", name: "Ali Nasser", groups: { TD: "1", RDNS: "1" }, program: "Foundation Year" },
  { studentId: "A00021506", name: "Mariam Nasser", groups: { TD: "2" }, program: "Foundation Year" },
];

async function built(blocks = [TD, RDNS]) {
  const buffer = await buildWorkbookBuffer({
    cohortName: "Foundation Year",
    prefix: "FYS",
    blocks,
    students: STUDENTS,
  });
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer);
  return book;
}

describe("the keys the workbook looks itself up by", () => {
  it("builds the helper key the student tabs match on", () => {
    expect(helperKey("TD", "3", "MATH001")).toBe("TD|3|MATH001");
  });

  it("writes a formula the importer can read the block back out of", () => {
    const formula = crnFormula("FYS", "TD", "E", "MATH001", 2);
    expect(formula).toContain('MATCH("TD|"&$E2&"|MATH001",FYS_KEY,0)');
  });

  it("makes defined names Excel will accept", () => {
    expect(prefixOf("Foundation Year")).toBe("FOUNDATION_YEAR");
    expect(prefixOf("2026 intake")).toMatch(/^C_/);
    expect(groupsName("FYS", "RDNS")).toBe("FYS_RDNS_GROUPS");
  });

  it("counts columns the way a spreadsheet does", () => {
    expect([1, 5, 26, 27].map(columnLetter)).toEqual(["A", "E", "Z", "AA"]);
  });
});

describe("where the blocks are laid out", () => {
  it("puts blocks that shared a tab back on the same one", () => {
    // Readiness is a column beside the tutorials, not a sheet of its own.
    expect(tabsOf([TD, RDNS]).map((tab) => tab.title)).toEqual(["TD"]);
  });

  it("gives a block with no tab recorded one of its own", () => {
    const loose: ExportBlock = { ...TD, code: "CM", tab: "", groupColumn: "" };
    expect(tabsOf([loose]).map((tab) => tab.title)).toEqual(["CM"]);
  });

  it("keeps the order the columns were in, not the order the blocks are stored in", () => {
    // Readiness sits to the right of the tutorials in the coordinator's file; stored
    // alphabetically it would come first, and the tab would be a different sheet.
    const readinessFirst = [
      { ...RDNS, columnIndex: 9 },
      { ...TD, columnIndex: 5 },
    ];
    expect(tabsOf(readinessFirst)[0].blocks.map((block) => block.code)).toEqual(["TD", "RDNS"]);
  });

  it("places each block's typed column after the four identifying ones", () => {
    const placed = columnsOf([TD, RDNS]);
    expect(placed.map((entry) => entry.group)).toEqual([5, 8]);
    expect(placed.map((entry) => entry.courses)).toEqual([6, 9]);
  });
});

describe("the Reference sheet", () => {
  it("carries one row per CRN, sorted the way the sheet is", () => {
    expect(referenceRows([TD]).map((row) => row[0])).toEqual(["22151", "23364", "23652"]);
  });

  it("records the tab and column each block was laid out on", () => {
    const row = referenceRows([RDNS])[0];
    expect(row.slice(7, 10)).toEqual(["TD", "Readiness group", "RDNS|1|SCEN102"]);
  });

  it("leaves out a cell with no CRN rather than writing a blank row", () => {
    const half: ExportBlock = { ...TD, groups: [{ ...TD.groups[0], crns: { c1: { crn: "", teacher: "" } } }] };
    expect(referenceRows([half])).toEqual([]);
  });
});

describe("the file it writes", () => {
  it("has the sheets the coordinator's workbook has", async () => {
    const book = await built();
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["TD", "Reference", "Legend"]);
  });

  it("heads a tab with the four identifying columns, then each block's own", async () => {
    const tab = (await built()).getWorksheet("TD");
    const headers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => String(tab?.getCell(1, c).value ?? ""));

    expect(headers.slice(0, 4)).toEqual(["#", "Student ID", "Student Full Name", "Program"]);
    expect(headers[4]).toBe("TD group\n◀ TYPE HERE");
    expect(headers[7]).toBe("Readiness group\n◀ TYPE HERE");
  });

  it("fills the name column, which is the whole reason it is built here", async () => {
    const tab = (await built()).getWorksheet("TD");

    expect(tab?.getCell("B2").value).toBe("A00021503");
    expect(tab?.getCell("C2").value).toBe("Ali Nasser");
    expect(tab?.getCell("E2").value).toBe("1");
    expect(tab?.getCell("A2").value).toBe(1);
  });

  it("points each block's formulas at its own typed column", async () => {
    const tab = (await built()).getWorksheet("TD");
    const tutorial = tab?.getCell("F2").value as { formula?: string };
    const readiness = tab?.getCell("I2").value as { formula?: string };

    expect(tutorial?.formula).toContain('MATCH("TD|"&$E2');
    expect(readiness?.formula).toContain('MATCH("RDNS|"&$H2');
  });

  it("marks the typed columns amber and the calculated ones green", async () => {
    const tab = (await built()).getWorksheet("TD");
    const typed = tab?.getCell("E2").fill as { fgColor?: { argb?: string } };
    const calculated = tab?.getCell("F2").fill as { fgColor?: { argb?: string } };

    expect(typed?.fgColor?.argb).toBe("FFFFF2CC");
    expect(calculated?.fgColor?.argb).toBe("FFEDF3EC");
  });

  it("freezes the identifying columns and the heading", async () => {
    const tab = (await built()).getWorksheet("TD");
    expect(tab?.views?.[0]).toMatchObject({ state: "frozen", xSplit: 4, ySplit: 1 });
  });

  it("defines the ranges the formulas resolve through, and one list per dropdown", async () => {
    const book = await built();
    const names = book.definedNames.model.map((entry: { name: string }) => entry.name);

    expect(names).toEqual(
      expect.arrayContaining(["FYS_CRN", "FYS_KEY", "FYS_LOOKUP", "FYS_TD_GROUPS", "FYS_RDNS_GROUPS"]),
    );
  });

  it("offers the groups as a dropdown rather than something to mistype", async () => {
    const tab = (await built()).getWorksheet("TD");
    const validations = (tab as unknown as { dataValidations: { find: (a: string) => unknown } })
      .dataValidations;
    const rule = validations.find("E2") as { formulae?: string[] } | undefined;

    expect(rule?.formulae).toEqual(["=FYS_TD_GROUPS"]);
  });

  it("writes a Legend saying what each group holds", async () => {
    const legend = (await built()).getWorksheet("Legend");
    const text = [...Array(12).keys()]
      .flatMap((r) => [1, 2, 3].map((c) => String(legend?.getCell(r + 1, c).value ?? "")))
      .join(" | ");

    expect(text).toContain("Tab “TD”  →  column “TD group”");
    expect(text).toContain("23652");
  });
});
