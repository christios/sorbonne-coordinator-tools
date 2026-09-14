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
 * without a migration.
 */

/** The day of the month a period opens on. */
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
export function periodContaining(day: Date): string {
  const start = new Date(day.getFullYear(), day.getMonth(), PERIOD_OPENS_ON);
  // Before the 15th we are still in the period that opened last month.
  if (day.getDate() < PERIOD_OPENS_ON) start.setMonth(start.getMonth() - 1);
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
export function periodChoices(today = new Date(), behind = 14, ahead = 1): string[] {
  const current = parse(periodContaining(today));
  if (!current) return [];
  const found: string[] = [];
  for (let step = ahead; step >= -behind; step -= 1) {
    const start = new Date(current.getFullYear(), current.getMonth() + step, PERIOD_OPENS_ON);
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
