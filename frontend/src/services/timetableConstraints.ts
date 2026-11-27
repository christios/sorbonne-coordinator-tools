/**
 * What the timetabler is told on top of the cards (27 Nov 2026): each teacher's answer to the
 * Timetable preferences request, and each course lead's weeks.
 *
 * The user's choices: a teacher's answer goes on every class row of theirs (Time Preference for
 * the hours they can't or would rather not teach, Day Preference for their limits, Room
 * Preference for their needs, Comments for their note) and, whole, on a sheet of its own; the
 * reasons a teacher gives stay in Coordinator Tools, since some are personal; a lead's weeks,
 * where laid out, are the row's "Weeks & Sessions per Week", exams included, and the order they
 * ticked is one of the row's constraints.
 */

import {
  COMPONENTS,
  componentOfRow,
  lengthWords,
  orderChoices,
  type Component,
  type CoursePlan,
  type PartHours,
  type PartKey,
  type RowKey,
  type TeachingWeek,
  withWeeksOff,
} from "@/services/coursePlans";
import { weeksSaid } from "@/services/semesterPlans";
import {
  KIND_NAME,
  answerLines,
  describeLine,
  summaryEntries,
  teachingWeeks,
  whenOf,
  type GridShape,
  type SummaryEntry,
  type WishCalendar,
  type WishCollection,
  type WishTeacher,
} from "@/services/teacherWishes";
import { formatDayAndMonth } from "@/services/weekSchedule";

/** A line of the Teacher constraints sheet, without the teacher's name, which the sheet's row carries; `limit` for a limit. */
export type ConstraintLine = { kind: string; when: string; weeks: string; limit?: boolean };

/** A teacher's answer in the workbook's words: the sheet's lines, and what each of their class rows says. */
export type TeacherWords = {
  lines: ConstraintLine[];
  /** Their hard and soft blocks, a line each: "Hard: Mon 08:00–10:00 (whole semester)". */
  time: string;
  /** Their limits, a line each: "Hard: At most 3 days on campus". */
  day: string;
  needs: string;
  note: string;
  /** "Sent 20 Nov", "Entered by a coordinator, 20 Nov", "Draft, not sent (saved 20 Nov)", "No answer yet". */
  answer: string;
};

/** "20 Nov", from an ISO time. */
function dayOf(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Where an answer stands, as the sheet says it. */
export function answerWords(teacher: Pick<WishTeacher, "wishes">): string {
  const wishes = teacher.wishes;
  if (!wishes) return "No answer yet";
  if (wishes.status !== "submitted") return `Draft, not sent${wishes.updatedAt ? ` (saved ${dayOf(wishes.updatedAt)})` : ""}`;
  const on = dayOf(wishes.submittedAt || wishes.updatedAt);
  return wishes.source === "coordinator" ? `Entered by a coordinator${on ? `, ${on}` : ""}` : `Sent${on ? ` ${on}` : ""}`;
}

/** "Whole semester", "From week 5 (22 Feb)", "Week 5 only (22 Feb)": which weeks a line of an answer holds for. */
function weeksOfEntry(entry: Pick<SummaryEntry, "repeat" | "week">, numberOf: Map<string, number>): string {
  if (entry.repeat === "all") return "Whole semester";
  const number = numberOf.get(entry.week);
  const dated = entry.week ? formatDayAndMonth(entry.week) : "";
  if (entry.repeat === "from") return number ? `From week ${number} (${dated})` : `From ${dated}`;
  return number ? `Week ${number} only` : "That week only";
}

/**
 * A teacher's answer in words, or null for none. Reasons are left out on purpose (user, 27 Nov
 * 2026): the file leaves the department, and a reason can be a teacher's own business.
 */
export function teacherWords(
  teacher: WishTeacher,
  collection: Pick<WishCollection, "firstHour" | "lastHour" | "days"> | null,
  calendar?: WishCalendar | null,
): TeacherWords | null {
  const wishes = teacher.wishes;
  if (!wishes) return null;
  const grid: GridShape | undefined = collection
    ? { firstHour: collection.firstHour, lastHour: collection.lastHour, days: collection.days }
    : undefined;
  const numberOf = new Map(teachingWeeks(calendar).map((week) => [week.monday, week.number]));
  const draft = wishes.status !== "submitted";
  const short = (kind: string) => (draft ? `(draft) ${kind}` : kind);

  // Blocks alike are one line, the way the teacher's own summary lists them; hard before soft.
  const entries = summaryEntries(wishes.blocks ?? []).sort(
    (left, right) => Number(left.kind !== "constraint") - Number(right.kind !== "constraint"),
  );
  const blockLines = entries.map((entry) => ({
    kind: KIND_NAME[entry.kind],
    hard: entry.kind === "constraint",
    when: whenOf(entry, grid),
    weeks: weeksOfEntry(entry, numberOf),
  }));
  // The limits, as the plan reads them: a limit is hard when the teacher said so.
  const limitLines = answerLines([], wishes.limits ?? {}, wishes.limitKinds ?? {}).map((line) => ({
    kind: line.level === "must" ? KIND_NAME.constraint : KIND_NAME.preference,
    hard: line.level === "must",
    when: describeLine(line),
    weeks: "Whole semester",
  }));
  const needs = wishes.needs?.trim() ?? "";
  const note = wishes.note?.trim() ?? "";

  const lines: ConstraintLine[] = [
    ...blockLines.map(({ kind, when, weeks }) => ({ kind, when, weeks })),
    ...limitLines.map(({ kind, when, weeks }) => ({ kind, when, weeks, limit: true })),
    ...(needs ? [{ kind: "Needs", when: needs, weeks: "" }] : []),
    ...(note ? [{ kind: "Note", when: note, weeks: "" }] : []),
  ];
  const rowLine = (line: { hard: boolean; when: string; weeks: string }) =>
    `${short(line.hard ? "Hard" : "Soft")}: ${line.when}${line.weeks ? ` (${line.weeks.charAt(0).toLowerCase()}${line.weeks.slice(1)})` : ""}`;
  return {
    lines: lines.length ? lines : [{ kind: "Nothing asked", when: "", weeks: "" }],
    time: blockLines.map(rowLine).join("\n"),
    day: limitLines.map((line) => rowLine({ ...line, weeks: "" })).join("\n"),
    needs,
    note,
    answer: answerWords(teacher),
  };
}

/** The row of a course's plan a class follows: the part whose CRNs hold it, else its component. */
export function rowKeyOf(plan: Pick<CoursePlan, "parts">, component: Component, crn: string): RowKey {
  const held = crn.trim();
  const part = held
    ? (Object.entries(plan.parts ?? {}) as [PartKey, PartHours][]).find(
        ([key, hours]) => componentOfRow(key) === component && hours.crns.includes(held),
      )?.[0]
    : undefined;
  return part ?? component;
}

/** "1st", "2nd", "3rd", "4th": a session's place in its week. */
function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  return `${place}${["th", "st", "nd", "rd"][place % 10] ?? "th"}`;
}

