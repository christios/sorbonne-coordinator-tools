/**
 * The department's pay period: the 15th of one month to the 14th of the next.
 *
 * This is why five of the nine time sheets filed for 2026-27 are called "AugSept". They
 * are one period, not two months, and a pair of month fields would have recorded them
 * as something nobody meant. So a period is one choice, named by the day it starts, and
 * everything else here is derived from that day.
 *
 * The cycle lives in this file alone. The server stores the date it is given and does
 * not know the 15th from any other day, which is what lets the cycle change one day
 * without a migration — and that day is now a semester's to set, so the two functions
 * that need it take it, while everything derived from a start date carries on knowing
 * nothing about cycles at all.
 */

/**
 * The day of the month a period opens on where nobody has said otherwise.
 *
 * Every semester today is paid from the 15th, so this is what they all use until one of
 * them says different. It is the answer, not a placeholder.
 */
export const PERIOD_OPENS_ON = 15;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const [, year, month, date] = match;
  const made = new Date(Number(year), Number(month) - 1, Number(date));
  return Number.isNaN(made.getTime()) ? null : made;
}

function asDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const date = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${date}`;
}

/** The period a given day falls in, as the day that period starts. */
export function periodContaining(day: Date, opensOn: number = PERIOD_OPENS_ON): string {
  const start = new Date(day.getFullYear(), day.getMonth(), opensOn);
  // Before the day it opens we are still in the period that opened last month.
  if (day.getDate() < opensOn) start.setMonth(start.getMonth() - 1);
  return asDay(start);
}

/** The last day of the period that starts on this day: the 14th of the month after. */
export function periodEnd(start: string): string {
  const opened = parse(start);
  if (!opened) return "";
  const closes = new Date(opened.getFullYear(), opened.getMonth() + 1, opened.getDate());
  closes.setDate(closes.getDate() - 1);
  return asDay(closes);
}

/**
 * How a period reads: "15 Aug – 14 Sep 2026", with the year said once where both ends
 * share it. A period spanning the new year says both, because "15 Dec – 14 Jan" alone
 * would leave the reader to guess which January.
 */
export function periodLabel(start: string): string {
  const opened = parse(start);
  const closed = parse(periodEnd(start));
  if (!opened || !closed) return "";
  const from = `${opened.getDate()} ${MONTHS[opened.getMonth()]}`;
  const to = `${closed.getDate()} ${MONTHS[closed.getMonth()]}`;
  return opened.getFullYear() === closed.getFullYear()
    ? `${from} – ${to} ${closed.getFullYear()}`
    : `${from} ${opened.getFullYear()} – ${to} ${closed.getFullYear()}`;
}

/** The short form a crowded row uses: "Aug–Sep 2026". */
export function shortPeriodLabel(start: string): string {
  const opened = parse(start);
  const closed = parse(periodEnd(start));
  if (!opened || !closed) return "";
  return `${MONTHS[opened.getMonth()]}–${MONTHS[closed.getMonth()]} ${closed.getFullYear()}`;
}

/**
 * The periods to offer, newest first: the one running now, a few behind it, and one
 * ahead for a sheet filed early.
 */
export function periodChoices(
  today = new Date(),
  behind = 14,
  ahead = 1,
  opensOn: number = PERIOD_OPENS_ON,
): string[] {
  const current = parse(periodContaining(today, opensOn));
  if (!current) return [];
  const found: string[] = [];
  for (let step = ahead; step >= -behind; step -= 1) {
    const start = new Date(current.getFullYear(), current.getMonth() + step, opensOn);
    found.push(asDay(start));
  }
  return found;
}

/**
 * How many whole periods ago a sheet is, so a row can say a sheet is old without the
 * reader working out dates. Zero is the period running now, one is the one before it.
 * Null where the sheet has no period, which is not the same as being out of date.
 */
export function periodsBehind(start: string, today = new Date()): number | null {
  const opened = parse(start);
  const current = parse(periodContaining(today));
  if (!opened || !current) return null;
  return (current.getFullYear() - opened.getFullYear()) * 12 + (current.getMonth() - opened.getMonth());
}

/**
 * The day a semester's periods open on, from what the server holds.
 *
 * A semester nobody has decided about is paid the usual way. The caller passes the map
 * rather than this reaching for it, because the same map answers for every semester on
 * a page and asking once is the difference between one request and one per row.
 */
export function opensOnFor(cycles: Record<string, number>, termId: string, fallback = PERIOD_OPENS_ON): number {
  const held = cycles[termId];
  return typeof held === "number" && held >= 1 ? held : fallback;
}

/** "the 15th", "the 1st" — the cycle said the way a coordinator would say it. */
export function cycleLabel(opensOn: number): string {
  const tens = opensOn % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][opensOn % 10] ?? "th";
  return `the ${opensOn}${suffix}`;
}
