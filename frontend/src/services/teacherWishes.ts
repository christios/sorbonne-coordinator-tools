/**
 * Timetable wishes: when each teacher can and can't teach, asked once a semester.
 *
 * An answer is a week painted "can't" and "prefer" a quarter of an hour at a time, a few limits on the
 * week, dates away, room needs and a note. Its *wishes* are the lines a teacher ranks: each
 * block of can't-teach hours (the same hours on several days are one line), their preferred
 * hours as one line, and each limit. A wish is a Must or a Would like; no more than the
 * semester's quota may be a Must. The server keeps the same rule (`wish_lines`). Any wish
 * may carry a comment — why it matters — which the plan shows beside it when it is broken.
 *
 * The Semester plan reads the answers to shade a teacher's week and to flag every placed
 * class that breaks a wish — and a teacher's dates away, which are facts rather than wishes.
 */

import { apiFetch } from "@/services/http";
import type { Period, Plan, PlanClass, PlanSection } from "@/services/semesterPlans";
import { minutesOf } from "@/services/weekSchedule";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/wishes`;

export type WishKind = "cant" | "prefer";
export type WishLevel = "must" | "would";
/**
 * A quarter of an hour of the week painted: 1 is Monday, and `hour` is where the quarter
 * starts — 8 is 08:00–08:15, 14.25 is 14:15–14:30. The grid may be painted an hour or half
 * an hour at a time; each paints its quarters.
 */
export type WishCell = { day: number; hour: number; kind: WishKind };

/** A painted cell's length, in hours: a quarter. */
export const STEP = 0.25;

/** "14:15", for 14.25. */
export function clockOf(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
export type WishLimits = { maxDays?: number | null; maxHoursDay?: number | null; maxInRow?: number | null; freeDay?: number | null };
export type WishAway = { from: string; to: string; reason: string };

export type WishCollection = {
  termCode: string;
  deadline: string;
  message: string;
  days: number[];
  firstHour: number;
  lastHour: number;
  mustQuota: number;
  cantCap: number;
  openedAt: string;
  openedBy: string;
};

export type WishLine =
  | { key: string; kind: "cant"; days: number[]; from: number; to: number; level?: WishLevel; comment?: string }
  | { key: "prefer"; kind: "prefer"; level?: WishLevel; comment?: string }
  | { key: keyof WishLimits; kind: keyof WishLimits; value: number; level?: WishLevel; comment?: string };

export type Wishes = {
  status: "draft" | "submitted";
  cells: WishCell[];
  limits: WishLimits;
  away: WishAway[];
  needs: string;
  note: string;
  levels: Record<string, WishLevel>;
  /** Why a wish matters, by its key: "School run", "Lab days". */
  comments: Record<string, string>;
  lines: (WishLine & { level: WishLevel; comment: string })[];
  overCapReason: string;
  source: string;
  submittedAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type WishTeacher = { teacherId: string; name: string; email: string; wishes: Wishes | null };
export type WishSemester = { collection: WishCollection | null; teachers: WishTeacher[] };

export type WishesInput = Pick<Wishes, "cells" | "limits" | "away" | "needs" | "note" | "levels" | "comments" | "overCapReason"> & {
  submit: boolean;
};

export type CollectionInput = Pick<
  WishCollection,
  "deadline" | "message" | "days" | "firstHour" | "lastHour" | "mustQuota" | "cantCap"
>;

export const COLLECTION_DEFAULTS: CollectionInput = {
  deadline: "",
  message: "",
  days: [1, 2, 3, 4, 5],
  firstHour: 8,
  lastHour: 19,
  mustQuota: 3,
  cantCap: 12,
};

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

export async function fetchWishSemester(termCode: string): Promise<WishSemester> {
  return answer(await apiFetch(`${BASE}?term=${encodeURIComponent(termCode)}`));
}

export async function openCollection(termCode: string, input: CollectionInput): Promise<WishCollection> {
  return answer(await apiFetch(`${BASE}/collection/${encodeURIComponent(termCode)}`, json("PUT", input)));
}

export async function saveWishes(termCode: string, teacherId: string, input: WishesInput): Promise<Wishes> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}`, json("PUT", input)),
  );
}

