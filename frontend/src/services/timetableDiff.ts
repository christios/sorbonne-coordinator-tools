/**
 * Turning the student platform's diff into what the review screen shows, and turning what
 * the coordinator ticked back into the changes to apply.
 *
 * Pure functions, because these are the rules that have to be right: which rows are
 * offered, what a tick means for the course around it, and — the part with teeth — exactly
 * which operations get sent. Nothing here touches the network.
 *
 * Nothing starts ticked. A re-export is mostly noise and the few rows that matter deserve
 * a decision each, so the screen opens with everything off and "Apply" disabled. The
 * per-course and per-category ticks are there so that scanning 200 room moves stays a
 * minute's work rather than an afternoon's.
 */

/** What the platform says about one session row. */
export type DiffSessionStatus = "unchanged" | "changed" | "added" | "removed";

export type DiffSession = {
  status: DiffSessionStatus;
  sessionId: string | null;
  before: SessionValues | null;
  after: SessionValues | null;
  /** "room 7.113 → 9.001", already worded by the platform. */
  changes: string[];
  matchRule: string;
  /** How the platform decided these two rows are the same session. */
  matchedOn: string;
  /** False when the pairing is an inference the coordinator should look at. */
  isCertain: boolean;
};

export type SessionValues = {
  date: string;
  start: string;
  end: string;
  room: string;
  isExam: boolean;
};

export type CourseValues = {
  code: string;
  title: string;
  shortTitle: string;
  kind: string;
  groupLabel: string;
  staff: string;
};

export type DiffCourse = {
  crn: string;
  code: string;
  title: string;
  groupLabel: string;
  kind: string;
  status: "present" | "added" | "removed";
  /** "lecturer Dupont → Martin", for the course rather than a session. */
  courseChanges: string[];
  before: CourseValues | null;
  after: CourseValues | null;
  enrolledStudents: number;
  sessions: DiffSession[];
};

export type TimetablePreview = {
  term: { id: string; name: string };
  baseUpdatedAt: string;
  filename: string;
  summary: DiffSummary;
  courses: DiffCourse[];
};

export type DiffSummary = {
  unchanged: number;
  changed: number;
  added: number;
  removed: number;
  courseChanges: number;
  coursesAdded: number;
  coursesRemoved: number;
  uncertainMatches: number;
  studentsLosingCourses: number;
};

export type Operation = Record<string, unknown> & { op: string };

/** The chips above the rows. "unchanged" is a category like any other, just collapsed. */
export type DiffFilter = "all" | "changed" | "added" | "removed" | "course" | "unchanged";

/**
 * A row's identity within one preview.
 *
 * The export has no row id, so a *removed* row is keyed by its stored session id and an
 * *added* row by the values it would be created with. Both are stable for as long as the
 * preview the browser is holding, which is all the selection needs to survive.
 */
export function rowKey(crn: string, session: DiffSession): string {
  if (session.sessionId) return `s:${session.sessionId}`;
  const { date, start, end, room } = session.after as SessionValues;
  return `n:${crn}:${date}:${start}:${end}:${room}`;
}

/** The course's own row — its details changed, or the whole course arrived or went. */
export function courseKey(crn: string): string {
  return `c:${crn}`;
}

/**
 * Whether a course has anything worth a decision.
 *
 * An untouched course still appears when the coordinator asks to see unchanged rows, but
 * it never appears in the default view — the point of the screen is the delta.
 */
export function hasDecisions(course: DiffCourse): boolean {
  if (course.status !== "present" || course.courseChanges.length > 0) return true;
  return course.sessions.some((session) => session.status !== "unchanged");
}

function matchesFilter(course: DiffCourse, session: DiffSession, filter: DiffFilter): boolean {
  if (filter === "all") return session.status !== "unchanged";
  if (filter === "course") return false;
  return session.status === filter;
}

/** Whether the course's own row belongs in this view. */
export function courseRowMatches(course: DiffCourse, filter: DiffFilter): boolean {
  const isCourseLevel = course.status !== "present" || course.courseChanges.length > 0;
  if (!isCourseLevel) return false;
  if (filter === "all" || filter === "course") return true;
  if (filter === "added") return course.status === "added";
  if (filter === "removed") return course.status === "removed";
  return false;
}

