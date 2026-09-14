/**
 * A week of dated meetings, laid out — the arithmetic under the calendar, with no React in it.
 *
 * Brought over from the SCEN Student Hub, where a student reads their own week. Here the
 * same grid is read about other people — a student, a teacher, a course, one CRN — and in
 * places of very different widths, so the helpers know nothing about who is being looked at
 * or how wide the page is: dates, minutes, weeks and lanes, and nothing else.
 */

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** What a coordinator has said about one dated class, when they have said anything. */
export type SessionNote = {
  kind: "cancelled" | "covered";
  coverTeacherName: string;
  note: string;
};

/** One dated meeting of a CRN, as the registrar's sweep holds it. */
export type Session = {
  crn: string;
  /** The portal term the sweep files it under. */
  termCode?: string;
  /** ISO date. */
  date: string;
  /** HH:MM. */
  start: string;
  end: string;
  room: string;
  /** Cancelled, or covered by somebody else — said on the CRN's calendar. */
  change?: SessionNote;
};

export type PlacedSession = Session & {
  /** Runs into another session of the same calendar on the same day. */
  clashes: boolean;
};

/** What the calendar prints about a CRN, and how it paints it. */
export type CalendarCourse = {
  crn: string;
  code: string;
  title: string;
  /** The words in the box. The course code unless the caller has something shorter. */
  label: string;
  staff: string;
  /** `outline` for a class the person is expected in but the registrar has not registered them for. */
  tone: "solid" | "outline";
  /** A background colour, shared by everything the caller wants read as one thing. */
  color: string;
  /** Whether pressing one of its boxes has somewhere to go — a CRN record of ours. */
  openable: boolean;
};

/**
 * Colours that stay apart from each other and from the page's own reds and ambers, which
 * mean something. Ten is more than a week of one person's classes ever needs; a course
 * with more sections than that repeats, and the legend says which is which.
 */
export const COURSE_COLORS = [
  "#1f4e79",
  "#2f6b3d",
  "#8a4b1f",
  "#5b3f8a",
  "#1f7a7a",
  "#9a3c6b",
  "#6b6b1f",
  "#3b5f9a",
  "#b0602a",
  "#4a6b2f",
] as const;

/** One colour per key, in the order the keys are given, so the same keys always paint the same. */
export function assignColors(keys: string[]): Map<string, string> {
  const held = new Map<string, string>();
  for (const key of keys) {
    if (!held.has(key)) held.set(key, COURSE_COLORS[held.size % COURSE_COLORS.length]);
  }
  return held;
}

export function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function toIsoDate(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isoToday(): string {
  return toIsoDate(new Date());
}

export function formatDayAndMonth(iso: string): string {
  const date = parseIsoDate(iso);
  return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
}

export function formatLongDate(iso: string): string {
  const date = parseIsoDate(iso);
  return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function overlaps(a: Session, b: Session): boolean {
  return a.date === b.date && minutesOf(a.start) < minutesOf(b.end) && minutesOf(b.start) < minutesOf(a.end);
}

/** Sort by day and time, and mark every session that runs into another one. */
export function placeSessions(sessions: Session[]): PlacedSession[] {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || minutesOf(a.start) - minutesOf(b.start));
  return ordered.map((session, index) => ({
    ...session,
    clashes: ordered.some((other, otherIndex) => otherIndex !== index && overlaps(session, other)),
  }));
}

export function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function shiftWeek(weekStart: Date, weeks: number): Date {
  const next = new Date(weekStart);
  next.setDate(next.getDate() + weeks * 7);
  return mondayOf(next);
}

/** The week to open on: the one holding the next session, or the last one if they are all past. */
export function defaultWeekStart(sessions: Session[], today: string): Date {
  const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
  const next = ordered.find((session) => session.date >= today) ?? ordered[ordered.length - 1];
  return mondayOf(next ? parseIsoDate(next.date) : parseIsoDate(today));
}

/** Monday to Friday, plus Saturday only in a week that uses it. */
export function weekDays(weekStart: Date, sessions: Session[]): string[] {
  const days: string[] = [];
  for (let offset = 0; offset < 6; offset += 1) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + offset);
    days.push(toIsoDate(day));
  }
  const saturday = days[5];
  return sessions.some((session) => session.date === saturday) ? days : days.slice(0, 5);
}

