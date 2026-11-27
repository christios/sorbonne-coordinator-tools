/**
 * The Semester plan's settings as the settings page edits them (27 Nov 2026).
 *
 * The user's asks: holidays of several days; the weeks without classes picked as weeks rather
 * than typed as one day each; the periods for everybody compact, since there will be plenty.
 *
 * Nothing changes in what is stored. A holiday of several days is kept a day each under one
 * name, as every holiday already was, so the plan, the course plans and the preferences request
 * read it as before; the page shows the days of one name in a row as one holiday again.
 */

import type { Holiday, Period } from "@/services/semesterPlans";
import { DAY_SHORT, isoPlus, isoWeekday, lengthWords } from "@/services/teacherWishes";
import { formatDayAndMonth } from "@/services/weekSchedule";

/** A holiday as the page has it: a first and a last day, and its name. */
export type HolidayRange = { from: string; to: string; label: string };

/** The holidays as ranges: the days of one name that follow one another make one. */
export function holidayRanges(holidays: Holiday[]): HolidayRange[] {
  const sorted = [...holidays].filter((each) => each.date).sort((a, b) => a.date.localeCompare(b.date));
  const ranges: HolidayRange[] = [];
  for (const holiday of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && last.label === holiday.label && isoPlus(last.to, 1) === holiday.date) last.to = holiday.date;
    else ranges.push({ from: holiday.date, to: holiday.date, label: holiday.label });
  }
  return ranges;
}

/** How many days a holiday covers, its first and last included; 0 while it isn't dated right. */
export function rangeDays(range: Pick<HolidayRange, "from" | "to">): number {
  if (!range.from || !range.to || range.to < range.from) return 0;
  let days = 1;
  for (let day = range.from; day < range.to; day = isoPlus(day, 1)) days += 1;
  return days;
}

/** The ranges as the server keeps them: a holiday a day, under its range's name. */
export function holidayDays(ranges: HolidayRange[]): Holiday[] {
  const days: Holiday[] = [];
  for (const range of ranges) {
    const to = range.to || range.from;
    if (!range.from || to < range.from) continue;
    for (let day = range.from; day <= to; day = isoPlus(day, 1)) days.push({ date: day, label: range.label.trim() });
  }
  return days;
}

/** A holiday's problem, or "": a first day, and a last day not before it. */
export function rangeProblem(range: HolidayRange): string {
  if (!range.from) return "Give it a first day.";
  if (range.to && range.to < range.from) return "Its last day comes before its first.";
  return "";
}

/** "Wed 31 Mar", "Tue 30 Mar – Thu 1 Apr". */
export function rangeWords(range: Pick<HolidayRange, "from" | "to">): string {
  const day = (iso: string) => `${DAY_SHORT[isoWeekday(iso)]} ${formatDayAndMonth(iso)}`;
  return !range.to || range.to === range.from ? day(range.from) : `${day(range.from)} – ${day(range.to)}`;
}

/** The Monday of the week a day is in. */
export const mondayOfDay = (iso: string) => isoPlus(iso, 1 - isoWeekday(iso));

/** A week of the semester as the weeks strip shows it: a teaching week by its number, or a break. */
export type SemesterWeek = { monday: string; number: number | null };

/**
 * The semester's weeks from Week 1 to the last teaching week, the breaks between them included:
 * a break pushes every later teaching week a week on, as the plan counts them.
 */
export function semesterWeeks(weekOne: string, weeks: number, without: string[]): SemesterWeek[] {
  if (!weekOne || weeks < 1) return [];
  const breaks = new Set(without.filter(Boolean).map(mondayOfDay));
  const out: SemesterWeek[] = [];
  let number = 0;
  // A semester of 30 teaching weeks and as many breaks at the most: never run on.
  for (let monday = mondayOfDay(weekOne); number < weeks && out.length < 90; monday = isoPlus(monday, 7)) {
    if (breaks.has(monday) && number > 0) out.push({ monday, number: null });
    else out.push({ monday, number: (number += 1) });
  }
  return out;
}

/** The breaks the strip can't show: before Week 1 or after the last teaching week. */
export function breaksOutside(weekOne: string, weeks: number, without: string[]): string[] {
  const shown = new Set(semesterWeeks(weekOne, weeks, without).map((week) => week.monday));
  return [...new Set(without.filter(Boolean).map(mondayOfDay))].filter((monday) => !shown.has(monday)).sort();
}

/** A week made a break, or taught again: the breaks as Mondays, earliest first. */
export function toggleBreak(without: string[], monday: string): string[] {
  const breaks = new Set(without.filter(Boolean).map(mondayOfDay));
  if (breaks.has(monday)) breaks.delete(monday);
  else breaks.add(monday);
  return [...breaks].sort();
}

/** "Week 1 starts Mon 25 Jan 2027 · 17 teaching weeks · 1 break · last week ends Fri 28 May 2027". */
export function semesterWords(weekOne: string, weeks: number, without: string[]): string {
  const all = semesterWeeks(weekOne, weeks, without);
  if (!all.length) return "Set Week 1 and how many teaching weeks it has.";
  const breaks = all.filter((week) => week.number === null).length;
  const dated = (iso: string) => `${DAY_SHORT[isoWeekday(iso)]} ${formatDayAndMonth(iso)} ${iso.slice(0, 4)}`;
  return [
    `Week 1 starts ${dated(all[0].monday)}`,
    `${weeks} teaching week${weeks === 1 ? "" : "s"}`,
    breaks ? `${breaks} break${breaks === 1 ? "" : "s"}` : "no break",
    `last week ends ${dated(isoPlus(all[all.length - 1].monday, 4))}`,
  ].join(" · ");
}

/** "Mon–Fri", "Mon, Wed", "every day": a period's days. */
export function daysWords(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "every day";
  const inARow = sorted.every((day, index) => !index || day === sorted[index - 1] + 1);
  if (sorted.length >= 3 && inARow) return `${DAY_SHORT[sorted[0]]}–${DAY_SHORT[sorted[sorted.length - 1]]}`;
  return sorted.map((day) => DAY_SHORT[day]).join(", ");
}

/** A period's rules, short, for its one-line row: "ends 15:00 · ≤ 1h30 · none 12:15–12:45 · teacher ≤ 4h". */
export function rulesShort(period: Period): string {
  return [
    period.endsBy ? `ends ${period.endsBy}` : "",
    period.longest ? `classes ≤ ${lengthWords(period.longest)}` : "",
    period.blockFrom && period.blockTo ? `none ${period.blockFrom}–${period.blockTo}` : "",
    period.dailyMax ? `teacher ≤ ${lengthWords(period.dailyMax)}/day` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "8 Feb – 9 Mar", "4 May": a period's dates. */
export function periodDates(period: Pick<Period, "from" | "to">): string {
  if (!period.from) return "No dates yet";
  if (!period.to || period.to === period.from) return formatDayAndMonth(period.from);
  return `${formatDayAndMonth(period.from)} – ${formatDayAndMonth(period.to)}`;
}
