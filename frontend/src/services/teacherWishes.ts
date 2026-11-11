/**
 * Timetable preferences: when each teacher can and can't teach, asked once a semester.
 *
 * An answer is a set of *blocks* painted on the week, one week at a time: hours on one or more
 * days that are a **constraint** (they can't teach then: the plan must keep to it) or a
 * **preference** (they would like to teach then: the plan tries to). Each block repeats every
 * week, every week from a given week on, or that one week only — a day away is a constraint for
 * one week. Where blocks overlap in a week the one-week block is on top, then the latest-starting
 * one, then the latest made. Then a few limits on the week, each a constraint or a preference,
 * room needs and a note. The server keeps the same rules (`answer_lines`).
 *
 * The Semester plan reads the answers to shade a teacher's week and flag every placed class
 * that goes against them: a constraint broken is held to as a Must, a preference as a Would like.
 */

import { apiFetch } from "@/services/http";
import type { Period, Plan, PlanClass, PlanSection } from "@/services/semesterPlans";
import { formatDayAndMonth, minutesOf, toIsoDate, weekStartOf } from "@/services/weekSchedule";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/wishes`;

/** What a block is: hours a teacher can't teach, or would like to. */
export type WishKind = "constraint" | "preference";
/** How hard the plan holds to a line: a constraint as a Must, a preference as a Would like. */
export type WishLevel = "must" | "would";
/** How a block repeats: every week, every week from its week on, or its week only. */
export type WishRepeat = "all" | "from" | "once";
/**
 * Hours on one or more days of the week — 1 is Monday — from `from` to `to` (14.25 is 14:15),
 * a constraint or a preference. `week` is the Monday of the week it starts (`from`) or is in
 * (`once`); "" for every week.
 */
export type WishBlock = {
  id: string;
  kind: WishKind;
  days: number[];
  from: number;
  to: number;
  repeat: WishRepeat;
  week: string;
  comment: string;
};

/** A painted cell's length, in hours: a quarter. */
export const STEP = 0.25;

/** "14:15", for 14.25. */
export function clockOf(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
/** The date `days` after an ISO date: "2026-09-15" and 1 is "2026-09-16". */
export function isoPlus(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** An ISO date's day of the week, as the grid counts them: 1 is Monday, 7 Sunday. */
export function isoWeekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return ((new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7) + 1;
}

/** The semester's teaching weeks, each by its number and its Monday; breaks are not counted. */
export function teachingWeeks(calendar: WishCalendar | null | undefined): { number: number; monday: string }[] {
  if (!calendar?.weekOne || !calendar.weeks) return [];
  return Array.from({ length: calendar.weeks }, (_, index) => ({
    number: index + 1,
    monday: toIsoDate(weekStartOf(index + 1, { weekOne: calendar.weekOne, without: calendar.without })),
  }));
}

/** The Monday of the week a date is in. */
export const mondayOfIso = (date: string) => isoPlus(date, 1 - isoWeekday(date));

/** Whether a block applies in the week starting on a Monday. */
export function activeIn(block: WishBlock, monday: string): boolean {
  if (block.repeat === "all") return true;
  if (block.repeat === "from") return monday >= block.week;
  return monday === block.week;
}

/**
 * What each quarter hour of a week holds: the block on top there. A one-week block is on top,
 * then the one starting latest, then the one made latest. Keyed "2:14.25".
 */
export function weekOf(blocks: WishBlock[], monday: string): Map<string, WishBlock> {
  const rank = (block: WishBlock) => (block.repeat === "once" ? 2 : block.repeat === "from" ? 1 : 0);
  const ordered = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => activeIn(block, monday))
    .sort(
      (left, right) =>
        rank(left.block) - rank(right.block) || left.block.week.localeCompare(right.block.week) || left.index - right.index,
    );
  const held = new Map<string, WishBlock>();
  for (const { block } of ordered) {
    for (const day of block.days) {
      for (let hour = block.from; hour < block.to; hour += STEP) held.set(`${day}:${hour}`, block);
    }
  }
  return held;
}

/** Hours a week of constraints that repeat, against the semester's cap; a week's own blocks are not counted. */
export function recurringConstraintHours(blocks: WishBlock[]): number {
  const quarters = new Set<string>();
  for (const block of blocks) {
    if (block.kind !== "constraint" || block.repeat === "once") continue;
    for (const day of block.days) for (let hour = block.from; hour < block.to; hour += STEP) quarters.add(`${day}:${hour}`);
  }
  return quarters.size * STEP;
}

/** "every week", "every week from 18 Jan", "this week only". */
export function repeatWords(block: Pick<WishBlock, "repeat" | "week">): string {
  if (block.repeat === "all") return "every week";
  if (block.repeat === "from") return `every week from ${formatDayAndMonth(block.week)}`;
  return "this week only";
}

/**
 * The dates of a block of one week: "Fri 22 Jan", "Tue 19 Jan, Thu 21 Jan", or, three days or
 * more in a row, "Mon 18 Jan–Fri 22 Jan".
 */
export function datesOf(block: Pick<WishBlock, "days" | "week">): string {
  const dated = (day: number) => `${DAY_SHORT[day]} ${formatDayAndMonth(isoPlus(block.week, day - 1))}`;
  const days = [...block.days].sort((left, right) => left - right);
  const inARow = days.every((day, index) => !index || day === days[index - 1] + 1);
  if (days.length >= 3 && inARow) return `${dated(days[0])}–${dated(days[days.length - 1])}`;
  return days.map(dated).join(", ");
}

/**
 * A block in words: "Constraint · Tue, Thu 14:00–16:00 · every week", "Constraint · Fri 22 Jan,
 * all day". A block of one week names its dates; given the grid, a whole day is "all day".
 */
export function describeBlock(block: Pick<WishBlock, "kind" | "days" | "from" | "to" | "repeat" | "week">, grid?: { firstHour: number; lastHour: number }): string {
  const kind = block.kind === "constraint" ? "Constraint" : "Preference";
  const whole = grid ? block.from <= grid.firstHour && block.to >= grid.lastHour : false;
  const hours = whole ? "all day" : `${clockOf(block.from)}–${clockOf(block.to)}`;
  if (block.repeat === "once") return `${kind} · ${datesOf(block)}, ${hours}`;
  return `${kind} · ${block.days.map((day) => DAY_SHORT[day]).join(", ")} ${hours} · ${repeatWords(block)}`;
}

export type WishLimits = { maxDays?: number | null; maxHoursDay?: number | null; maxInRow?: number | null; freeDay?: number | null };
/**
 * Time away: whole days from one date to another, or part of one day — `start` 14 and `end`
 * 16.5 is 14:00–16:30. Marked on the week it falls in, week by week.
 */

/** A semester's teaching weeks, as the plan keeps them: Week 1's date, how many, breaks and holidays. */
export type WishCalendar = { weekOne: string; weeks: number; without: string[]; holidays: { date: string; label: string }[] };

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

/** A line of an answer, as the plan reads it: a block, or a limit, with how hard it is held to. */
export type WishLine =
  | ({ key: string; kind: WishKind; level?: WishLevel; comment?: string } & Pick<WishBlock, "days" | "from" | "to" | "repeat" | "week">)
  | { key: "prefer"; kind: "prefer"; level?: WishLevel; comment?: string }
  | { key: keyof WishLimits; kind: keyof WishLimits; value: number; level?: WishLevel; comment?: string };

export type Wishes = {
  status: "draft" | "submitted";
  blocks: WishBlock[];
  limits: WishLimits;
  /** Each limit set, a constraint or a preference. */
  limitKinds: Partial<Record<keyof WishLimits, WishKind>>;
  /** Why a limit matters, by its name: "Lab days". A block keeps its own. */
  comments: Record<string, string>;
  needs: string;
  note: string;
  lines: (WishLine & { level: WishLevel; comment: string })[];
  overCapReason: string;
  source: string;
  submittedAt: string;
  updatedAt: string;
  updatedBy: string;
};

/** A teacher's invitation to answer for themselves: never its link, which only the email holds. */
export type WishInvitation = { email: string; createdAt: string; createdBy: string; openedAt: string; signedInAt: string };

export type WishTeacher = {
  teacherId: string;
  name: string;
  email: string;
  wishes: Wishes | null;
  invitation?: WishInvitation | null;
  /** The day a coordinator let this teacher answer until, past the deadline; "" if not. */
  reopenedUntil?: string;
};

/** Whether a teacher may still answer for themselves: until the deadline, or a reopening. */
export type AnswerWindow = { open: boolean; deadline: string; reopenedUntil: string };
export type WishSemester = { collection: WishCollection | null; calendar?: WishCalendar | null; teachers: WishTeacher[] };

export type WishesInput = Pick<Wishes, "blocks" | "limits" | "limitKinds" | "comments" | "needs" | "note" | "overCapReason"> & {
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

/** Invite a teacher to answer for themselves. The link's code comes back once, here. */
export async function inviteTeacher(termCode: string, teacherId: string, email: string): Promise<{ code: string; invitation: WishInvitation }> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}/invitation`, json("POST", { email })),
  );
}