export function weekLabel(weekStart: Date, sessions: Session[]): string {
  const days = weekDays(weekStart, sessions);
  const format = (iso: string) => {
    const date = parseIsoDate(iso);
    return `${date.getDate()} ${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
  };
  return `${format(days[0])} – ${format(days[days.length - 1])}`;
}

export function sessionsInRange<T extends Session>(sessions: T[], from: string, to: string): T[] {
  return sessions.filter((session) => session.date >= from && session.date <= to);
}

export function sessionsOnDay<T extends Session>(sessions: T[], day: string): T[] {
  return sessions.filter((session) => session.date === day);
}

/** Today when the week holds it, otherwise the first day of the week with a class in it. */
export function preferredDay(days: string[], sessions: Session[], today: string): string {
  if (days.includes(today)) return today;
  return days.find((day) => sessions.some((session) => session.date === day)) ?? days[0];
}

export type HourBounds = { startMinute: number; endMinute: number };

/**
 * The hours the grid has to show: whole hours around every session, and never less than
 * a teaching day. Read off the sessions rather than fixed, so one tutorial a week is not
 * drawn on twelve hours of empty grid — but never narrower than 08:00–18:00, so two weeks
 * of the same calendar line up.
 */
export function hourBounds(sessions: Session[], atLeast: HourBounds = { startMinute: 8 * 60, endMinute: 18 * 60 }): HourBounds {
  let startMinute = atLeast.startMinute;
  let endMinute = atLeast.endMinute;
  for (const session of sessions) {
    startMinute = Math.min(startMinute, Math.floor(minutesOf(session.start) / 60) * 60);
    endMinute = Math.max(endMinute, Math.ceil(minutesOf(session.end) / 60) * 60);
  }
  return { startMinute: Math.max(0, startMinute), endMinute: Math.min(24 * 60, Math.max(endMinute, startMinute + 60)) };
}

export type Laned<T extends Session> = { session: T; lane: number; lanes: number };

/**
 * Side by side rather than on top of each other.
 *
 * The Hub draws one student's sessions and a clash there is the exception, so a box could
 * simply sit over the other. A course's calendar draws every group's tutorial, four of
 * them in the same Monday slot on purpose, and stacked they would read as one. Each
 * session takes the first lane free when it starts; everything that overlaps, directly or
 * through a chain, shares the same count of lanes so the widths agree across the cluster.
 */
export function laneOut<T extends Session>(sessions: T[]): Laned<T>[] {
  // Longest first among classes starting together, so the long one takes the left lane
  // and the short one beside it frees its lane for whatever follows.
  const ordered = [...sessions].sort((a, b) => minutesOf(a.start) - minutesOf(b.start) || minutesOf(b.end) - minutesOf(a.end));
  const placed: { session: T; lane: number; cluster: number }[] = [];
  const laneEnds: number[] = [];
  let cluster = -1;
  let clusterEnd = -1;
  for (const session of ordered) {
    const start = minutesOf(session.start);
    const end = minutesOf(session.end);
    if (start >= clusterEnd) {
      cluster += 1;
      clusterEnd = end;
      laneEnds.length = 0;
    } else {
      clusterEnd = Math.max(clusterEnd, end);
    }
    let lane = laneEnds.findIndex((free) => free <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    placed.push({ session, lane, cluster });
  }
  const lanesOf = new Map<number, number>();
  for (const entry of placed) lanesOf.set(entry.cluster, Math.max(lanesOf.get(entry.cluster) ?? 0, entry.lane + 1));
  return placed.map(({ session, lane, cluster: own }) => ({ session, lane, lanes: lanesOf.get(own) ?? 1 }));
}

/**
 * The registrar's room strings run words together ("7.113-1st floorLibrary"). Split only
 * at a lower-to-upper boundary, which leaves codes like "5.033/.035" alone.
 */
export function formatRoom(room: string): string {
  return room.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** "Mon 14 Sep · 08:15–10:15", for a list of classes. */
export function formatShortDateTime(iso: string, start: string, end: string): string {
  const date = parseIsoDate(iso);
  const day = `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`;
  return end ? `${day} · ${start.slice(0, 5)}–${end.slice(0, 5)}` : `${day} · ${start.slice(0, 5)}`;
}
