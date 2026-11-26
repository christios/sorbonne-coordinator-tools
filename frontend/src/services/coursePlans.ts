/**
 * Course plans: each course's hours, its lead, and its weeks, semester by semester.
 *
 * Coordinators set a course's CM, TD and TP hours (TD and TP per group) and the length of
 * one session of each — the targets, locked for the lead — and pick its lead by hand. The
 * lead lays the sessions out over the teaching weeks in their preferences request, or a
 * coordinator does for them. One plan per course per semester, shared by every cohort.
 *
 * The teaching weeks are the Semester plan's: numbered from Week 1, the weeks without
 * classes taking no number. The plan reads the layout to propose a series' weeks and to flag
 * one that does not match; Groups & CRNs rows are compared with the hours, never rewritten.
 */

import { apiFetch } from "@/services/http";
import { hoursOf, mayShareStudents, weeksSaid, type Plan, type PlanClass, type PlanSection } from "@/services/semesterPlans";
import { DAY_NAMES, formatDayAndMonth, parseIsoDate, toIsoDate } from "@/services/weekSchedule";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/course-plans`;

export const COMPONENTS = ["CM", "TD", "TP"] as const;
export type Component = (typeof COMPONENTS)[number];

/**
 * A component's hours in the semester — per group for TD and TP — and one session's length,
 * as Groups & CRNs has them (23 Nov 2026), and what stands in the way where it can't say:
 * "No session length in Groups & CRNs yet", "Groups & CRNs says 7.5 h and 12 h".
 */
export type ComponentHours = {
  hours: number | null;
  length: number | null;
  issue?: string;
  /** Where the figure comes from: what the course asks, or its sections, which agree. */
  source?: "" | "asks" | "sections";
  /** The sections whose own figure differs from it, as exceptions: "TD 3 says 45 h". */
  exceptions?: string[];
  /** Whether its groups are taught in parts, each part a row of its own: every one, some, or none. */
  split?: "" | "some" | "all";
};

/**
 * A part of a component's groups taught in parts (25 Nov 2026): "CM:2" is the second stretch of
 * every CM group taught in parts, laid out in its own weeks — Algebra 2's CM is 30 h of one
 * teacher, then 15 h of another.
 */
export type PartKey = `${Component}:${number}`;
/** A row of a course's weeks: a component, or a part of one. */
export type RowKey = Component | PartKey;

/** A part's hours and session length (the component's, where it says none), who teaches it, and the groups and CRNs it is. */
export type PartHours = ComponentHours & { teachers: string[]; groups: string[]; crns: string[] };

/** Sessions per teaching week, by row: `{ TD: { "2": 1, "3": 1 }, "CM:2": { "9": 1 } }`; weeks with none left out. */
export type Layout = Partial<Record<RowKey, Record<string, number>>>;

/**
 * The weeks whose sessions last other than the usual length, each session's hours, so one week
 * can hold a usual session and a three-hour exam: `{ CM: { "8": [1.5, 3] } }`.
 */
export type Lengths = Partial<Record<RowKey, Record<string, number[]>>>;

/**
 * The sessions that are exams (26 Nov 2026), each its place among its week's sessions from 1:
 * `{ TD: { "8": [2] } }`, the second TD session of week 8. An exam is a session of its kind: it
 * counts in that kind's hours and keeps its groups.
 */
export type Exams = Partial<Record<RowKey, Record<string, number[]>>>;

export type TeachingWeek = {
  week: number;
  /** "2027-01-11"; "" while the semester's Week 1 is not set. */
  monday: string;
  holidays: { date: string; label: string }[];
};

export type CoursePlan = {
  courseCode: string;
  title: string;
  coefficient: string;
  /** Still on the semester's list of active courses. */
  active: boolean;
  components: Record<Component, ComponentHours>;
  /** The parts of its groups taught in parts, by row: absent from an older server. */
  parts?: Partial<Record<PartKey, PartHours>>;
  hoursUpdatedAt: string;
  hoursUpdatedBy: string;
  leadId: string;
  leadName: string;
  leadSetAt: string;
  leadSetBy: string;
  weeks: Layout;
  /** Absent from a server older than week lengths: every session then lasts the usual length. */
  lengths?: Lengths;
  note: string;
  /** Why the weeks run unevenly over the semester, as the lead said; absent from an older server. */
  paceReason?: string;
  /** In a week holding both, the CM comes before the TD and TP (26 Nov 2026); absent from an older server. */
  cmFirst?: boolean;
  /** In a week holding both, the TD comes before the TP. */
  tdBeforeTp?: boolean;
  /** The sessions that are exams; absent from an older server. */
  exams?: Exams;
  /** When the weeks were last laid out, by whom, and how: by the lead, or a coordinator for them. */
  answeredAt: string;
  answeredBy: string;
  answerSource: "" | "lead" | "coordinator";
};

export type CoursePlanSemester = { termCode: string; weeks: TeachingWeek[]; courses: CoursePlan[] };

/** What a coordinator changes: some components' hours, the lead, or both. */
export type PlanChange = {
  hours?: Partial<Record<Component, { hours: number | string | null; length: number | string | null }>>;
  leadId?: string;
};

export const COMPONENT_WORDS: Record<Component, string> = {
  CM: "Lectures (CM)",
  TD: "Tutorials (TD)",
  TP: "Practicals (TP)",
};

async function answer<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail = fallback;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the fallback stands
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export async function fetchCoursePlans(term: string): Promise<CoursePlanSemester> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(term)}`), "The course plans could not be read.");
}