export async function forgetWishes(termCode: string, teacherId: string): Promise<void> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}`, { method: "DELETE" }),
  );
}

// ------------------------------------------------------------------------ wishes from an answer

const LIMIT_KEYS = ["maxDays", "maxHoursDay", "maxInRow", "freeDay"] as const;
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The wishes an answer makes, as the server makes them: can't blocks, then prefer, then limits. */
export function wishLines(cells: WishCell[], limits: WishLimits): WishLine[] {
  const byDay = new Map<number, number[]>();
  for (const cell of cells) {
    if (cell.kind !== "cant") continue;
    byDay.set(cell.day, [...(byDay.get(cell.day) ?? []), cell.hour]);
  }
  const blocks = new Map<string, { from: number; to: number; days: number[] }>();
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const hours = [...new Set(byDay.get(day))].sort((a, b) => a - b);
    let start = hours[0];
    for (let index = 0; index < hours.length; index += 1) {
      const hour = hours[index];
      const next = hours[index + 1];
      if (next !== hour + STEP) {
        const key = `${start}-${hour + STEP}`;
        const block = blocks.get(key) ?? { from: start, to: hour + STEP, days: [] };
        block.days.push(day);
        blocks.set(key, block);
        start = next;
      }
    }
  }
  const lines: WishLine[] = [...blocks.values()]
    .sort((left, right) => left.days[0] - right.days[0] || left.from - right.from || left.to - right.to)
    .map((block) => ({ key: `cant:${block.from}-${block.to}:${block.days.join(",")}`, kind: "cant", ...block }));
  if (cells.some((cell) => cell.kind === "prefer")) lines.push({ key: "prefer", kind: "prefer" });
  for (const name of LIMIT_KEYS) {
    const value = limits[name];
    if (value) lines.push({ key: name, kind: name, value });
  }
  return lines;
}

/** "Tue, Thu 14:00–18:00", the days and hours of a can't-teach block. */
function daysAndHours(days: number[], from: number, to: number): string {
  return `${days.map((day) => DAY_SHORT[day]).join(", ")} ${clockOf(from)}–${clockOf(to)}`;
}

/** A wish in the words of the panel and the flags: "Can't teach Tue 14:00–18:00". */
export function describeLine(line: WishLine): string {
  switch (line.kind) {
    case "cant":
      return `Can't teach ${daysAndHours(line.days, line.from, line.to)}`;
    case "prefer":
      return "Their preferred hours";
    case "maxDays":
      return `At most ${line.value} day${line.value === 1 ? "" : "s"} on campus`;
    case "maxHoursDay":
      return `At most ${line.value} hour${line.value === 1 ? "" : "s"} in a day`;
    case "maxInRow":
      return `At most ${line.value} hour${line.value === 1 ? "" : "s"} in a row`;
    case "freeDay":
      return `${DAY_NAMES[line.value]} free`;
    default:
      return "";
  }
}

/** "1h30", "3h", "45 min": a length, as the rules of a period say it. */
export function lengthWords(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours ? `${hours}h${rest ? String(rest).padStart(2, "0") : ""}` : `${rest} min`;
}

/** A period's rules in words: "classes end by 15:00", "longest class 1h30", … */
export function periodRules(period: Period): string[] {
  return [
    period.endsBy ? `classes end by ${period.endsBy}` : "",
    period.longest ? `longest class ${lengthWords(period.longest)}` : "",
    period.blockFrom && period.blockTo ? `no classes ${period.blockFrom}–${period.blockTo}` : "",
    period.dailyMax ? `at most ${lengthWords(period.dailyMax)} a day per teacher` : "",
  ].filter(Boolean);
}

