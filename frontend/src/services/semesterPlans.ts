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
  /** What the plan goes by as a semester of the app: "plan:262720". */
  semesterId: string;
  name: string;
  weekOne: string;
  weeks: number;
  sections: number;
  series: number;
};

export type Holiday = { date: string; label: string };

/** Where a class sits on Groups & CRNs: a group of a set of a cohort. */
export type Place = {
  cohortId: string;
  cohort: string;
  setId: string;
  /** The set's code: "TD", "CM", "LANG". */
  set: string;
  /** The set this one is nested in, if any: Philosophy tutorials inside the tutorials. */
  parentSetId: string;
  /** The languages: a set every cohort's students sit in. */
  openToAll: boolean;
  /** The set's only group, which every student of the cohort placed in it is in. */
  onlyGroup: boolean;
  groupId: string;
  group: string;
  /** For a group of a nested set: the parent set's groups it goes with. */
  parentGroupIds: string[];
  /** Groups to be scheduled at the same hour as this one, which so share no students. */
  parallelWith: string[];
  /** The sub-row it is for, when a major is taught the course apart from its group. */
  majorId: string;
  /** Whose majors it is for: the sub-rows it teaches, or the cohort's for a group with none. */
  majors: string[];
};

/**
 * A class to place, as Groups & CRNs says it: a group of a set taught one of its courses.
 * The plan does not keep its own list; it is read from there each time the plan is opened.
 */
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
  /** How long one session lasts, as Groups & CRNs says it: "1.5". */
  duration: string;
  /** Every group it is taught to — more than one for a CRN that two cohorts share. */
  places: Place[];
  /** Placed on the calendar but no longer on Groups & CRNs: it waits to be taken off. */
  gone: boolean;
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
  semesterId: string;
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

/** What a class from the plan's list carries when it is dragged onto the week. */
export const SECTION_DRAG = "application/x-plan-section";

export async function fetchPlans(): Promise<PlanSummary[]> {
  return (await answer<{ plans: PlanSummary[] }>(await apiFetch(BASE))).plans;
}

export async function createPlan(termCode: string, name: string): Promise<Plan> {
  return answer(await apiFetch(BASE, json("POST", { termCode, name })));
}

/** Delete a semester made here and the classes placed in it; refused while a cohort has sets or students in it. */
export async function deletePlan(termCode: string): Promise<void> {
  return answer(await apiFetch(at(termCode), { method: "DELETE" }));
}

export async function fetchPlan(termCode: string): Promise<Plan> {
  return answer(await apiFetch(at(termCode)));
}

export async function settlePlan(termCode: string, settings: PlanSettings): Promise<Plan> {
  return answer(await apiFetch(`${at(termCode)}/settings`, json("PUT", settings)));
}

/** Take a class that is no longer on Groups & CRNs off the plan, with everywhere it was placed. */
export async function removeSection(termCode: string, sectionId: string): Promise<void> {
  return answer(await apiFetch(`${at(termCode)}/sections/${encodeURIComponent(sectionId)}`, { method: "DELETE" }));
}

/**
 * What a class's box calls its group, after the course code: "TD G1", "CM GA" — or, for one
 * of several parallel classes with no group of their own, its name ("French A0 F4"), since
 * "SCEN-101 · Language" eleven times over tells the eleven apart not at all. A class from
 * Groups & CRNs is called by its set and group, which is what its label already says: "TD 2".
 */
export function groupWords(section: PlanSection, parallel: boolean): string {
  if (section.places.length) return section.groupLabel;
  if (section.groupLabel) {
    return section.groupLabel.toUpperCase().startsWith(section.component.toUpperCase())
      ? section.groupLabel
      : `${section.component} ${section.groupLabel}`.trim();
  }
  return parallel ? section.title : section.component;
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

const LONGEST_SESSION = 8 * 60;
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * When a class placed at `start` ends: one session as long as Groups & CRNs says, when it
 * says one number ("1.5"); `otherwise` when it says none, or two ("1, 2").
 */
export function endOf(section: PlanSection | undefined, start: string, otherwise: string): string {
  const said = section?.duration.trim() ?? "";
  const minutes = said ? Math.round(Number(said) * 60) : Number.NaN;
  if (!(minutes > 0 && minutes <= LONGEST_SESSION)) return otherwise;
  const end = Math.min(minutesOf(start) + minutes, 23 * 60 + 59);
  return `${pad(Math.floor(end / 60))}:${pad(end % 60)}`;
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

/**
 * What a class is called in a box: its course and group, "MATH-002 · GA CM" — or, for a
 * class with no group of its own, its name, which says more than its type: "French A0 F4"
 * rather than eleven boxes reading "SCEN-101 · Language".
 */
export function sectionLabel(section: PlanSection | undefined): string {
  if (!section) return "A class";
  // A class from Groups & CRNs: its course, then its set and group, "MATH-002 · CM A".
  if (section.places.length) return [section.courseCode || section.title, section.groupLabel].filter(Boolean).join(" · ");
  if (!section.groupLabel) return section.title || section.courseCode;
  return [section.courseCode || section.title, `${section.groupLabel} ${section.component}`.trim()].filter(Boolean).join(" · ");
}

export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Whether the students of two groups of Groups & CRNs are the same ones, other ones, or may be.
 *
 * Said by how the sets are built, not by who has been placed yet, so it holds while a
 * semester is being planned:
 *
 *   - one group: the same students (a sub-row taught apart is the others' only when it is theirs)
 *   - two groups of one set, or groups to be held at the same hour: never the same student
 *   - two cohorts: nobody in common, unless one of the sets is open to every cohort
 *   - a nested set's group and its parent set's: the same students when it goes with that group,
 *     none when it goes with another
 *   - a set of one group holds the whole cohort, so its students are everybody's
 *   - anything else — two sets that cut a cohort differently, a language group — may be
 */
export function studentsOf(a: Place, b: Place): "same" | "none" | "maybe" {
  if (a.groupId === b.groupId) return a.majorId && b.majorId && a.majorId !== b.majorId ? "none" : "same";
  if (a.setId === b.setId || a.parallelWith.includes(b.groupId) || b.parallelWith.includes(a.groupId)) return "none";
  if (a.openToAll || b.openToAll) return "maybe";
  if (a.cohortId !== b.cohortId) return "none";
  for (const [inner, outer] of [
    [a, b],
    [b, a],
  ]) {
    if (inner.parentSetId === outer.setId && inner.parentGroupIds.length) {
      return inner.parentGroupIds.includes(outer.groupId) ? "same" : "none";
    }
  }
  return a.onlyGroup || b.onlyGroup ? "same" : "maybe";
}

/**
 * Whether two classes may have students in common.
 *
 * For classes from Groups & CRNs, from how their sets and groups are built (`studentsOf`).
 *
 * Otherwise a guess, kept to what the labels can say. Two groups of the same course are
 * parallel — G1 and G2 of a tutorial, two French groups — unless one of them is for
 * everybody (the lecture beside its tutorials). Different courses share students when
 * either is for everybody, or both name the same group. A lecture group "GA" and a tutorial
 * "G1" are not counted: which tutorials sit under which lecture group is exactly what the
 * labels do not say.
 */
export function mayShareStudents(a: PlanSection, b: PlanSection): boolean {
  if (a.id === b.id) return false;
  if (a.places.length && b.places.length) {
    return a.places.some((one) => b.places.some((other) => studentsOf(one, other) !== "none"));
  }
  if (!a.programmes.some((programme) => b.programmes.includes(programme))) return false;
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