export async function changeCoursePlan(term: string, courseCode: string, change: PlanChange): Promise<CoursePlan> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(term)}/${encodeURIComponent(courseCode)}`, json("PATCH", change)),
    "That could not be saved. Try again in a moment.",
  );
}

/** The weeks laid out by a coordinator, for the lead. */
export async function layOutCourse(
  term: string,
  courseCode: string,
  layout: { weeks: Layout; lengths: Lengths; exams?: Exams; cmFirst?: boolean; tdBeforeTp?: boolean; note?: string },
): Promise<CoursePlan> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(term)}/${encodeURIComponent(courseCode)}/weeks`, json("PUT", layout)),
    "The course schedule could not be saved. Try again in a moment.",
  );
}

// ------------------------------------------------------------------ arithmetic

/** "1.5", "24": a number of hours as a person writes it. */
export function figure(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The components the coordinators gave hours to, in CM, TD, TP order. */
export function componentsOf(plan: Pick<CoursePlan, "components">): Component[] {
  return COMPONENTS.filter((component) => (plan.components[component]?.hours ?? 0) > 0);
}

/** The component a row is of: "CM" for "CM" and "CM:2" alike. */
export function componentOfRow(key: RowKey | string): Component {
  return key.split(":")[0] as Component;
}

/** Which part a row is, from 1; 0 for a component's own row. */
export function partOfRow(key: RowKey | string): number {
  const [, part] = key.split(":");
  return part ? Number(part) : 0;
}

/** "CM", "CM part 2": a row as words. */
export function rowWords(key: RowKey | string): string {
  const part = partOfRow(key);
  return part ? `${componentOfRow(key)} part ${part}` : key;
}

/** A row's hours and session length: its component's, or its part's. */
export function heldOf(plan: Pick<CoursePlan, "components" | "parts">, key: RowKey): ComponentHours | undefined {
  return partOfRow(key) ? plan.parts?.[key as PartKey] : plan.components[key as Component];
}

/** A row of the course's weeks, as the grid lays it out. */
export type PlanRow = { key: RowKey; component: Component; part: number; held: ComponentHours; teachers: string[] };

/**
 * The rows a course is laid out in, CM, TD, TP order: a component the coordinators gave hours
 * to, and after it each part of its groups taught in parts (25 Nov 2026). Where every group of
 * the component is taught in parts, the parts are its rows and the component has none of its own.
 */
export function rowsOf(plan: Pick<CoursePlan, "components" | "parts">): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const component of COMPONENTS) {
    const held = plan.components[component];
    const parts = (Object.entries(plan.parts ?? {}) as [PartKey, PartHours][])
      .filter(([key]) => componentOfRow(key) === component)
      .sort(([left], [right]) => partOfRow(left) - partOfRow(right));
    if ((held?.hours ?? 0) > 0 && !(held.split === "all" && parts.length)) rows.push({ key: component, component, part: 0, held, teachers: [] });
    if (!(held?.hours ?? 0) && !parts.length) continue;
    for (const [key, part] of parts) rows.push({ key, component, part: partOfRow(key), held: part, teachers: part.teachers ?? [] });
  }
  return rows;
}

/**
 * Every row spread evenly over the semester, as a layout to start from. A part too (user, 25 Nov
 * 2026): the parts of a group taught in parts are interspersed through the term, each teacher's
 * sessions over every week, rather than one handing over to the next; changed freely after.
 */
export function spreadRows(plan: Pick<CoursePlan, "components" | "parts">, weeks: number[]): Layout {
  const spread: Layout = {};
  for (const row of rowsOf(plan)) {
    const even = spreadEvenly(row.held.hours ?? 0, row.held.length ?? 0, weeks);
    if (Object.keys(even).length) spread[row.key] = even;
  }
  return spread;
}

export function sessionsOf(byWeek: Record<string, number> | undefined): number {
  return Object.values(byWeek ?? {}).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
}

/** Whether anybody has laid out any week of the course. */
export function laidOut(layout: Layout): boolean {
  return Object.values(layout).some((byWeek) => sessionsOf(byWeek) > 0);
}

/**
 * How long each of a week's sessions lasts: the week's own lengths where it has them (one per
 * session, padded with the usual length or cut to the count), else the usual length for each.
 */
