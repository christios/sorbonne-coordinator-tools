import { describe, expect, it } from "vitest";

import type { ScheduleSection } from "@/services/crnSchedulePdf";
import { buildSemesterPdf, frameOf, semesterFilename, semesterPages, semesterUnits, type SemesterExportInput } from "@/services/semesterPdf";

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
    expect(semesterPages(input(), { maxPages: null })).toHaveLength(3);
  });

  it("spans the whole width of the page with the week's hours, never cutting them", () => {
    const [page] = semesterPages(input(), { maxPages: null });
    const frame = frameOf("days");
    // 08:00 at the grid's left edge and 18:00 at the page's right one.
    expect(page.ticks[0].x).toBeCloseTo(frame.left + frame.labelWidth);
    expect(page.ticks[page.ticks.length - 1].x).toBeCloseTo(frame.right);
  });

  it("fills every page to its foot, whatever the ceiling", () => {
    const frame = frameOf("days");
    for (const maxPages of [1, 2, null]) {
      for (const page of semesterPages(input(), { maxPages })) {
        expect(page.gridBottom).toBeCloseTo(frame.bottom, 0);
      }
    }
  });

  it("carries a day on to another page when its classes will not fit one", () => {
    const busy = Array.from({ length: 30 }, (_, index) => section(String(30000 + index), `MATH-${100 + index}`, [meeting("2026-09-07")]));
    const pages = semesterPages(input("days", busy), { maxPages: null });
    const first = pages.filter((page) => page.unit === 0);
    expect(first.length).toBeGreaterThan(1);
    // Monday is cut between its stacked classes and says so on the page it carries on to.
    expect(first[1].rows[0]).toMatchObject({ label: "Mon 7", sub: "continued" });
    expect(first[1].part).toMatch(/page 2 of/);
    // Every class is drawn once.
    expect(first.reduce((total, page) => total + page.boxes.length, 0)).toBe(30);
  });

  it("draws a week smaller rather than past the most pages it may take", () => {
    // Long classes: every word fits on one line of a box, so they can shrink a long way.
    const busy = Array.from({ length: 30 }, (_, index) =>
      section(String(30000 + index), `MATH-${100 + index}`, [meeting("2026-09-07", "08:00", "12:00")]),
    );
    const free = semesterPages(input("days", busy), { maxPages: null }).filter((page) => page.unit === 0);
    const capped = semesterPages(input("days", busy), { maxPages: 1 }).filter((page) => page.unit === 0);

    expect(free.length).toBeGreaterThan(1);
    expect(capped).toHaveLength(1);
    expect(capped[0].boxes).toHaveLength(30);
    expect(capped[0].boxes[0].h).toBeLessThan(free[0].boxes[0].h);
    expect(capped[0].overCeiling).toBe(false);
  });

  it("takes a page more than the ceiling rather than a class too small to say everything", () => {
    // Short classes: their words need two or three lines, which thirty of cannot fit on one A4 page.
    const busy = Array.from({ length: 30 }, (_, index) => section(String(30000 + index), `MATH-${100 + index}`, [meeting("2026-09-07")]));
    const a4 = semesterPages(input("days", busy), { paper: "a4", maxPages: 1 }).filter((page) => page.unit === 0);
    const a3 = semesterPages(input("days", busy), { paper: "a3", maxPages: 1 }).filter((page) => page.unit === 0);

    expect(a4.length).toBeGreaterThan(1);
    expect(a4[0].overCeiling).toBe(true);
    // A3 has the room: the same words, the same size, one page.
    expect(a3).toHaveLength(1);
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
    const zoom = { maxPages: null };
    const bytes = new Uint8Array(await buildSemesterPdf(input(), zoom));
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text.match(/\/Type \/Page\b/g)?.length).toBe(semesterPages(input(), zoom).length);
  });
});