/** "Ramadan, 8 Feb–9 Mar: classes end by 15:00 · longest class 1h30, Mon–Fri". */
export function periodWords(period: Period): string {
  // The weekdays only when the period skips some, rather than the whole week said.
  const days = period.days.length < 7 ? ` on ${period.days.map((day) => DAY_SHORT[day]).join(", ")}` : "";
  return `${period.label}, ${dateWords(period.from, period.to)}: ${periodRules(period).join(" · ")}${days}`;
}

/**
 * What a period shades of a day it covers: the hours with no classes, and the hours after the
 * day ends. The longest class and a teacher's hours in a day have no hours to shade; they
 * only flag.
 */
export function periodShades(period: Period, date: string, weekday: number): { from: string; to: string; title: string }[] {
  if (date < period.from || date > period.to || !period.days.includes(weekday)) return [];
  return [
    ...(period.blockFrom && period.blockTo
      ? [{ from: period.blockFrom, to: period.blockTo, title: `${period.label}: no classes ${period.blockFrom}–${period.blockTo}` }]
      : []),
    ...(period.endsBy ? [{ from: period.endsBy, to: "23:59", title: `${period.label}: classes end by ${period.endsBy}` }] : []),
  ];
}

/**
 * The wish a painted hour is part of: its can't-teach block, or the preferred hours. Null for
 * an hour left white.
 */
export function lineOfCell(lines: WishLine[], day: number, hour: number, kind: WishKind | undefined): WishLine | null {
  if (kind === "prefer") return lines.find((line) => line.kind === "prefer") ?? null;
  if (kind !== "cant") return null;
  return lines.find((line) => line.kind === "cant" && line.days.includes(day) && line.from <= hour && hour < line.to) ?? null;
}

/**
 * Carry a ranking and its comment over to the wishes a repaint makes. Stretching Tuesday
 * 14:00–18:00 to 19:00, or adding Thursday to it, makes a wish with a new key; it is still
 * the same wish to the teacher, so it keeps its Must and its comment. Two wishes painted
 * into one keep the stronger rank; one cut in two gives its Must to the first half only, so
 * a repaint never takes an answer past its quota.
 */
export function carryOver(
  before: WishLine[],
  after: WishLine[],
  levels: Record<string, WishLevel>,
  comments: Record<string, string>,
): { levels: Record<string, WishLevel>; comments: Record<string, string> } {
  const nextLevels: Record<string, WishLevel> = {};
  const nextComments: Record<string, string> = {};
  const given = new Set<string>();
  const sameWish = (old: WishLine, now: WishLine) =>
    old.kind === now.kind &&
    (old.kind !== "cant" ||
      (now.kind === "cant" && old.days.some((day) => now.days.includes(day)) && old.from < now.to && now.from < old.to));
  for (const now of after) {
    if (levels[now.key]) nextLevels[now.key] = levels[now.key];
    if (comments[now.key]) nextComments[now.key] = comments[now.key];
    // Only a can't-teach block changes its key as it is repainted; the others keep theirs.
    if (now.kind !== "cant" || before.some((old) => old.key === now.key)) continue;
    for (const old of before.filter((each) => sameWish(each, now))) {
      if (!levels[now.key]) {
        if (levels[old.key] === "must" && !given.has(old.key)) {
          nextLevels[now.key] = "must";
          given.add(old.key);
        } else if (levels[old.key] && nextLevels[now.key] !== "must") {
          nextLevels[now.key] = "would";
        }
      }
      if (!comments[now.key] && comments[old.key] && !nextComments[now.key]) nextComments[now.key] = comments[old.key];
    }
  }
  return { levels: nextLevels, comments: nextComments };
}

/** Hours painted can't-teach, against the semester's cap: four quarters an hour. */
export const cantHours = (cells: WishCell[]) => cells.filter((cell) => cell.kind === "cant").length * STEP;