export function sessionLengths(usual: number, own: number[] | undefined, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => own?.[index] ?? usual);
}

/** A week's hours for a row: its sessions' lengths added up. */
export function weekHours(
  plan: Pick<CoursePlan, "components" | "parts">,
  lengths: Lengths,
  component: RowKey,
  week: number | string,
  count: number,
): number {
  return sessionLengths(heldOf(plan, component)?.length ?? 0, lengths[component]?.[String(week)], count).reduce((sum, hours) => sum + hours, 0);
}

/** Hours a row's sessions add up to, week by week. */
export function hoursLaidOut(
  plan: Pick<CoursePlan, "components" | "parts">,
  layout: Layout,
  component: RowKey,
  lengths: Lengths = {},
): number {
  return Object.entries(layout[component] ?? {}).reduce(
    (sum, [week, count]) => sum + (count > 0 ? weekHours(plan, lengths, component, week, count) : 0),
    0,
  );
}

/** "3 h", "1.5 h + 3 h": one week's own session lengths, said. */
export function sessionsWords(hours: number[]): string {
  return new Set(hours).size === 1 ? `${figure(hours[0])} h` : hours.map((each) => `${figure(each)} h`).join(" + ");
}

/** "3 h in week 8 · 1.5 h + 3 h in week 12": the weeks whose sessions last other than usual. */
export function lengthWords(byWeek: Record<string, number[]> | undefined): string {
  const by = new Map<string, number[]>();
  for (const [week, hours] of Object.entries(byWeek ?? {})) {
    const said = sessionsWords(hours);
    by.set(said, [...(by.get(said) ?? []), Number(week)]);
  }
  return [...by.entries()]
    .sort((a, b) => Math.min(...a[1]) - Math.min(...b[1]))
    .map(([said, weeks]) => `${said} in ${weeksSaid(weeks.sort((x, y) => x - y)).toLowerCase()}`)
    .join(" · ");
}

// ------------------------------------------------------------------ order and exams

/**
 * A week's exams for a row, kept to its sessions: a place past the week's count goes, as a
 * session taken away takes its length with it; a week with none keeps no exams.
 */
export function withExams(current: Exams, row: RowKey, week: number | string, places: number[], count: number): Exams {
  const kept = [...new Set(places)].filter((place) => place >= 1 && place <= count).sort((a, b) => a - b);
  const byWeek = { ...(current[row] ?? {}) };
  if (kept.length) byWeek[String(week)] = kept;
  else delete byWeek[String(week)];
  const next: Exams = { ...current, [row]: byWeek };
  if (!Object.keys(byWeek).length) delete next[row];
  return next;
}

/** The weeks holding an exam, row by row: "TD exam in week 8", "CM exams in weeks 7, 14". */
export function examWords(exams: Exams | undefined): string[] {
  return (Object.entries(exams ?? {}) as [RowKey, Record<string, number[]>][])
    .map(([row, byWeek]) => {
      const weeks = Object.entries(byWeek)
        .filter(([, places]) => places.length)
        .map(([week]) => Number(week))
        .sort((a, b) => a - b);
      const many = Object.values(byWeek).reduce((sum, places) => sum + places.length, 0) > 1;
      return weeks.length ? `${rowWords(row)} exam${many ? "s" : ""} in ${weeksSaid(weeks).toLowerCase()}` : "";
    })
    .filter(Boolean);
}

/** Which order tick boxes a course has: the CM's, once it has a CM and a TD or TP; the TD's, once it has a TD and a TP. */
export function orderChoices(plan: Pick<CoursePlan, "components" | "parts">): { cm: Component[] | null; td: boolean } {
  const kinds = new Set(rowsOf(plan).map((row) => row.component));
  const after = (["TD", "TP"] as const).filter((kind) => kinds.has(kind));
  return { cm: kinds.has("CM") && after.length ? [...after] : null, td: kinds.has("TD") && kinds.has("TP") };
}

/** The order a lead asked for, in words: "CM before TD/TP", "TD before TP"; none for no order. */
export function orderWords(plan: Pick<CoursePlan, "components" | "parts" | "cmFirst" | "tdBeforeTp">): string[] {
  const choices = orderChoices(plan);
  return [
    plan.cmFirst && choices.cm ? `CM before ${choices.cm.join("/")}` : "",
    plan.tdBeforeTp && choices.td ? "TD before TP" : "",
  ].filter(Boolean);
}

/**
 * The reason a lead can give at a press when the TPs come later (26 Nov 2026): the CM and TD run
 * ahead to prepare the students for them — "CM and TD first, to prepare for the TPs".
 */
export function readyReason(course: Pick<CoursePlan, "components" | "parts">): string {
  const kinds = new Set(rowsOf(course).map((row) => row.component));
  const before = (["CM", "TD"] as const).filter((kind) => kinds.has(kind));
  return kinds.has("TP") && before.length ? `${before.join(" and ")} first, to prepare for the TPs` : "";
}

