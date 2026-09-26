import { describe, expect, it } from "vitest";

import type { ScheduleSection } from "@/services/crnSchedulePdf";
import { buildSemesterPdf, semesterFilename, semesterPages, semesterUnits, type SemesterExportInput } from "@/services/semesterPdf";

const meeting = (meetsOn: string, startsAt = "08:30", endsAt = "10:00", room = "5.101") => ({ meetsOn, startsAt, endsAt, room });
const section = (crn: string, courseCode: string, meetings: ScheduleSection["meetings"], group = ""): ScheduleSection => ({
  crn,
  courseCode,
  title: courseCode,
  teacher: "Grace Younes",
  group,
  meetings,
  notes: [],
});

/** Two weeks of classes with a week off between: three weeks from first to last. */
const SECTIONS = [
  section("23436", "MATH-351", [meeting("2026-09-07"), meeting("2026-09-21")], "TD 1"),
  section("22610", "PHYS-210", [meeting("2026-09-07", "09:00", "11:00", "4.124")]),
];
const input = (layout: SemesterExportInput["layout"] = "days", sections = SECTIONS): SemesterExportInput => ({
  semester: "Semester 1",
  layout,
  sections,
  weekOne: "2026-09-07",
});

describe("the semester's pages", () => {
  it("gives every week from the first class to the last its page, the empty one included", () => {
    const units = semesterUnits(input());
    expect(units.map((unit) => unit.title)).toEqual([
      "Week 1 · 7 Sep – 11 Sep 2026",
      "Week 2 · 14 Sep – 18 Sep 2026",
      "Week 3 · 21 Sep – 25 Sep 2026",
    ]);
    // Monday of Week 1 holds two overlapping classes, stacked.
    expect(units[0].rows[0]).toMatchObject({ label: "Mon 7", sub: "2 classes", lanes: 2 });
    expect(semesterPages(input(), { paper: "a4", across: 1, classHeight: 16 })).toHaveLength(3);
  });

  it("cuts a week across as many pages as it is wide, each with its stretch of hours", () => {
    const pages = semesterPages(input(), { paper: "a4", across: 2, classHeight: 16 });
    expect(pages).toHaveLength(6);
    expect(pages.filter((page) => page.unit === 0).map((page) => page.part)).toEqual(["08:00–13:00", "13:00–18:00"]);
    // The morning's classes are on the first page of the week, and none on the second.
    expect(pages[0].boxes).toHaveLength(2);
    expect(pages[1].boxes).toHaveLength(0);
  });

  it("carries rows on to another page when a class is drawn too tall for one", () => {
    const busy = Array.from({ length: 30 }, (_, index) => section(String(30000 + index), `MATH-${100 + index}`, [meeting("2026-09-07")]));
    const pages = semesterPages(input("days", busy), { paper: "a4", across: 1, classHeight: 40 });
    const first = pages.filter((page) => page.unit === 0);
    expect(first.length).toBeGreaterThan(1);
    // Monday is cut between its stacked classes and says so on the page it carries on to.
    expect(first[1].rows[0]).toMatchObject({ label: "Mon 7", sub: "continued" });
    // Every class is drawn once.
    expect(first.reduce((total, page) => total + page.boxes.length, 0)).toBe(30);
  });

  it("puts the rooms down the side, and a room's week along its row", () => {
    const units = semesterUnits(input("rooms-week"));
    expect(units[0].rows.map((row) => row.label)).toEqual(["4.124", "5.101"]);
    expect(units[0].bands).toHaveLength(5);
    // A week with no class in a room still has the room: a free room is the answer.
    expect(units[1].rows.map((row) => row.sub)).toEqual(["—", "—"]);
  });

  it("gives each day its own pages, one day of rooms at a time", () => {
    const units = semesterUnits(input("rooms-day"));
    // Monday of Week 1 to Monday of Week 3: eleven weekdays.
    expect(units).toHaveLength(11);
    expect(units[0].title).toBe("Week 1 · Mon 7 Sep 2026");
  });

  it("names the file after the semester and the page", () => {
    expect(semesterFilename(input())).toBe("Semester-1-timetable.pdf");
    expect(semesterFilename(input("rooms-week"))).toBe("Semester-1-rooms.pdf");
  });

  it("makes the PDF with as many pages as the preview counted", async () => {
    const zoom = { paper: "a4" as const, across: 2, classHeight: 16 };
    const bytes = new Uint8Array(await buildSemesterPdf(input(), zoom, new Date(2026, 8, 26)));
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(semesterPages(input(), zoom).length);
  });
});