/**
 * A teacher's week as stretches to shade on the plan's grid, a day at a time:
 * `{2: [{from: "14:00", to: "18:00", kind: "cant"}]}`.
 */
export function shadingOf(wishes: Pick<Wishes, "cells">): Record<number, { from: string; to: string; kind: WishKind }[]> {
  const shaded: Record<number, { from: string; to: string; kind: WishKind }[]> = {};
  const sorted = [...wishes.cells].sort((a, b) => a.day - b.day || a.hour - b.hour);
  for (const cell of sorted) {
    const day = (shaded[cell.day] ??= []);
    const last = day[day.length - 1];
    if (last && last.kind === cell.kind && last.to === clockOf(cell.hour)) last.to = clockOf(cell.hour + STEP);
    else day.push({ from: clockOf(cell.hour), to: clockOf(cell.hour + STEP), kind: cell.kind });
  }
  return shaded;
}

// ------------------------------------------------------------------------ against the plan

/** One wish broken in one teaching week, with the classes that break it. */
export type Breach = {
  /** A teacher's wish, or a period of the semester binding everybody (Ramadan). */
  about: "teacher" | "period";
  /** Empty for a period. */
  teacherId: string;
  teacherName: string;
  /** The wish's key, or `away:<from>` for dates away. */
  key: string;
  /** Dates away are facts, not wishes, and count as a Must. */
  level: WishLevel;
  /** "Can't teach Tue 14:00–18:00", "Away 15–19 Mar (Conference)". */
  wish: string;
  /** Why it matters, in the teacher's words, if they said: "School run". */
  comment: string;
  /** What breaks it: "MATH-114 TD 2, Tue 15:00", or "3 days: Mon, Tue, Wed". */
  how: string;
  /**
   * A period's rule, said of each class it flags: "Ramadan: longest class 1h30, this one is
   * 3h". The wish is the rule; this is why the class breaks it.
   */
  perClass?: Map<PlanClass, string>;
  week: number;
  classes: PlanClass[];
};

/** How many of a teacher's ranked wishes the whole plan keeps. */
export type Tally = {
  teacherId: string;
  teacherName: string;
  status: Wishes["status"];
  musts: number;
  mustsKept: number;
  woulds: number;
  wouldsKept: number;
};

export type WishCheck = {
  breaches: Breach[];
  /** The flag each placed class carries: the strongest wish it breaks, and every wish. */
  flags: Map<PlanClass, { level: WishLevel; said: string[] }>;
  tallies: Tally[];
  /** Teachers with classes in the plan who have not answered. */
  unanswered: string[];
};

const minutes = (entry: { startsAt: string; endsAt: string }) => minutesOf(entry.endsAt) - minutesOf(entry.startsAt);
const overlaps = (entry: { startsAt: string; endsAt: string }, from: number, to: number) =>
  minutesOf(entry.startsAt) < to * 60 && minutesOf(entry.endsAt) > from * 60;
const overlapsClock = (entry: { startsAt: string; endsAt: string }, from: string, to: string) =>
  minutesOf(entry.startsAt) < minutesOf(to) && minutesOf(entry.endsAt) > minutesOf(from);
/** Two classes this close are one stretch of teaching, with no real break between them. */
const BREAK_MINUTES = 15;

function label(section: PlanSection | undefined, entry: PlanClass): string {
  const what = section ? `${section.courseCode} ${section.groupLabel}`.trim() : "A class";
  return `${what}, ${DAY_SHORT[entry.weekday]} ${entry.startsAt}`;
}

function dateWords(from: string, to: string): string {
  const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return from === to ? day(from) : `${day(from)}–${day(to)}`;
}

/**
 * Every wish the plan breaks, week by week; the flag each class carries; and, per teacher,
 * how many of their wishes the whole semester keeps.
 *
 * A class is matched to a teacher by the Active teachers record its section names. Limits on
 * the week break in a week, not at a class, so every class involved is flagged: those on the
 * extra days (the days with least teaching, which are the easiest to move), on a day too long,
 * or in a stretch too long without a break.
 */