/**
 * The semester's first week with sessions, when it holds a TD or TP and no CM (26 Nov 2026): the
 * first session of a semester is usually a CM. Said only once the CM is laid out somewhere, so a
 * lead filling in the TD first isn't warned before they get to it.
 */
export function startsWithoutCm(plan: Pick<CoursePlan, "components" | "parts">, layout: Layout, weeks: number[]): { week: number; kinds: Component[] } | null {
  const rows = rowsOf(plan);
  const cm = rows.filter((row) => row.component === "CM");
  if (!cm.some((row) => sessionsOf(layout[row.key]) > 0)) return null;
  for (const week of weeks) {
    const held = rows.filter((row) => (layout[row.key]?.[String(week)] ?? 0) > 0);
    if (!held.length) continue;
    if (held.some((row) => row.component === "CM")) return null;
    return { week, kinds: [...new Set(held.map((row) => row.component))] };
  }
  return null;
}

/**
 * A row's target as whole sessions, spread over every teaching week: as many in each, and the
 * ones left over evenly apart — 16 sessions over 14 weeks are one a week and two in weeks 4
 * and 11; 10 over 14 skip four weeks spread through the semester.
 */
export function spreadEvenly(target: number, length: number, weeks: number[]): Record<string, number> {
  if (!(target > 0 && length > 0) || !weeks.length) return {};
  const sessions = Math.max(1, Math.round(target / length));
  const each = Math.floor(sessions / weeks.length);
  const extra = sessions - each * weeks.length;
  const spread: Record<string, number> = {};
  weeks.forEach((week, index) => {
    const more = Math.floor(((index + 1) * extra) / weeks.length) - Math.floor((index * extra) / weeks.length);
    if (each + more > 0) spread[String(week)] = each + more;
  });
  return spread;
}

/**
 * How far a component's sessions stray from an even pace over the semester (23 Nov 2026).
 *
 * Its hours, added up week by week, against the same hours spread evenly over every teaching
 * week. A layout is uneven once the two are more than two weeks' worth of hours apart at the
 * end of some week — or a session's worth, where a session is longer than that, so a
 * component of a few sessions spread as evenly as whole sessions allow is never called
 * uneven. A course starting a week or two late, or ending a week or two early for exams, is
 * still even; four weeks of everything up front is not.
 *
 * Measured against the hours laid out, not the coordinators' target: whether those add up is
 * said already, and the shape is all this says.
 */
export type Pace = {
  state: "unset" | "even" | "ahead" | "behind";
  /** The semester's first teaching week, and where the gap is widest: the week, the hours done by its end, and what an even pace would have done. */
  from: number;
  week: number;
  done: number;
  even: number;
  /** The hours laid out, and an even week's share of them. */
  total: number;
  perWeek: number;
  /** Each teaching week: its hours, and whether the hours done by its end are off an even pace. */
  weeks: { week: number; hours: number; off: boolean }[];
  /** An even pace in sessions: "2–3 sessions a week", "1 session most weeks", "1 session every 3–4 weeks". */
  usual: string;
};

/** Weeks' worth of hours an even layout may run ahead or behind. */
export const PACE_WEEKS = 2;

export function paceOf(
  plan: Pick<CoursePlan, "components" | "parts">,
  layout: Layout,
  lengths: Lengths,
  component: RowKey,
  every: number[],
): Pace | null {
  const length = heldOf(plan, component)?.length ?? 0;
  const target = heldOf(plan, component)?.hours ?? 0;
  /*
   * A part runs for a stretch of the semester (25 Nov 2026): its pace is measured from its first
   * week laid out to its last, so a second half is not "too few sessions" for its first weeks.
   * Laid out nowhere yet, it has no stretch to aim within.
   */
  const part = partOfRow(component) > 0;
  const held = every.filter((week) => (layout[component]?.[String(week)] ?? 0) > 0);
  const weeks = part && held.length ? every.filter((week) => week >= held[0] && week <= held[held.length - 1]) : every;
  if (!weeks.length || !(length > 0)) return null;
  const byWeek = weeks.map((week) => weekHours(plan, lengths, component, week, layout[component]?.[String(week)] ?? 0));
  const total = byWeek.reduce((sum, hours) => sum + hours, 0);
  // The aim is the hours the coordinators set, so a lead past them isn't told to keep going.
  const usual = part && !held.length ? "" : evenWords((target || total) / length, weeks.length);
  if (!(total > 0)) {
    return {
      state: "unset",
      from: weeks[0],
      week: 0,
      done: 0,
      even: 0,
      total: 0,
      perWeek: 0,
      usual,
      weeks: weeks.map((week) => ({ week, hours: 0, off: false })),
    };
  }
  const perWeek = total / weeks.length;
  const allowed = Math.max(PACE_WEEKS * perWeek, length) + 0.01;
  let done = 0;
  let widest = { gap: 0, week: weeks[0], done: 0, even: 0 };
  const each = weeks.map((week, index) => {
    done += byWeek[index];
    const even = (total * (index + 1)) / weeks.length;
    const gap = done - even;
    if (Math.abs(gap) > Math.abs(widest.gap)) widest = { gap, week, done, even };
    return { week, hours: byWeek[index], off: Math.abs(gap) > allowed };
  });
  const state = Math.abs(widest.gap) > allowed ? (widest.gap > 0 ? "ahead" : "behind") : "even";
  return { state, from: weeks[0], week: widest.week, done: widest.done, even: widest.even, total, perWeek, usual, weeks: each };
}