/**
 * A row's weeks, as the hand-kept workbook said them — "2 sessions – weeks 2–14", or "1 session
 * – weeks 1–4, 9–14; 2 sessions – weeks 5–8" — then the weeks whose sessions last otherwise and
 * the exams: "Exam in week 8 (2nd session)". Nothing when the row isn't laid out.
 */
export function courseWeeksWords(plan: Pick<CoursePlan, "weeks" | "lengths" | "exams">, key: RowKey): string {
  const byWeek = Object.entries(plan.weeks[key] ?? {})
    .map(([week, count]) => [Number(week), count] as const)
    .filter(([, count]) => count > 0)
    .sort((left, right) => left[0] - right[0]);
  if (!byWeek.length) return "";
  const counts = [...new Set(byWeek.map(([, count]) => count))];
  const sessions = counts
    .map((count) => {
      const weeks = byWeek.filter(([, held]) => held === count).map(([week]) => week);
      return { first: weeks[0], said: `${count} session${count === 1 ? "" : "s"} – ${weeksSaid(weeks).toLowerCase()}` };
    })
    .sort((left, right) => left.first - right.first)
    .map(({ said }) => said)
    .join("; ");
  const lengths = lengthWords(plan.lengths?.[key]);
  const countOf = new Map(byWeek);
  const exams = Object.entries(plan.exams?.[key] ?? {})
    .map(([week, places]) => [Number(week), places] as const)
    .filter(([week, places]) => places.length && countOf.has(week))
    .sort((left, right) => left[0] - right[0])
    .flatMap(([week, places]) =>
      places.map((place) => `week ${week}${(countOf.get(week) ?? 0) > 1 ? ` (${ordinal(place)} session)` : ""}`),
    );
  return [
    sessions,
    lengths ? `Sessions lasting otherwise: ${lengths}` : "",
    exams.length ? `Exam${exams.length === 1 ? "" : "s"} in ${exams.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The order a lead ticked, for a row of the kinds it concerns: "In a week with both: CM before TD/TP". */
export function courseOrderWords(plan: Pick<CoursePlan, "components" | "parts" | "cmFirst" | "tdBeforeTp">, component: Component): string {
  const choices = orderChoices(plan);
  const said: string[] = [];
  if (plan.cmFirst && choices.cm && (component === "CM" || choices.cm.includes(component))) said.push(`CM before ${choices.cm.join("/")}`);
  if (plan.tdBeforeTp && choices.td && (component === "TD" || component === "TP")) said.push("TD before TP");
  return said.length ? `In a week with both: ${said.join(", ")}` : "";
}

/** What a class row is told of its course's plan: its weeks and the order, each "" when there is none. */
export type CourseWords = { weeks: string; order: string };

/** A class's share of its course's plan, by the row's type ("TD") and CRN; null when it has no plan to follow. */
export function courseWordsOf(plan: CoursePlan | undefined, type: string, crn: string): CourseWords | null {
  const component = type.trim().toUpperCase() as Component;
  if (!plan || !(COMPONENTS as readonly string[]).includes(component)) return null;
  const words = { weeks: courseWeeksWords(plan, rowKeyOf(plan, component, crn)), order: courseOrderWords(plan, component) };
  return words.weeks || words.order ? words : null;
}

/** The semester's teaching weeks for the sheet that dates them: a week, its Monday, its holidays; a week off between. */
export function weekRows(weeks: TeachingWeek[]): { week: string; monday: string; note: string }[] {
  if (!weeks.length || weeks.some((week) => !week.monday)) return [];
  return withWeeksOff(weeks).map((column) =>
    column.week
      ? {
          week: `Week ${column.week.week}`,
          monday: formatDayAndMonth(column.week.monday),
          note: column.week.holidays.map((holiday) => `${formatDayAndMonth(holiday.date)} ${holiday.label}`.trim()).join("; "),
        }
      : { week: "Off", monday: formatDayAndMonth(column.off), note: "No teaching" },
  );
}