export async function withdrawInvitation(termCode: string, teacherId: string): Promise<void> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}/invitation`, { method: "DELETE" }),
  );
}

export async function reopenFor(termCode: string, teacherId: string, until: string): Promise<AnswerWindow> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}/reopen`, json("PUT", { until })));
}

export async function closeAgain(termCode: string, teacherId: string): Promise<void> {
  return answer(await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}/reopen`, { method: "DELETE" }));
}

/** The link a teacher opens: this site's own address, and the code. */
export const invitationLink = (code: string) => `${window.location.origin}/preferences/${code}`;

export async function forgetWishes(termCode: string, teacherId: string): Promise<void> {
  return answer(
    await apiFetch(`${BASE}/${encodeURIComponent(termCode)}/${encodeURIComponent(teacherId)}`, { method: "DELETE" }),
  );
}

// ------------------------------------------------------------------------ wishes from an answer

const LIMIT_KEYS = ["maxDays", "maxHoursDay", "maxInRow", "freeDay"] as const;
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** What an answer asks of the plan, one line each, as the server says it: blocks, constraints first, then limits. */
export function answerLines(blocks: WishBlock[], limits: WishLimits, limitKinds: Wishes["limitKinds"]): WishLine[] {
  const lines: WishLine[] = [...blocks]
    .sort((left, right) => Number(left.kind !== "constraint") - Number(right.kind !== "constraint"))
    .map((block) => ({
      key: block.id,
      kind: block.kind,
      days: block.days,
      from: block.from,
      to: block.to,
      repeat: block.repeat,
      week: block.week,
      level: block.kind === "constraint" ? ("must" as const) : ("would" as const),
    }));
  for (const name of LIMIT_KEYS) {
    const value = limits[name];
    if (value) lines.push({ key: name, kind: name, value, level: limitKinds[name] === "constraint" ? "must" : "would" });
  }
  return lines;
}

/** A line in the words of the panel and the flags: "Constraint · Tue 14:00–18:00 · every week". */
export function describeLine(line: WishLine): string {
  switch (line.kind) {
    case "constraint":
    case "preference":
      return describeBlock(line);
    case "prefer":
      return "Outside their preferences";
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
 * A teacher's week as stretches to shade on the plan's grid, a day at a time, for the week
 * starting on a Monday: `{2: [{from: "14:00", to: "18:00", kind: "constraint", block}]}`.
 */
export function shadingFor(
  wishes: Pick<Wishes, "blocks">,
  monday: string,
): Record<number, { from: string; to: string; kind: WishKind; block: WishBlock }[]> {
  const shaded: Record<number, { from: string; to: string; kind: WishKind; block: WishBlock }[]> = {};
  const held = [...weekOf(wishes.blocks, monday).entries()]
    .map(([key, block]) => {
      const [day, hour] = key.split(":").map(Number);
      return { day, hour, block };
    })
    .sort((a, b) => a.day - b.day || a.hour - b.hour);
  for (const { day, hour, block } of held) {
    const list = (shaded[day] ??= []);
    const last = list[list.length - 1];
    if (last && last.block === block && last.to === clockOf(hour)) last.to = clockOf(hour + STEP);
    else list.push({ from: clockOf(hour), to: clockOf(hour + STEP), kind: block.kind, block });
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
    const blocks = wishes.blocks ?? [];
    const lines = answerLines(blocks, wishes.limits, wishes.limitKinds ?? {});
    const levelOf = (key: string): WishLevel => lines.find((line) => line.key === key)?.level ?? "would";
    const commentOf = (key: string) => blocks.find((block) => block.id === key)?.comment || wishes.comments?.[key] || "";
    const add = (key: string, level: WishLevel, wish: string, how: string, week: number, classes: PlanClass[]) => {
      const same = breaches.find((each) => each.teacherId === teacherId && each.key === key && each.week === week);
      if (same) {
        for (const entry of classes) if (!same.classes.includes(entry)) same.classes.push(entry);
        if (!same.how.includes(how)) same.how = `${same.how}; ${how}`;
        return;
      }
      breaches.push({ about: "teacher", teacherId, teacherName: row.name, key, level, wish, comment: commentOf(key), how, week, classes: [...classes] });
    };
    // Each week's blocks on top, worked out once a week.
    const weeks = new Map<string, Map<string, WishBlock>>();
    const heldIn = (monday: string) => {
      let held = weeks.get(monday);
      if (!held) {
        held = weekOf(blocks, monday);
        weeks.set(monday, held);
      }
      return held;
    };

    const byWeek = new Map<number, PlanClass[]>();
    for (const entry of theirs) byWeek.set(entry.week, [...(byWeek.get(entry.week) ?? []), entry]);

    for (const [week, inWeek] of byWeek) {
      for (const entry of inWeek) {
        const section = sections.get(entry.sectionId);
        const held = heldIn(mondayOfIso(entry.meetsOn));
        // Every quarter the class takes: a constraint there is broken; outside every preference, so are they.
        const hit = new Set<WishBlock>();
        let inside = true;
        const start = Math.floor(minutesOf(entry.startsAt) / 15);
        const end = Math.ceil(minutesOf(entry.endsAt) / 15);
        for (let quarter = start; quarter < end; quarter += 1) {
          const block = held.get(`${entry.weekday}:${quarter * STEP}`);
          if (block?.kind === "constraint") hit.add(block);
          if (block?.kind !== "preference") inside = false;
        }
        for (const block of hit) add(block.id, "must", describeBlock(block), label(section, entry), week, [entry]);
        const prefers = [...held.values()].some((block) => block.kind === "preference");
        if (prefers && !inside) add("prefer", "would", describeLine({ key: "prefer", kind: "prefer" }), label(section, entry), week, [entry]);
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
          : `${breach.level === "must" ? "Constraint" : "Preference"} · ${breach.teacherName}: ${breach.wish.replace(/^(Constraint|Preference) · /, "")}${
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
      const wishes = row.wishes!;
      const blocks = wishes.blocks ?? [];
      const lines = answerLines(blocks, wishes.limits, wishes.limitKinds ?? {}).filter((line) => line.kind !== "preference");
      // Preferences are kept, or not, together: a class outside all of them is outside "their preferences".
      if (blocks.some((block) => block.kind === "preference")) lines.push({ key: "prefer", kind: "prefer", level: "would" });
      const broken = new Set(
        breaches.filter((each) => each.about === "teacher" && each.teacherId === row.teacherId).map((each) => each.key),
      );
      const musts = lines.filter((line) => line.level === "must");
      const woulds = lines.filter((line) => line.level !== "must");
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