/** An even pace, in sessions: "2 sessions a week", "2–3 sessions a week", "1 session most weeks", "1 session every 3–4 weeks". */
function evenWords(sessions: number, weeks: number): string {
  const count = Math.round(sessions);
  if (!(count > 0) || !(weeks > 0)) return "";
  if (count >= weeks) {
    const low = Math.floor(count / weeks);
    const high = Math.ceil(count / weeks);
    const said = low === high ? String(low) : `${low}–${high}`;
    return `${said} session${high === 1 ? "" : "s"} a week`;
  }
  const low = Math.floor(weeks / count);
  const high = Math.ceil(weeks / count);
  if (low === high) return `1 session every ${low} weeks`;
  return low === 1 ? "1 session most weeks" : `1 session every ${low}–${high} weeks`;
}

/**
 * Where a pace stands, in a few plain words (24 Nov 2026): "Aim for 2 sessions a week" before
 * anything is laid out, "Evenly spread", or which weeks hold too many or too few sessions —
 * "Too many sessions in weeks 1–3", from the first teaching week to where the gap is widest.
 */
export function paceWords(pace: Pace): string {
  if (pace.state === "unset") return pace.usual ? `Aim for ${pace.usual}` : "";
  if (pace.state === "even") return "Evenly spread";
  // Word joiners keep "1–2" whole when the line wraps.
  const span = pace.week === pace.from ? `week ${pace.week}` : `weeks ${pace.from}\u2060–\u2060${pace.week}`;
  return `${pace.state === "ahead" ? "Too many" : "Too few"} sessions in ${span}`;
}

/**
 * "Week 7 has a holiday (Wed 10 Mar, Eid al-Fitr): no class that day." — said under the grid
 * for a week that holds sessions (24 Nov 2026), since a class that falls on a holiday is not
 * held and the lead would not otherwise know.
 */
export function holidayWords(week: TeachingWeek): string {
  const days = week.holidays.map((day) => `${DAY_NAMES[parseIsoDate(day.date).getDay()]} ${formatDayAndMonth(day.date)}`);
  const names = [...new Set(week.holidays.map((day) => day.label.trim()).filter(Boolean))];
  const listed = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days.join("");
  const one = days.length === 1;
  return `Week ${week.week} has ${one ? "a holiday" : "holidays"} (${listed}${names.length ? `, ${names.join(", ")}` : ""}): no class ${one ? "that day" : "those days"}.`;
}

/** A column of a week-by-week view: a teaching week, or a week off between two of them, by its Monday. */
export type WeekColumn = { week: TeachingWeek; off?: undefined } | { off: string; week?: undefined };

/**
 * The teaching weeks with the weeks off between them (24 Nov 2026). A week without classes
 * takes no number, so it shows only as two teaching weeks' Mondays more than a week apart;
 * each Monday between them is a week off, shown as an empty dashed column so nobody counts on
 * a class there. Nothing is shown before Week 1 or after the last week, nor while Week 1 is
 * not set.
 */
export function withWeeksOff(weeks: TeachingWeek[]): WeekColumn[] {
  const columns: WeekColumn[] = [];
  weeks.forEach((week, index) => {
    const before = weeks[index - 1];
    if (before?.monday && week.monday) {
      const next = (iso: string) => {
        const day = parseIsoDate(iso);
        return toIsoDate(new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7));
      };
      for (let monday = next(before.monday); monday < week.monday; monday = next(monday)) columns.push({ off: monday });
    }
    columns.push({ week });
  });
  return columns;
}

/** The rows whose weeks run unevenly, for a course as it stands: "TD", "CM part 2". */
export function unevenComponents(plan: Pick<CoursePlan, "components" | "parts" | "weeks" | "lengths">, weeks: number[]): RowKey[] {
  return rowsOf(plan)
    .map((row) => row.key)
    .filter((key) => {
      const state = paceOf(plan, plan.weeks, plan.lengths ?? {}, key, weeks)?.state;
      return state === "ahead" || state === "behind";
    });
}

/**
 * The weeks a layout uses, said as a timetable says them: "Weeks 2–14", with the weeks holding
 * more than one session after it — "Weeks 1–14 · 2 in weeks 5, 9".
 */