export function checkWishes(plan: Pick<Plan, "classes" | "sections" | "periods">, teachers: WishTeacher[]): WishCheck {
  const sections = new Map(plan.sections.map((section) => [section.id, section]));
  const answered = new Map(teachers.filter((row) => row.wishes).map((row) => [row.teacherId, row]));
  const breaches: Breach[] = [];
  const unanswered = new Set<string>();

  const classesOf = new Map<string, PlanClass[]>();
  for (const entry of plan.classes) {
    const teacherId = sections.get(entry.sectionId)?.teacherId;
    if (!teacherId) continue;
    classesOf.set(teacherId, [...(classesOf.get(teacherId) ?? []), entry]);
  }

  for (const [teacherId, theirs] of classesOf) {
    const row = answered.get(teacherId);
    if (!row?.wishes) {
      const name = teachers.find((each) => each.teacherId === teacherId)?.name;
      unanswered.add(name ?? sections.get(theirs[0].sectionId)?.teacherName ?? teacherId);
      continue;
    }
    const wishes = row.wishes;
    const lines = wishLines(wishes.cells, wishes.limits);
    const levelOf = (key: string): WishLevel => wishes.levels[key] ?? "would";
    const commentOf = (key: string) => wishes.comments?.[key] ?? "";
    const prefer = new Set(wishes.cells.filter((cell) => cell.kind === "prefer").map((cell) => `${cell.day}:${cell.hour}`));
    const add = (key: string, level: WishLevel, wish: string, how: string, week: number, classes: PlanClass[]) => {
      const same = breaches.find((each) => each.teacherId === teacherId && each.key === key && each.week === week);
      if (same) {
        for (const entry of classes) if (!same.classes.includes(entry)) same.classes.push(entry);
        if (!same.how.includes(how)) same.how = `${same.how}; ${how}`;
        return;
      }
      breaches.push({
        about: "teacher",
        teacherId,
        teacherName: row.name,
        key,
        level,
        wish,
        // Dates away say theirs in the wish itself: "Away 15–19 Mar (Conference)".
        comment: key.startsWith("away:") ? "" : commentOf(key),
        how,
        week,
        classes: [...classes],
      });
    };

    const byWeek = new Map<number, PlanClass[]>();
    for (const entry of theirs) byWeek.set(entry.week, [...(byWeek.get(entry.week) ?? []), entry]);

    for (const [week, inWeek] of byWeek) {
      for (const entry of inWeek) {
        const section = sections.get(entry.sectionId);
        for (const line of lines) {
          if (line.kind === "cant" && line.days.includes(entry.weekday) && overlaps(entry, line.from, line.to)) {
            add(line.key, levelOf(line.key), describeLine(line), label(section, entry), week, [entry]);
          }
        }
        if (prefer.size) {
          // Every quarter the class takes is a preferred one, or it is outside them.
          const start = Math.floor(minutesOf(entry.startsAt) / 15);
          const end = Math.ceil(minutesOf(entry.endsAt) / 15);
          let inside = true;
          for (let quarter = start; quarter < end; quarter += 1) if (!prefer.has(`${entry.weekday}:${quarter * STEP}`)) inside = false;
          if (!inside) add("prefer", levelOf("prefer"), describeLine({ key: "prefer", kind: "prefer" }), label(section, entry), week, [entry]);
        }
        for (const away of wishes.away) {
          if (entry.meetsOn >= away.from && entry.meetsOn <= away.to) {
            const wish = `Away ${dateWords(away.from, away.to)}${away.reason ? ` (${away.reason})` : ""}`;
            add(`away:${away.from}`, "must", wish, label(section, entry), week, [entry]);
          }
        }
      }

      const days = new Map<number, PlanClass[]>();
      for (const entry of inWeek) days.set(entry.weekday, [...(days.get(entry.weekday) ?? []), entry]);
      const dayMinutes = (day: number) => (days.get(day) ?? []).reduce((sum, entry) => sum + minutes(entry), 0);
      const said = (list: number[]) => list.sort((a, b) => a - b).map((day) => DAY_SHORT[day]).join(", ");

      for (const line of lines) {
        if (line.kind === "maxDays" && days.size > line.value) {
          // The days with least teaching are the extra ones: the cheapest to clear.
          const ranked = [...days.keys()].sort((a, b) => dayMinutes(b) - dayMinutes(a) || a - b);
          const extra = ranked.slice(line.value);
          add(line.key, levelOf(line.key), describeLine(line), `${days.size} days: ${said([...days.keys()])}`, week,
            extra.flatMap((day) => days.get(day) ?? []));
        }
        if (line.kind === "maxHoursDay") {
          for (const [day, list] of days) {
            if (dayMinutes(day) > line.value * 60) {
              add(line.key, levelOf(line.key), describeLine(line), `${Math.round(dayMinutes(day) / 6) / 10} h on ${DAY_SHORT[day]}`, week, list);
            }
          }
        }
        if (line.kind === "maxInRow") {
          for (const [day, list] of days) {
            const sorted = [...list].sort((a, b) => minutesOf(a.startsAt) - minutesOf(b.startsAt));
            let run: PlanClass[] = [];
            const close = () => {
              if (run.length) {
                const span = minutesOf(run[run.length - 1].endsAt) - minutesOf(run[0].startsAt);
                if (span > line.value * 60) {
                  add(line.key, levelOf(line.key), describeLine(line), `${Math.round(span / 6) / 10} h in a row on ${DAY_SHORT[day]}`, week, run);
                }
              }
              run = [];
            };
            for (const entry of sorted) {
              const last = run[run.length - 1];
              if (last && minutesOf(entry.startsAt) - minutesOf(last.endsAt) >= BREAK_MINUTES) close();
              run.push(entry);
            }
            close();
          }
        }
        if (line.kind === "freeDay" && days.has(line.value)) {
          add(line.key, levelOf(line.key), describeLine(line), `classes on ${DAY_SHORT[line.value]}`, week, days.get(line.value) ?? []);
        }
      }
    }
  }

  /*
   * The semester's periods bind everybody, answered or not: a class inside Ramadan that
   * breaks one of its rules breaks it whoever teaches it. Said as a Must, being the
   * department's rule, and each class flagged says why: "this one is 3h".
   */
  for (const period of plan.periods ?? []) {
    const inside = plan.classes.filter(
      (entry) => entry.meetsOn >= period.from && entry.meetsOn <= period.to && period.days.includes(entry.weekday),
    );
    const breakRule = (rule: string, wish: string, entry: PlanClass, why: string) => {
      const key = `period:${period.label}:${period.from}:${rule}`;
      const how = label(sections.get(entry.sectionId), entry);
      const said = `${period.label}: ${why}`;
      const same = breaches.find((each) => each.about === "period" && each.key === key && each.week === entry.week);
      if (same) {
        if (!same.classes.includes(entry)) {
          same.classes.push(entry);
          same.how = `${same.how}; ${how}`;
        }
        same.perClass?.set(entry, said);
        return;
      }
      breaches.push({
        about: "period",
        teacherId: "",
        teacherName: period.label,
        key,
        level: "must",
        wish: `${period.label}: ${wish}`,
        comment: "",
        how,
        week: entry.week,
        classes: [entry],
        perClass: new Map([[entry, said]]),
      });
    };
    for (const entry of inside) {
      if (period.endsBy && minutesOf(entry.endsAt) > minutesOf(period.endsBy)) {
        breakRule("endsBy", `classes end by ${period.endsBy}`, entry, `classes end by ${period.endsBy}, this one ends ${entry.endsAt}`);
      }
      if (period.longest && minutes(entry) > period.longest) {
        const rule = `longest class ${lengthWords(period.longest)}`;
        breakRule("longest", rule, entry, `${rule}, this one is ${lengthWords(minutes(entry))}`);
      }
      if (period.blockFrom && period.blockTo && overlapsClock(entry, period.blockFrom, period.blockTo)) {
        const rule = `no classes ${period.blockFrom}–${period.blockTo}`;
        breakRule("block", rule, entry, `${rule}, this one is ${entry.startsAt}–${entry.endsAt}`);
      }
    }
    if (period.dailyMax) {
      // A teacher's day: every class of theirs on one date, whoever's section it is.
      const days = new Map<string, PlanClass[]>();
      for (const entry of inside) {
        const section = sections.get(entry.sectionId);
        const who = section?.teacherId || (entry.teacherName || section?.teacherName || "").trim().toLowerCase();
        if (!who) continue;
        days.set(`${who}|${entry.meetsOn}`, [...(days.get(`${who}|${entry.meetsOn}`) ?? []), entry]);
      }
      const rule = `at most ${lengthWords(period.dailyMax)} a day per teacher`;
      for (const list of days.values()) {
        const total = list.reduce((sum, entry) => sum + minutes(entry), 0);
        if (total <= period.dailyMax) continue;
        const first = list[0];
        const name = first.teacherName || sections.get(first.sectionId)?.teacherName || "Their teacher";
        for (const entry of list) {
          breakRule("dailyMax", rule, entry, `${rule}, ${name} has ${lengthWords(total)} on ${DAY_SHORT[entry.weekday]}`);
        }
      }
    }
  }

  const flags = new Map<PlanClass, { level: WishLevel; said: string[] }>();
  for (const breach of breaches) {
    for (const entry of breach.classes) {
      const flag = flags.get(entry) ?? { level: "would" as WishLevel, said: [] };
      if (breach.level === "must") flag.level = "must";
      const words =
        breach.about === "period"
          ? `Everybody · ${breach.perClass?.get(entry) ?? breach.wish}`
          : `${breach.level === "must" ? "Must" : "Would like"} · ${breach.teacherName}: ${breach.wish}${
              breach.comment ? ` — “${breach.comment}”` : ""
            }`;
      // What binds first, first: a Must or a period before a wish.
      if (!flag.said.includes(words)) flag.said[breach.level === "must" ? "unshift" : "push"](words);
      flags.set(entry, flag);
    }
  }

  const tallies: Tally[] = [...answered.values()]
    .filter((row) => classesOf.has(row.teacherId) && row.wishes)
    .map((row) => {
      const ranked = wishLines(row.wishes!.cells, row.wishes!.limits);
      const broken = new Set(
        breaches.filter((each) => each.about === "teacher" && each.teacherId === row.teacherId).map((each) => each.key),
      );
      const musts = ranked.filter((line) => (row.wishes!.levels[line.key] ?? "would") === "must");
      const woulds = ranked.filter((line) => (row.wishes!.levels[line.key] ?? "would") === "would");
      return {
        teacherId: row.teacherId,
        teacherName: row.name,
        status: row.wishes!.status,
        musts: musts.length,
        mustsKept: musts.filter((line) => !broken.has(line.key)).length,
        woulds: woulds.length,
        wouldsKept: woulds.filter((line) => !broken.has(line.key)).length,
      };
    })
    // The least served first: a Must lost weighs more than any number of Would likes.
    .sort(
      (left, right) =>
        right.musts - right.mustsKept - (left.musts - left.mustsKept) ||
        right.woulds - right.wouldsKept - (left.woulds - left.wouldsKept) ||
        left.teacherName.localeCompare(right.teacherName),
    );

  return { breaches, flags, tallies, unanswered: [...unanswered].sort((a, b) => a.localeCompare(b)) };
}
