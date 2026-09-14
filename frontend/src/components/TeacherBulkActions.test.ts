import { describe, expect, it } from "vitest";

import { asSpreadsheet, type SheetLine } from "./TeacherBulkActions";

const line = (teacher: string, label: string, periodStart: string, url: string): SheetLine => ({
  teacher,
  sheet: {
    id: `${teacher}-${label}`,
    teacherId: "t",
    label,
    academicYear: "2026-2027",
    url,
    periodStart,
    createdAt: "",
    updatedAt: "",
  },
});

describe("the time sheet list a selection comes to", () => {
  it("names the teacher, the period and the link on every row", () => {
    const csv = asSpreadsheet([
      line("Amina Menaa", "Part time sheet", "2026-08-15", "https://example.org/a"),
      line("Bilal Maaz", "Part time sheet", "", "https://example.org/b"),
    ]);
    const rows = csv.split("\r\n");

    expect(rows[0]).toContain('"Teacher","Time sheet","Period","Academic year","Link"');
    expect(rows[1]).toBe('"Amina Menaa","Part time sheet","15 Aug – 14 Sep 2026","2026-2027","https://example.org/a"');
    // A sheet nobody has dated says so rather than leaving a blank to puzzle over.
    expect(rows[2]).toContain('"not said"');
  });

  it("survives a comma or a quotation mark in a name", () => {
    const csv = asSpreadsheet([line('El "Doc" Khoury, Jeanine', "Sheet", "2026-08-15", "https://example.org/c")]);
    expect(csv.split("\r\n")[1]).toContain('"El ""Doc"" Khoury, Jeanine"');
  });

  it("starts with a byte-order mark, or Excel mangles the accented names", () => {
    expect(asSpreadsheet([]).startsWith("﻿")).toBe(true);
  });
});