export function layoutWords(byWeek: Record<string, number> | undefined): string {
  const weeks = Object.entries(byWeek ?? {})
    .filter(([, count]) => count > 0)
    .map(([week, count]) => [Number(week), count] as const)
    .sort((a, b) => a[0] - b[0]);
  if (!weeks.length) return "No weeks";
  const counts = [...new Set(weeks.map(([, count]) => count))].sort((a, b) => a - b);
  const said = weeksSaid(weeks.map(([week]) => week));
  if (counts.length === 1) return counts[0] === 1 ? said : `${said} · ${counts[0]} a week`;
  const usual = counts[0];
  const more = counts
    .filter((count) => count !== usual)
    .map((count) => `${count} in ${weeksSaid(weeks.filter(([, held]) => held === count).map(([week]) => week)).toLowerCase()}`);
  return [said, ...more].join(" · ");
}

/** "24 h", "21 h a group": a component's target as the lists say it. */
export function hoursWords(component: Component, held: ComponentHours): string {
  if (!held.hours) return "";
  return `${figure(held.hours)} h${component === "CM" ? "" : " a group"}`;
}

/**
 * Where a course's plan stands, for the lists: no lead picked, waiting on the lead, laid out —
 * and, laid out, whether every component adds up to its target.
 */
export function planStanding(plan: CoursePlan): { state: "no-lead" | "waiting" | "answered"; offTarget: RowKey[] } {
  const offTarget = rowsOf(plan)
    .filter((row) => Math.abs(hoursLaidOut(plan, plan.weeks, row.key, plan.lengths ?? {}) - (row.held.hours ?? 0)) > 0.01)
    .map((row) => row.key);
  if (plan.answeredAt && laidOut(plan.weeks)) return { state: "answered", offTarget };
  return { state: plan.leadId ? "waiting" : "no-lead", offTarget: [] };
}

/** Where the lead's weeks stand, in a line: who laid them out and when, or who they wait on. */
export function answeredWords(plan: CoursePlan): string {
  const on = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (plan.answeredAt) {
    return plan.answerSource === "lead"
      ? `Laid out by ${plan.answeredBy || "the lead"} on ${on(plan.answeredAt)}`
      : `Laid out by ${plan.answeredBy || "a coordinator"} for the lead, ${on(plan.answeredAt)}`;
  }
  return plan.leadId ? `Waiting for ${plan.leadName || "the lead"} to lay it out` : "No lead picked yet";
}

// ------------------------------------------------------------------ the Semester plan

/** What a class of the plan is to its course's plan: its component's target, length and weeks. */
export type ClassPlan = {
  component: Component;
  /** The part of a group taught in parts this class is, whose own weeks it follows; 0 for none. */
  part?: number;
  hours: number;
  length: number;
  weeks: Record<string, number>;
  /** The weeks whose sessions last other than `length`, each session's hours. */
  lengths: Record<string, number[]>;
  /** The weeks holding an exam, each the exam's place among the week's sessions from 1. */
  exams?: Record<string, number[]>;
  /**
   * Laid out unevenly over the semester: how far off an even pace, and why, as the lead said —
   * so whoever places the class knows the weeks proposed are bunched up on purpose, or not.
   */
  uneven?: { words: string; reason: string } | null;
};

/** The class's component, when it is one of the three a course plan has. */
export function componentOf(section: Pick<PlanSection, "component">): Component | null {
  const said = section.component.trim().toUpperCase();
  return (COMPONENTS as readonly string[]).includes(said) ? (said as Component) : null;
}

/**
 * A class's share of its course's plan, when the course has hours for the class's component;
 * given the semester's teaching weeks, whether its weeks run unevenly too.
 */
export function classPlanOf(section: PlanSection, byCode: Map<string, CoursePlan>, teachingWeeks?: number[]): ClassPlan | null {
  const component = componentOf(section);
  const plan = byCode.get(section.courseCode.toUpperCase());
  if (!component || !plan) return null;
  // A part's CRN follows that part's own weeks (25 Nov 2026), not the component's.
  const crn = section.crn.trim();
  const part = crn
    ? (Object.entries(plan.parts ?? {}) as [PartKey, PartHours][]).find(
        ([key, held]) => componentOfRow(key) === component && held.crns.includes(crn),
      )?.[0]
    : undefined;
  const key: RowKey = part ?? component;
  const held = heldOf(plan, key);
  if (!held?.hours || !held.length) return null;
  return {
    component,
    ...(part ? { part: partOfRow(part) } : {}),
    hours: held.hours,
    length: held.length,
    weeks: plan.weeks[key] ?? {},
    lengths: plan.lengths?.[key] ?? {},
    exams: plan.exams?.[key] ?? {},
    ...(teachingWeeks ? { uneven: unevenOf(plan, key, teachingWeeks) } : {}),
  };
}

