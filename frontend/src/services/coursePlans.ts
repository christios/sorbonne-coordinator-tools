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
import { hoursOf, weeksSaid, type Plan, type PlanSection } from "@/services/semesterPlans";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/course-plans`;

export const COMPONENTS = ["CM", "TD", "TP"] as const;
export type Component = (typeof COMPONENTS)[number];

/**
 * A component's hours in the semester — per group for TD and TP — and one session's length,
 * as Groups & CRNs has them (23 Nov 2026), and what stands in the way where it can't say:
 * "No session length in Groups & CRNs yet", "Groups & CRNs says 7.5 h and 12 h".
 */
export type ComponentHours = { hours: number | null; length: number | null; issue?: string };

/** Sessions per teaching week, by component: `{ TD: { "2": 1, "3": 1 } }`; weeks with none left out. */
export type Layout = Partial<Record<Component, Record<string, number>>>;

/**
 * The weeks whose sessions last other than the usual length, each session's hours, so one week
 * can hold a usual session and a three-hour exam: `{ CM: { "8": [1.5, 3] } }`.
 */
export type Lengths = Partial<Record<Component, Record<string, number[]>>>;

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
  layout: { weeks: Layout; lengths: Lengths; note?: string },
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

export function sessionsOf(byWeek: Record<string, number> | undefined): number {
  return Object.values(byWeek ?? {}).reduce((sum, count) => sum + (count > 0 ? count : 0), 0);
}

/** Whether anybody has laid out any week of the course. */
export function laidOut(layout: Layout): boolean {
  return COMPONENTS.some((component) => sessionsOf(layout[component]) > 0);
}

/**
 * How long each of a week's sessions lasts: the week's own lengths where it has them (one per
 * session, padded with the usual length or cut to the count), else the usual length for each.
 */
export function sessionLengths(usual: number, own: number[] | undefined, count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => own?.[index] ?? usual);
}

/** A week's hours for a component: its sessions' lengths added up. */
export function weekHours(plan: Pick<CoursePlan, "components">, lengths: Lengths, component: Component, week: number | string, count: number): number {
  return sessionLengths(plan.components[component]?.length ?? 0, lengths[component]?.[String(week)], count).reduce((sum, hours) => sum + hours, 0);
}

/** Hours a component's sessions add up to, week by week. */
export function hoursLaidOut(
  plan: Pick<CoursePlan, "components">,
  layout: Layout,
  component: Component,
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
  /** Where the gap is widest: the week, the hours done by its end, and what an even pace would have done. */
  week: number;
  done: number;
  even: number;
  /** The hours laid out, and an even week's share of them. */
  total: number;
  perWeek: number;
  /** Each teaching week: its hours, and whether the hours done by its end are off an even pace. */
  weeks: { week: number; hours: number; off: boolean }[];
  /** An even pace in sessions: "2–3 sessions a week", "1 session every 3–4 weeks". */
  usual: string;
};

/** Weeks' worth of hours an even layout may run ahead or behind. */
export const PACE_WEEKS = 2;

export function paceOf(
  plan: Pick<CoursePlan, "components">,
  layout: Layout,
  lengths: Lengths,
  component: Component,
  weeks: number[],
): Pace | null {
  const length = plan.components[component]?.length ?? 0;
  const target = plan.components[component]?.hours ?? 0;
  if (!weeks.length || !(length > 0)) return null;
  const byWeek = weeks.map((week) => weekHours(plan, lengths, component, week, layout[component]?.[String(week)] ?? 0));
  const total = byWeek.reduce((sum, hours) => sum + hours, 0);
  const usual = evenWords((total || target) / length, weeks.length);
  if (!(total > 0)) {
    return { state: "unset", week: 0, done: 0, even: 0, total: 0, perWeek: 0, usual, weeks: weeks.map((week) => ({ week, hours: 0, off: false })) };
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
  return { state, week: widest.week, done: widest.done, even: widest.even, total, perWeek, usual, weeks: each };
}

/** An even pace, in sessions: "2 sessions a week", "2–3 sessions a week", "1 session every 3–4 weeks". */
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
  return low === 1 ? `1 session in ${count} of the ${weeks} weeks` : `1 session every ${low}–${high} weeks`;
}

/** Where a pace stands, in a line: "Ahead of an even pace: 45 of 60 h by week 9 (even: 32 h)". */
export function paceWords(pace: Pace): string {
  if (pace.state === "unset") return pace.usual ? `An even pace: ${pace.usual}` : "";
  if (pace.state === "even") return "Even over the semester";
  // The even figure to the half hour, as sessions are counted: 31.8 is said 32, 1.5 stays.
  const even = figure(Math.round(pace.even * 2) / 2);
  return `${pace.state === "ahead" ? "Ahead of" : "Behind"} an even pace: ${figure(pace.done)} of ${figure(pace.total)} h by week ${pace.week} (even: ${even} h)`;
}

/** The components whose weeks run unevenly, for a course as it stands. */
export function unevenComponents(plan: Pick<CoursePlan, "components" | "weeks" | "lengths">, weeks: number[]): Component[] {
  return componentsOf(plan).filter((component) => {
    const state = paceOf(plan, plan.weeks, plan.lengths ?? {}, component, weeks)?.state;
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
export function planStanding(plan: CoursePlan): { state: "no-lead" | "waiting" | "answered"; offTarget: Component[] } {
  const offTarget = componentsOf(plan).filter(
    (component) =>
      Math.abs(hoursLaidOut(plan, plan.weeks, component, plan.lengths ?? {}) - (plan.components[component].hours ?? 0)) > 0.01,
  );
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
  hours: number;
  length: number;
  weeks: Record<string, number>;
  /** The weeks whose sessions last other than `length`, each session's hours. */
  lengths: Record<string, number[]>;
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
  const held = plan.components[component];
  if (!held?.hours || !held.length) return null;
  return {
    component,
    hours: held.hours,
    length: held.length,
    weeks: plan.weeks[component] ?? {},
    lengths: plan.lengths?.[component] ?? {},
    ...(teachingWeeks ? { uneven: unevenOf(plan, component, teachingWeeks) } : {}),
  };
}

/** A component its lead laid out unevenly: how far off an even pace, and why, as they said. */
export function unevenOf(
  plan: Pick<CoursePlan, "components" | "weeks" | "lengths" | "paceReason">,
  component: Component,
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
