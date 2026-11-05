/**
 * A semester planned by the department before the registrar books it.
 *
 * A plan holds the classes to place (one per CRN, with the hours asked for) and the series
 * each has been placed as: a weekday, an hour, a room, and the teaching weeks it repeats in.
 * The server works the dated classes out from the series and the semester's calendar, so
 * this side only ever draws `classes` and sends changes to `series`.
 */

import { apiFetch } from "@/services/http";
import { minutesOf } from "@/services/weekSchedule";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/plans`;

export type PlanSummary = {
  termCode: string;
  name: string;
  weekOne: string;
  weeks: number;
  sections: number;
  series: number;
};

export type Holiday = { date: string; label: string };

export type PlanSection = {
  id: string;
  crn: string;
  parentCrn: string;
  /** "MATH-002". */
  courseCode: string;
  /** As the department names it: "Elements of Calculus TD-G1". */
  title: string;
  ue: string;
  /** CM, TD, TP, Project. */
  component: string;
  /** Who it is for: ["L1"], or three years for a shared French group. */
  programmes: string[];
  /** "G1", "GA"; empty where the whole programme attends. */
  groupLabel: string;
  teacherName: string;
  /** The hours asked for, where the request gives a number. */
  hours: number | null;
  /** The hours as the request wrote them: "60CM". */
  hoursSaid: string;
  comments: string;
  position: number;
  updatedAt: string;
  updatedBy: string;
};

/** What one week of a series can differ from the series by. */
export type Slot = {
  /** 1 is Monday. */
  weekday: number;
  startsAt: string;
  endsAt: string;
  room: string;
  /** Empty: the class's own teacher. */
  teacherName: string;
};

export type PlanSeries = Slot & {
  id: string;
  sectionId: string;
  weeks: number[];
  note: string;
  revision: number;
  moves: (Slot & { week: number })[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

/** One dated class, as the server works it out. */
export type PlanClass = Slot & {
  seriesId: string;
  sectionId: string;
  week: number;
  meetsOn: string;
  /** Changed on its own, apart from its series. */
  moved: boolean;
};

export type Plan = {
  termCode: string;
  name: string;
  weekOne: string;
  weeks: number;
  /** The Mondays of the weeks without classes. */
  without: string[];
  holidays: Holiday[];
  updatedAt: string;
  updatedBy: string;
  sections: PlanSection[];
  series: PlanSeries[];
  classes: PlanClass[];
  /** Classes a holiday took away, with the holiday's name. */
  skipped: (PlanClass & { holiday: string })[];
};

export type PlanSettings = Pick<Plan, "name" | "weekOne" | "weeks" | "without" | "holidays">;

export type Scope = "one" | "following" | "all";

export type SeriesInput = Slot & { sectionId: string; weeks: number[]; note: string };

export type SeriesChanges = Partial<Slot> & { weeks?: number[]; note?: string };

async function answer<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

const at = (termCode: string) => `${BASE}/${encodeURIComponent(termCode)}`;

export async function fetchPlans(): Promise<PlanSummary[]> {
  return (await answer<{ plans: PlanSummary[] }>(await apiFetch(BASE))).plans;
}

export async function createPlan(termCode: string, name: string): Promise<Plan> {
  return answer(await apiFetch(BASE, json("POST", { termCode, name })));
}

export async function fetchPlan(termCode: string): Promise<Plan> {
  return answer(await apiFetch(at(termCode)));
}

export async function settlePlan(termCode: string, settings: PlanSettings): Promise<Plan> {
  return answer(await apiFetch(`${at(termCode)}/settings`, json("PUT", settings)));
}

export async function placeClass(termCode: string, input: SeriesInput): Promise<PlanSeries> {
  return answer(await apiFetch(`${at(termCode)}/series`, json("POST", input)));
}

export async function changeClass(
  termCode: string,
  seriesId: string,
  change: { scope: Scope; week?: number; revision: number; changes: SeriesChanges },
): Promise<PlanSeries> {
  return answer(await apiFetch(`${at(termCode)}/series/${encodeURIComponent(seriesId)}`, json("PATCH", change)));
}

export async function removeClass(
  termCode: string,
  seriesId: string,
  remove: { scope: Scope; week?: number; revision: number },
): Promise<void> {
  const query = new URLSearchParams({ scope: remove.scope, revision: String(remove.revision) });
  if (remove.week !== undefined) query.set("week", String(remove.week));
  return answer(
    await apiFetch(`${at(termCode)}/series/${encodeURIComponent(seriesId)}?${query}`, { method: "DELETE" }),
  );
}

/** Hours of a class, from its two times. */
export function hoursOf(slot: Pick<Slot, "startsAt" | "endsAt">): number {
  return (minutesOf(slot.endsAt) - minutesOf(slot.startsAt)) / 60;
}

/** Hours placed for each class to place, holidays taken out. */
export function plannedHours(plan: Plan): Map<string, number> {
  const held = new Map<string, number>();
  for (const entry of plan.classes) held.set(entry.sectionId, (held.get(entry.sectionId) ?? 0) + hoursOf(entry));
  return held;
}

/** "Weeks 1–5, 7, 9–14": a list of week numbers said the way a timetable says them. */
export function weeksSaid(weeks: number[]): string {
  if (!weeks.length) return "No weeks";
  const runs: string[] = [];
  let start = weeks[0];
  let previous = weeks[0];
  for (const week of [...weeks.slice(1), Number.NaN]) {
    if (week === previous + 1) {
      previous = week;
      continue;
    }
    runs.push(start === previous ? `${start}` : `${start}–${previous}`);
    start = week;
    previous = week;
  }
  return `${weeks.length === 1 ? "Week" : "Weeks"} ${runs.join(", ")}`;
}

/** What a class is called in a box: its course and group, "MATH-002 · GA CM". */
export function sectionLabel(section: PlanSection | undefined): string {
  if (!section) return "A class";
  const bits = [section.groupLabel, section.component].filter(Boolean).join(" ");
  return [section.courseCode || section.title, bits].filter(Boolean).join(" · ");
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Whether two classes of one programme may have students in common.
 *
 * A guess until the semester's student groups exist, kept to what the labels can say. Two
 * groups of the same course are parallel — G1 and G2 of a tutorial, two French groups —
 * unless one of them is for everybody (the lecture beside its tutorials). Different courses
 * share students when either is for everybody, or both name the same group. A lecture
 * group "GA" and a tutorial "G1" are not counted: which tutorials sit under which lecture
 * group is exactly what the labels do not say.
 */
export function mayShareStudents(a: PlanSection, b: PlanSection): boolean {
  if (a.id === b.id || !a.programmes.some((programme) => b.programmes.includes(programme))) return false;
  if (a.courseCode && a.courseCode === b.courseCode) {
    return (!a.groupLabel) !== (!b.groupLabel) || (Boolean(a.groupLabel) && a.groupLabel === b.groupLabel);
  }
  return !a.groupLabel || !b.groupLabel || a.groupLabel === b.groupLabel;
}

/**
 * What a class collides with, among every class of the plan: the same teacher in two
 * places, the same room twice, and students who may be expected in both (see
 * `mayShareStudents`, which is why that one is said as "may").
 */
export type Clash = { kind: "teacher" | "room" | "students"; with: PlanClass };

export function clashesOf(plan: Plan): Map<PlanClass, Clash[]> {
  const sections = new Map(plan.sections.map((section) => [section.id, section]));
  const byDay = new Map<string, PlanClass[]>();
  for (const entry of plan.classes) {
    const list = byDay.get(entry.meetsOn) ?? [];
    list.push(entry);
    byDay.set(entry.meetsOn, list);
  }
  const found = new Map<PlanClass, Clash[]>();
  const note = (one: PlanClass, clash: Clash) => {
    const list = found.get(one) ?? [];
    if (!list.some((other) => other.kind === clash.kind && other.with === clash.with)) list.push(clash);
    found.set(one, list);
  };
  for (const day of byDay.values()) {
    for (let i = 0; i < day.length; i += 1) {
      for (let j = i + 1; j < day.length; j += 1) {
        const a = day[i];
        const b = day[j];
        if (a.sectionId === b.sectionId && a.seriesId === b.seriesId) continue;
        if (!(minutesOf(a.startsAt) < minutesOf(b.endsAt) && minutesOf(b.startsAt) < minutesOf(a.endsAt))) continue;
        const kinds: Clash["kind"][] = [];
        if (a.teacherName && a.teacherName.toLowerCase() === b.teacherName.toLowerCase()) kinds.push("teacher");
        if (a.room && a.room.toLowerCase() === b.room.toLowerCase()) kinds.push("room");
        const sa = sections.get(a.sectionId);
        const sb = sections.get(b.sectionId);
        if (sa && sb && mayShareStudents(sa, sb)) kinds.push("students");
        for (const kind of kinds) {
          note(a, { kind, with: b });
          note(b, { kind, with: a });
        }
      }
    }
  }
  return found;
}