/** A component its lead laid out unevenly: how far off an even pace, and why, as they said. */
export function unevenOf(
  plan: Pick<CoursePlan, "components" | "parts" | "weeks" | "lengths" | "paceReason">,
  component: RowKey,
  weeks: number[],
): { words: string; reason: string } | null {
  const pace = paceOf(plan, plan.weeks, plan.lengths ?? {}, component, weeks);
  if (!pace || (pace.state !== "ahead" && pace.state !== "behind")) return null;
  return { words: paceWords(pace), reason: plan.paceReason ?? "" };
}

/**
 * The weeks to propose for a new series of a class: those its course plan still has sessions
 * for once the class's other series are counted — the first series gets every week with one,
 * a second the weeks with two. Without a layout, or with every week covered, null: the
 * caller's own default stands.
 */
export function proposedWeeks(
  plan: Plan,
  section: PlanSection,
  classPlan: ClassPlan | null,
  /** A series being changed, whose own weeks are not counted against it. */
  exceptSeries = "",
): number[] | null {
  if (!classPlan || !sessionsOf(classPlan.weeks)) return null;
  const covered = new Map<number, number>();
  for (const series of plan.series) {
    if (series.sectionId !== section.id || series.id === exceptSeries) continue;
    for (const week of series.weeks) covered.set(week, (covered.get(week) ?? 0) + 1);
  }
  const wanted = Object.entries(classPlan.weeks)
    .map(([week, count]) => [Number(week), count] as const)
    .filter(([week, count]) => week >= 1 && week <= plan.weeks && count > (covered.get(week) ?? 0))
    .map(([week]) => week)
    .sort((a, b) => a - b);
  if (wanted.length) return wanted;
  const any = Object.keys(classPlan.weeks)
    .map(Number)
    .filter((week) => week >= 1 && week <= plan.weeks)
    .sort((a, b) => a - b);
  return any.length ? any : null;
}

/** What a class does differently from its course's plan: a line each, for the flag's hover. */
export type PlanDrift = { sectionId: string; lines: string[] };

const sameHours = (a: number, b: number) => Math.abs(a - b) < 0.01;

/**
 * The classes whose series don't keep to their course's plan.
 *
 * A class is compared once it has a series: each session's length against the plan's, and —
 * once somebody has laid its weeks out — the hours placed in each teaching week against
 * sessions × length for that week. A class a holiday takes away counts as not placed, so the
 * week it was lost in shows. Nothing is refused: these are flags, as preferences are.
 */
export function coursePlanDrift(plan: Plan, byCode: Map<string, CoursePlan>): Map<string, PlanDrift> {
  const found = new Map<string, PlanDrift>();
  for (const section of plan.sections) {
    const classPlan = classPlanOf(section, byCode);
    if (!classPlan) continue;
    const series = plan.series.filter((one) => one.sectionId === section.id);
    if (!series.length) continue;
    const lines: string[] = [];
    const laid = sessionsOf(classPlan.weeks) > 0;
    // Each class against the usual length — but in a week with a length of its own, the week's
    // hours below say it, and once is enough.
    const usualWeek = (week: number) => !(String(week) in classPlan.lengths);
    const lengths = laid
      ? [
          ...new Set(
            plan.classes
              .filter((entry) => entry.sectionId === section.id && usualWeek(entry.week))
              .map((entry) => Math.round(hoursOf(entry) * 100) / 100),
          ),
        ]
      : [...new Set(series.map((one) => Math.round(hoursOf(one) * 100) / 100))];
    const off = lengths.filter((length) => !sameHours(length, classPlan.length));
    if (off.length) {
      lines.push(`Sessions of ${off.map(figure).join(" and ")} h, not ${figure(classPlan.length)} h`);
    }
    if (sessionsOf(classPlan.weeks)) {
      const placed = new Map<number, number>();
      for (const entry of plan.classes) {
        if (entry.sectionId === section.id) placed.set(entry.week, (placed.get(entry.week) ?? 0) + hoursOf(entry));
      }
      const extra: number[] = [];
      const missing: number[] = [];
      const other: string[] = [];
      for (let week = 1; week <= plan.weeks; week += 1) {
        const wanted = sessionLengths(classPlan.length, classPlan.lengths[String(week)], classPlan.weeks[String(week)] ?? 0).reduce(
          (sum, hours) => sum + hours,
          0,
        );
        const held = placed.get(week) ?? 0;
        if (sameHours(wanted, held)) continue;
        if (!wanted) extra.push(week);
        else if (!held) missing.push(week);
        else other.push(`week ${week}: ${figure(held)} h placed, ${figure(wanted)} h planned`);
      }
      if (extra.length) lines.push(`Meets in ${weeksSaid(extra).toLowerCase()}, which the course plan leaves free`);
      if (missing.length) lines.push(`Nothing placed in ${weeksSaid(missing).toLowerCase()}`);
      if (other.length) lines.push(other.join("; ").replace(/^w/, "W"));
    }
    lines.push(...orderDrift(plan, section, classPlan.component, byCode.get(section.courseCode.toUpperCase())));
    if (!lines.length) continue;
    const when = sessionsOf(classPlan.weeks) ? ` in ${layoutWords(classPlan.weeks).toLowerCase()}` : "";
    const own = Object.keys(classPlan.lengths).length ? ` (${lengthWords(classPlan.lengths)})` : "";
    found.set(section.id, {
      sectionId: section.id,
      lines: [`Course plan · ${classPlan.component}${when}, sessions of ${figure(classPlan.length)} h${own}`, ...lines],
    });
  }
  return found;
}

