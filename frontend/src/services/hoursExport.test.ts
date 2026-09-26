import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { addsUp, buildHoursBuffer, columnLetter, periodsCovering, rowKey } from "@/services/hoursExport";
import { hoursColumns } from "@/services/teacherLoad";
import type { LoadRow } from "@/services/teacherLoad";

const row = (teacher: string, over: Partial<LoadRow> = {}): LoadRow => ({
  teacherId: "",
  teacher,
  bySheet: [0],
  byType: {},
  total: 0,
  sections: 0,
  standing: "Confirmed",
  active: null,
  crns: [],
  cancelledHours: 0,
  coverTaken: 0,
  coverGiven: 0,
  requisitionedHours: 0,
  adminHours: 0,
  registrarHours: 0,
  warnings: [],
  ...over,
});

const COLUMNS = hoursColumns(["BSc-L1-S1"]).filter((column) =>
  ["teacher", "total", "sections", "cancelledHours"].includes(column.id),
);

async function bookOf(input: Parameters<typeof buildHoursBuffer>[0]): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildHoursBuffer(input));
  return book;
}

const SEMESTER = {
  semester: "BSc L1 · Semester 1",
  columns: COLUMNS,
  plan: [row("Sara Zaki", { total: 21 }), row("Wafa Ahmed", { total: 42 })],
  periods: [
    { start: "2026-09-15", rows: [row("Sara Zaki", { total: 6 }), row("Wafa Ahmed", { total: 9 })] },
    { start: "2026-10-15", rows: [row("Sara Zaki", { total: 7.5 })] },
  ],
};

describe("which figures can be added across periods", () => {
  it("adds hours, and refuses to add anything that is not hours", () => {
    expect(addsUp("total")).toBe(true);
    expect(addsUp("sheet:BSc-L1-S1")).toBe(true);
    expect(addsUp("type:CM")).toBe(true);
    // A teacher holding one section all semester does not hold four because there are
    // four periods.
    expect(addsUp("sections")).toBe(false);
    // The portal's employment type, which is a word, not an hour.
    expect(addsUp("type")).toBe(false);
    expect(addsUp("email")).toBe(false);
  });
});

describe("the periods a semester covers", () => {
  it("runs from the first class to the last, and keeps the quiet months in between", () => {
    expect(periodsCovering(["2026-09-07", "2026-12-09", "2026-10-20"], 15)).toEqual([
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
    ]);
  });

  it("says nothing about a semester with no classes booked", () => {
    expect(periodsCovering([], 15)).toEqual([]);
  });
});

describe("columnLetter", () => {
  it("counts past Z the way a spreadsheet does", () => {
    expect([1, 4, 26, 27, 28].map(columnLetter)).toEqual(["A", "D", "Z", "AA", "AB"]);
  });
});

describe("the workbook", () => {
  it("has the master in front and one sheet per pay period", async () => {
    const book = await bookOf(SEMESTER);

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual([
      "Whole semester",
      "15 Sep – 14 Oct 2026",
      "15 Oct – 14 Nov 2026",
    ]);
  });

  it("writes what each period taught, in its own sheet", async () => {
    const book = await bookOf(SEMESTER);
    const october = book.getWorksheet("15 Oct – 14 Nov 2026");

    expect(october?.getCell("A4").value).toBe("Sara Zaki");
    expect(october?.getCell("B4").value).toBe(7.5);
    // A teacher who taught nothing this period keeps her row, at nought: a row that
    // disappears for a month reads as a teacher who left.
    expect(october?.getCell("A5").value).toBe("Wafa Ahmed");
    expect(october?.getCell("B5").value).toBe(0);
  });

  it("sums the period sheets on the master, as a formula that stays live", async () => {
    const book = await bookOf(SEMESTER);
    const master = book.getWorksheet("Whole semester");

    expect((master?.getCell("B4").value as { formula: string }).formula).toBe(
      "'15 Sep – 14 Oct 2026'!B4+'15 Oct – 14 Nov 2026'!B4",
    );
  });

  it("keeps the plan beside the sum, and the distance between them", async () => {
    const book = await bookOf(SEMESTER);
    const master = book.getWorksheet("Whole semester");

    // Four columns, then the plan, then what the plan is short of what met.
    expect(master?.getCell("E3").value).toBe("Plan");
    expect(master?.getCell("E4").value).toBe(21);
    expect((master?.getCell("F4").value as { formula: string }).formula).toBe("E4-B4");
  });

  it("does not add up a count of sections across the periods", async () => {
    const book = await bookOf(SEMESTER);
    const master = book.getWorksheet("Whole semester");

    expect(master?.getCell("C4").value).toBe(0);
  });

  it("closes every sheet with a total of its own", async () => {
    const book = await bookOf(SEMESTER);
    const september = book.getWorksheet("15 Sep – 14 Oct 2026");

    expect(september?.getCell("A6").value).toBe("All teachers");
    expect((september?.getCell("B6").value as { formula: string }).formula).toBe("SUM(B4:B5)");
  });

  it("stands up on a semester with no periods at all", async () => {
    const book = await bookOf({ ...SEMESTER, periods: [] });
    const master = book.getWorksheet("Whole semester");

    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["Whole semester"]);
    expect(master?.getCell("B4").value).toBe(0);
  });
});

describe("rowKey", () => {
  it("is the name, so the same teacher lands on the same row on every sheet", () => {
    expect(rowKey({ teacher: " Sara Zaki " })).toBe(rowKey({ teacher: "sara zaki" }));
  });

  it("sends the rows nobody is named on to the end", () => {
    expect(rowKey({ teacher: "" }) > rowKey({ teacher: "Zoe" })).toBe(true);
  });
});
