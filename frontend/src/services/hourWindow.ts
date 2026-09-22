/**
 * The stretch of time the hours page is counting.
 *
 * A pay period nine times in ten, the whole semester when somebody wants the year's
 * shape, and any two dates when the question is "what did she teach while I was away".
 * One type for all three, because every number on the page is counted the same way over
 * whatever it says — the window is a pair of dates, not three kinds of question.
 */

import { periodEnd, periodLabel, shortPeriodLabel } from "@/services/payPeriods";

export type HourWindow = {
  /** ISO. Empty means no floor — the whole semester. */
  from: string;
  /** ISO. Empty means no ceiling. */
  to: string;
  /** What the button says: "15 Sep – 14 Oct 2026", "Whole semester", "3 – 19 Oct 2026". */
  label: string;
  /**
   * The mark every column carries, or empty for the whole semester.
   *
   * Short, because it sits on a dozen headings at once, and absent for the whole semester
   * because a mark on every column that says "all of it" is a mark nobody reads.
   */
  tag: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const WHOLE_SEMESTER: HourWindow = { from: "", to: "", label: "Whole semester", tag: "" };

/** A pay period, named the way the rest of the application names it. */
export function windowForPeriod(start: string): HourWindow {
  return {
    from: start,
    to: periodEnd(start),
    label: periodLabel(start),
    // "AUG-SEP": the short form the time sheets are called by, in the register's voice.
    tag: shortPeriodLabel(start).replace(/\s\d{4}$/, "").replace("–", "-").toUpperCase(),
  };
}

function day(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const made = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(made.getTime()) ? null : made;
}

/** Any two dates somebody picked, named by the dates themselves. */
export function windowForRange(from: string, to: string): HourWindow {
  const opened = day(from);
  const closed = day(to);
  if (!opened || !closed) return WHOLE_SEMESTER;
  const [first, last] = opened <= closed ? [opened, closed] : [closed, opened];
  const said = (value: Date) => `${value.getDate()} ${MONTHS[value.getMonth()]}`;
  const label =
    first.getFullYear() === last.getFullYear()
      ? `${said(first)} – ${said(last)} ${last.getFullYear()}`
      : `${said(first)} ${first.getFullYear()} – ${said(last)} ${last.getFullYear()}`;
  return {
    from: iso(first),
    to: iso(last),
    label,
    tag: `${MONTHS[first.getMonth()]}-${MONTHS[last.getMonth()]}`.toUpperCase(),
  };
}

function iso(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/** Whether this window is the whole semester, which is what "count everything" means. */
export function isWholeSemester(window: HourWindow): boolean {
  return !window.from && !window.to;
}

/** The dates to count over, with the open ends filled in so a comparison is simple. */
export function datesOf(window: HourWindow): { from: string; to: string } {
  return { from: window.from || "0000-01-01", to: window.to || "9999-12-31" };
}