/** When a class meets, to put a week's classes in order: its day, then its start. */
const whenOf = (entry: Pick<PlanClass, "meetsOn" | "startsAt">) => `${entry.meetsOn} ${entry.startsAt}`;

/**
 * The weeks a TD or TP class is placed before the CM (or a TP before the TD) its lead asks to
 * come first (26 Nov 2026): against the week's first class of that kind for the same course
 * whose students it may share — the CM is the whole class's, a TD group may be some of the TP's.
 * Weeks without the earlier kind are not judged: there is nothing to come first.
 */
function orderDrift(plan: Plan, section: PlanSection, component: Component, course: CoursePlan | undefined): string[] {
  if (!course || component === "CM") return [];
  const firsts: Component[] = [
    ...(course.cmFirst ? (["CM"] as const) : []),
    ...(course.tdBeforeTp && component === "TP" ? (["TD"] as const) : []),
  ];
  const lines: string[] = [];
  for (const first of firsts) {
    const earlier = new Set(
      plan.sections
        .filter(
          (other) =>
            other.id !== section.id &&
            other.courseCode.toUpperCase() === section.courseCode.toUpperCase() &&
            componentOf(other) === first &&
            mayShareStudents(section, other),
        )
        .map((other) => other.id),
    );
    if (!earlier.size) continue;
    const firstIn = new Map<number, string>();
    for (const entry of plan.classes) {
      if (!earlier.has(entry.sectionId)) continue;
      const when = whenOf(entry);
      const held = firstIn.get(entry.week);
      if (held === undefined || when < held) firstIn.set(entry.week, when);
    }
    const before = new Set<number>();
    for (const entry of plan.classes) {
      if (entry.sectionId !== section.id) continue;
      const opening = firstIn.get(entry.week);
      if (opening !== undefined && whenOf(entry) < opening) before.add(entry.week);
    }
    if (before.size) {
      const weeks = [...before].sort((a, b) => a - b);
      lines.push(`Before that week's ${first} in ${weeksSaid(weeks).toLowerCase()}: the lead asks for the ${first} first`);
    }
  }
  return lines;
}

/**
 * The classes that are exams, as the course plan says (26 Nov 2026): in a week whose sessions of
 * a class include an exam, the class at that place among the week's, in the order they meet.
 */
export function examClasses(plan: Plan, byCode: Map<string, CoursePlan>): Set<PlanClass> {
  const found = new Set<PlanClass>();
  for (const section of plan.sections) {
    const exams = classPlanOf(section, byCode)?.exams ?? {};
    if (!Object.keys(exams).length) continue;
    const byWeek = new Map<number, PlanClass[]>();
    for (const entry of plan.classes) {
      if (entry.sectionId === section.id) byWeek.set(entry.week, [...(byWeek.get(entry.week) ?? []), entry]);
    }
    for (const [week, places] of Object.entries(exams)) {
      const held = [...(byWeek.get(Number(week)) ?? [])].sort((a, b) => whenOf(a).localeCompare(whenOf(b)));
      for (const place of places) {
        const entry = held[place - 1];
        if (entry) found.add(entry);
      }
    }
  }
  return found;
}

// ------------------------------------------------------------------ Groups & CRNs

/** "24", "24 h", "1,5": one number of hours as a row writes it; anything else, null. */
export function hoursIn(said: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*h?\s*$/i.exec(said ?? "");
  return match ? Number(match[1].replace(",", ".")) : null;
}

/** How a Groups & CRNs row's own hours and session length stand against the course plan's. */
export type RowDrift = { hours: "same" | "differs" | "unsaid" | "unreadable"; length: "same" | "differs" | "unsaid" | "unreadable" };

export function rowDrift(row: { hours: string; duration: string }, held: ComponentHours): RowDrift {
  const judge = (said: string, wanted: number | null) => {
    if (!said.trim()) return "unsaid" as const;
    const number = hoursIn(said);
    if (number === null) return "unreadable" as const;
    return wanted !== null && sameHours(number, wanted) ? ("same" as const) : ("differs" as const);
  };
  return { hours: judge(row.hours, held.hours), length: judge(row.duration, held.length) };
}