/** The courses to render, each already narrowed to the rows this filter shows. */
export function visibleCourses(courses: DiffCourse[], filter: DiffFilter): DiffCourse[] {
  return courses
    .map((course) => ({
      ...course,
      sessions: course.sessions.filter((session) => matchesFilter(course, session, filter)),
    }))
    .filter((course) => course.sessions.length > 0 || courseRowMatches(course, filter));
}

/**
 * Every key a "tick all" should reach for one course.
 *
 * A removed course is the exception: its session rows are shown so the coordinator can see
 * what would go, but they are not separately approvable. Removing the course takes them —
 * and its enrolments — with it, so the course row is the only decision there is.
 */
export function keysOf(course: DiffCourse): string[] {
  if (course.status === "removed") return [courseKey(course.crn)];
  const keys = course.sessions
    .filter((session) => session.status !== "unchanged")
    .map((session) => rowKey(course.crn, session));
  if (course.status === "added" || course.courseChanges.length > 0) keys.unshift(courseKey(course.crn));
  return keys;
}

/** Every approvable key in the whole preview, in the order the screen lists them. */
export function allKeys(courses: DiffCourse[]): string[] {
  return courses.flatMap(keysOf);
}

export function countDecisions(courses: DiffCourse[]): number {
  return allKeys(courses).length;
}

/**
 * How many students would be unenrolled by what is currently ticked.
 *
 * Only course removals can do it — the foreign key cascades — so this is the number the
 * footer has to keep in front of the coordinator before they press Apply.
 */
export function studentsAffected(courses: DiffCourse[], selected: Set<string>): number {
  return courses
    .filter((course) => course.status === "removed" && selected.has(courseKey(course.crn)))
    .reduce((total, course) => total + course.enrolledStudents, 0);
}

/**
 * The changes to send, built from what is ticked.
 *
 * Order does not matter here — the platform sorts operations so that courses exist before
 * sessions hang off them and removals happen last — but only ticked rows ever appear, which
 * is what makes the result "stored plus approved" rather than "the file".
 */
export function operationsFrom(courses: DiffCourse[], selected: Set<string>): Operation[] {
  const operations: Operation[] = [];

  for (const course of courses) {
    const courseTicked = selected.has(courseKey(course.crn));

    if (course.status === "removed") {
      if (courseTicked) operations.push({ op: "removeCourse", crn: course.crn });
      continue;
    }

    if (course.status === "added" && courseTicked) {
      operations.push({ op: "addCourse", crn: course.crn, ...(course.after as CourseValues) });
    } else if (course.courseChanges.length > 0 && courseTicked) {
      operations.push({ op: "updateCourse", crn: course.crn, ...(course.after as CourseValues) });
    }

    for (const session of course.sessions) {
      if (session.status === "unchanged") continue;
      if (!selected.has(rowKey(course.crn, session))) continue;

      if (session.status === "changed") {
        operations.push({ op: "updateSession", sessionId: session.sessionId, ...(session.after as SessionValues) });
      } else if (session.status === "removed") {
        operations.push({ op: "removeSession", sessionId: session.sessionId });
      } else if (session.status === "added") {
        // A session on a course that is itself new only makes sense once that course is
        // approved, so the screen keeps the two ticks together rather than sending an
        // orphan the platform would refuse.
        if (course.status === "added" && !courseTicked) continue;
        operations.push({ op: "addSession", crn: course.crn, ...(session.after as SessionValues) });
      }
    }
  }

  return operations;
}

/** "Mon 31 Aug 2026", the way the rest of the tool writes a date. */
export function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** What a row says when nothing moved but it still has to be shown. */
export function describeSession(values: SessionValues): string {
  const room = values.room ? ` · ${values.room}` : "";
  return `${formatDate(values.date)} · ${values.start}–${values.end}${room}${values.isExam ? " · exam" : ""}`;
}
