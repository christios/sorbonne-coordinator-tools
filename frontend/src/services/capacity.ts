/**
 * How full every group is, section by section — the Capacity sheet of the workbooks.
 *
 * The question it answers is the one asked at the start of term and again every time
 * somebody moves: is this class over its seats, and where is there room. A row is one
 * section, as the workbook's sheet had it: the CRN, the group it belongs to, how many
 * seats it has and how many of them are taken.
 *
 * Enrolment is a property of the group, not of the course: a student in TD 1 is in TD 1
 * for every course the set carries, so the three sections of TD 1 all read the same
 * count. That repetition is the workbook's too, and it is what makes the sheet sortable
 * by CRN.
 *
 * Retired sections are left out. Nobody is in them and nobody will be.
 */

import { subRowLabel } from "@/services/courseCards";
import { partsOf, sectionFor, shortProgram, type CohortCatalogue } from "@/services/studentDatabase";
import type { ActiveCourse } from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

export type CapacityRow = {
  /** Cohort, semester, set, group and course together: one row per section. */
  key: string;
  cohortId: string;
  cohortName: string;
  termId: string;
  termName: string;
  set: string;
  /** True when the set is one the whole department shares, as the languages are. */
  shared: boolean;
  group: string;
  courseCode: string;
  courseTitle: string;
  component: string;
  ue: string;
  crn: string;
  teacher: string;
  /** The seats the group (or sub-row) has; 0 when nobody has set them. */
  capacity: number;
  enrolled: number;
  /** Negative when the group is over its seats, which is the number worth seeing. */
  free: number;
  status: CapacityStatus;
  /**
   * The group itself, whichever of its classes this row is — and its own seats and students.
   *
   * A group whose programmes are taught different things has a row per class here: L1's
   * CM is the lectures all 109 attend, MATH-113 for the 91 mathematicians and PHYS-118
   * for the 18 physicists. Three rows, one group of 109 in 120 seats — which is what the
   * page counts, from these.
   */
  groupKey: string;
  groupLabel: string;
  groupCapacity: number;
  groupEnrolled: number;
  /** The programme part this row's class is for — "Physics" — when the group has parts; "" otherwise. */
  part: string;
  /** Every part of the group, with its own seats and students; empty for a group not in parts. */
  parts: { name: string; seats: number; enrolled: number }[];
};

export type CapacityStatus = "Over" | "Full" | "Room" | "Empty" | "No capacity set";

/** What the numbers say about one group, in the word a coordinator would use. */
export function statusOf(capacity: number, enrolled: number): CapacityStatus {
  if (!capacity) return "No capacity set";
  if (enrolled > capacity) return "Over";
  if (enrolled === capacity) return "Full";
  return enrolled === 0 ? "Empty" : "Room";
}

/**
 * Whether every major of the group taught this course sits in the same class for it — the
 * lecture both halves of L1's CM attend. That is one room holding all of them, not a
 * room per major, so it is counted as the group.
 */
function sharedByAll(group: CohortCatalogue["scopes"][number]["groups"][number], courseId: string): boolean {
  const taught = (group.majors ?? []).filter((major) => !group.byMajor?.[major.id]?.[courseId]?.notTaught);
  return taught.length >= 2 && taught.every((major) => !group.byMajor?.[major.id]?.[courseId]);
}

export function capacityRows(
  cohorts: CohortCatalogue[],
  termName: (termId: string) => string,
  activeCourses: ActiveCourse[] = [],
  teacherName: (teacherId: string) => string = () => "",
): CapacityRow[] {
  const ue = new Map(activeCourses.map((course) => [course.courseCode.toUpperCase(), course.ue]));
  const rows: CapacityRow[] = [];

  for (const held of cohorts) {
    for (const scope of held.scopes) {
      const termId = scope.termId ?? "";
      for (const course of scope.courses) {
        /*
         * A row per sub-row of a group that has them: each has its own seats and its own
         * reading of the cells, which is the whole reason the sub-rows exist. A group with
         * none is one row, as before.
         */
        const seats = scope.groups.flatMap((group) =>
          (group.majors ?? []).length && !sharedByAll(group, course.id)
            ? (group.majors ?? []).map((major) => ({
                group,
                label: subRowLabel(group.label, major.program, (group.majors ?? []).length),
                seats: major.seats,
                assigned: major.assigned,
                section: sectionFor(group, major.id, course.id),
                keyPart: major.id,
                part: (group.majors ?? []).length >= 2 ? shortProgram(major.program) : "",
              }))
            : [{ group, label: group.label, seats: group.capacity, assigned: group.assigned, section: group.crns[course.id] ?? null, keyPart: "", part: "" }],
        );
        for (const seat of seats) {
          const group = seat.group;
          /*
           * A row per PART, not per section.
           *
           * This is a sheet of CRNs — one line for each thing the registrar has to seat —
           * and a course handed from one professor to another at mid-semester is booked
           * under a CRN per half. Reading the section alone gave the first half a line and
           * left the second with none, so half a term's teaching had no seats anywhere on
           * the page that exists to count them.
           */
          for (const section of partsOf(seat.section)) {
            if (section.retired) continue;
            // The seats, and only the seats: they are what the timetable is told to expect
            // too, so a number typed on the section no longer stands in for them.
            const capacity = seat.seats || 0;
            const enrolled = seat.assigned;
            rows.push({
              key: `${held.cohort.id}|${scope.id}|${group.id}|${seat.keyPart}|${course.id}|${section.part}`,
              cohortId: held.cohort.id,
              cohortName: held.cohort.name,
              termId,
              termName: termName(termId),
              set: scope.code,
              shared: scope.openToAll,
              group: seat.label,
              courseCode: course.code,
              courseTitle: course.name,
              component: course.component,
              ue: ue.get(course.code.toUpperCase()) ?? "",
              crn: section.crn,
              teacher: (section.teacherId && teacherName(section.teacherId)) || section.teacher,
              capacity,
              enrolled,
              free: capacity ? capacity - enrolled : 0,
              status: statusOf(capacity, enrolled),
              groupKey: `${held.cohort.id}|${group.id}`,
              groupLabel: group.label,
              // A group in parts is the parts together; any other reads as its row always did.
              ...((group.majors ?? []).length >= 2
                ? {
                    groupCapacity: group.capacity || (group.majors ?? []).reduce((total, major) => total + major.seats, 0),
                    groupEnrolled: group.assigned,
                  }
                : { groupCapacity: capacity, groupEnrolled: enrolled }),
              part: seat.part,
              parts:
                (group.majors ?? []).length >= 2
                  ? (group.majors ?? []).map((major) => ({ name: shortProgram(major.program), seats: major.seats, enrolled: major.assigned }))
                  : [],
            });
          }
        }
      }
    }
  }

  return rows.sort(
    (left, right) =>
      left.cohortName.localeCompare(right.cohortName) ||
      left.termName.localeCompare(right.termName) ||
      left.set.localeCompare(right.set) ||
      left.courseCode.localeCompare(right.courseCode, undefined, { numeric: true }) ||
      left.group.localeCompare(right.group, undefined, { numeric: true }),
  );
}

/**
 * One group counted once, however many courses its set carries.
 *
 * The rows repeat a group's seats per section, which is right for a sheet of CRNs and
 * wrong for "how many seats does this cohort have". This is the other reading.
 */
export function groupTotals(rows: CapacityRow[]): {
  groups: number;
  /** Seats, counted only where a group states a capacity — adding zeroes would lie. */
  capacity: number;
  seated: number;
  /**
   * Seats taken, which is not a headcount.
   *
   * A student sits in several groups at once — a lecture, a tutorial, a practical — and
   * each is a placement. Adding the groups up therefore counts most students several
   * times over, which is right against the seats and wrong against the cohort, so it is
   * named for what it is.
   */
  placements: number;
  over: number;
  withoutCapacity: number;
} {
  // Each class once, for what is over its seats: a programme's part can be over while the
  // group as a whole is not, and the part is the room that will not hold them.
  const bars = new Map<string, CapacityRow>();
  // Each group once, for everything counted: its own seats and its own students.
  const real = new Map<string, CapacityRow>();
  for (const row of rows) {
    const bar = `${row.cohortId}|${row.set}|${row.group}`;
    if (!bars.has(bar)) bars.set(bar, row);
    if (!real.has(row.groupKey)) real.set(row.groupKey, row);
  }
  const groups = [...real.values()];
  const seated = groups.filter((row) => row.groupCapacity);
  return {
    groups: groups.length,
    capacity: seated.reduce((total, row) => total + row.groupCapacity, 0),
    seated: seated.length,
    placements: groups.reduce((total, row) => total + row.groupEnrolled, 0),
    over: [...bars.values()].filter((row) => row.status === "Over").length,
    withoutCapacity: groups.length - seated.length,
  };
}

/**
 * One group, once, with the sections it is taught in.
 *
 * The rows above are one per section, which is what a sheet of CRNs wants and the wrong
 * unit for "is this class over its seats" — TD 1 is one class of thirty-four whether its
 * set carries one course or three. This is the group's own reading, and it keeps its
 * sections so the answer can be opened up.
 */
export type GroupCapacity = {
  key: string;
  cohortId: string;
  cohortName: string;
  /**
   * Every cohort whose students are in this class.
   *
   * One name for a cohort's own group. Several for a shared one, which is the whole of
   * what "shared" means — and worth saying on screen, since 24 of 30 reads differently
   * when the 24 are four years' students rather than one's.
   */
  cohortNames: string[];
  termName: string;
  set: string;
  shared: boolean;
  group: string;
  capacity: number;
  enrolled: number;
  free: number;
  status: CapacityStatus;
  sections: CapacityRow[];
  /**
   * The programme this line is, for a group split by programme — "Mathematics" — or ""
   * for a line that is the whole group. Such a group is a line per programme: each has
   * its own planned seats and its own course, and the lectures they share are listed
   * under both.
   */
  part: string;
  /** The group the line belongs to, and the group's own seats and students, for the totals. */
  groupKey: string;
  groupCapacity: number;
  groupEnrolled: number;
};

/**
 * One row per group — and for a set everybody shares, one row per CLASS.
 *
 * A set open to every cohort may be carried by more than one of them: each holds its own
 * record of "A0-F5", and every record names the same CRN, because there is one French
 * class at that hour and four years sitting in it together is the whole point of a shared
 * set. Read a record at a time, that is four groups of thirty — four bars, three of them
 * empty, and the same thirty chairs counted four times.
 *
 * So identical records of a shared class are folded into one:
 *
 * - **the enrolments add up**, once per cohort, because each record holds that cohort's
 *   own students and the class holds all of them;
 * - **the seats do not**, being the same chairs;
 * - **the sections are named once**, four copies of one CRN being one CRN.
 *
 * Identical means the same set, the same label AND the same CRNs. Two shared groups that
 * share a name but not a CRN are two classes that happen to be called the same thing —
 * folding those would invent a class nobody teaches, which is a worse fault than the one
 * this fixes. A cohort's own group is never folded: "TD 1" in Foundation Year and "TD 1"
 * in L1 are two rooms and two teachers.
 */
export function capacityByGroup(rows: CapacityRow[]): GroupCapacity[] {
  const held = new Map<string, GroupCapacity>();
  const line = (row: CapacityRow, part: CapacityRow["parts"][number] | null): GroupCapacity => {
    const key = part ? `${row.groupKey}|${part.name}` : row.groupKey;
    let seen = held.get(key);
    if (!seen) {
      const capacity = part ? part.seats : row.groupCapacity;
      const enrolled = part ? part.enrolled : row.groupEnrolled;
      seen = {
        key,
        cohortId: row.cohortId,
        cohortName: row.cohortName,
        cohortNames: [row.cohortName],
        termName: row.termName,
        set: row.set,
        shared: row.shared,
        group: part ? `${row.groupLabel} · ${part.name}` : row.groupLabel,
        capacity,
        enrolled,
        free: capacity ? capacity - enrolled : 0,
        status: statusOf(capacity, enrolled),
        sections: [],
        part: part?.name ?? "",
        groupKey: row.groupKey,
        groupCapacity: row.groupCapacity,
        groupEnrolled: row.groupEnrolled,
      };
      held.set(key, seen);
    }
    return seen;
  };
  for (const row of rows) {
    /*
     * A line per group — and for a group split by programme, a line per programme. Its own
     * class goes on its own line; a class the programmes share goes on each of them.
     */
    if (!row.parts.length) {
      line(row, null).sections.push(row);
      continue;
    }
    for (const part of row.parts) {
      if (!row.part || row.part === part.name) line(row, part).sections.push(row);
    }
  }
  return foldShared([...held.values()]).sort(
    (left, right) => left.set.localeCompare(right.set) || left.group.localeCompare(right.group, undefined, { numeric: true }),
  );
}

/** What identifies a shared class: its set, its name, and the CRNs it is taught under. */
function classOf(group: GroupCapacity): string {
  const crns = [...new Set(group.sections.map((section) => section.crn))].sort();
  return `${group.set}|${group.group}|${crns.join("+")}`;
}

/** Cohorts' copies of one shared class, added together into the class. */
function foldShared(groups: GroupCapacity[]): GroupCapacity[] {
  const byClass = new Map<string, GroupCapacity>();
  const out: GroupCapacity[] = [];
  for (const group of groups) {
    if (!group.shared) {
      out.push(group);
      continue;
    }
    const key = classOf(group);
    const seen = byClass.get(key);
    if (!seen) {
      byClass.set(key, group);
      out.push(group);
      continue;
    }
    if (!seen.cohortNames.includes(group.cohortName)) seen.cohortNames.push(group.cohortName);
    seen.enrolled += group.enrolled;
    seen.groupEnrolled += group.groupEnrolled;
    seen.free = seen.capacity ? seen.capacity - seen.enrolled : 0;
    seen.status = statusOf(seen.capacity, seen.enrolled);
  }
  return out;
}

/** The groups of one set, and how the set stands as a whole. */
export type SetCapacity = {
  code: string;
  shared: boolean;
  /** A line each: one per group, or one per programme of a group split by programme. */
  groups: GroupCapacity[];
  /** How many groups those lines are, each counted once. */
  groupCount: number;
  capacity: number;
  enrolled: number;
  over: number;
  /** The fullest group's enrolment, so every bar in the set is drawn to one scale. */
  peak: number;
};

export function capacityBySet(groups: GroupCapacity[]): SetCapacity[] {
  const held = new Map<string, GroupCapacity[]>();
  for (const group of groups) held.set(group.set, [...(held.get(group.set) ?? []), group]);
  return [...held.entries()]
    .map(([code, own]) => {
      // Each group once, however many programme lines it is drawn as.
      const real = [...new Map(own.map((group) => [group.groupKey, group] as const)).values()];
      return {
        code,
        shared: own.some((group) => group.shared),
        groups: own,
        groupCount: real.length,
        // Seats only where a capacity is stated: adding zeroes would claim room there is
        // no word on.
        capacity: real.reduce((total, group) => total + group.groupCapacity, 0),
        enrolled: real.reduce((total, group) => total + group.groupEnrolled, 0),
        over: own.filter((group) => group.status === "Over").length,
        peak: Math.max(1, ...own.map((group) => Math.max(group.capacity, group.enrolled))),
      };
    })
    .sort((left, right) => Number(left.shared) - Number(right.shared) || left.code.localeCompare(right.code));
}

/** What the table shows, and what its filters and search may ask of a row. */
export function capacityColumns(): GridColumn<CapacityRow>[] {
  return [
    { id: "cohortName", displayName: "Cohort", type: "option", accessor: (row) => row.cohortName, defaultWidth: 150 },
    { id: "termName", displayName: "Semester", type: "option", accessor: (row) => row.termName, defaultWidth: 150 },
    { id: "set", displayName: "Set", type: "option", accessor: (row) => row.set, required: true, defaultWidth: 90 },
    { id: "group", displayName: "Group", type: "option", accessor: (row) => row.group, required: true, defaultWidth: 90 },
    { id: "courseCode", displayName: "Course", type: "option", accessor: (row) => row.courseCode, defaultWidth: 120 },
    { id: "courseTitle", displayName: "Title", type: "text", accessor: (row) => row.courseTitle, defaultWidth: 210 },
    { id: "component", displayName: "Type", type: "option", accessor: (row) => row.component, defaultWidth: 90 },
    { id: "ue", displayName: "UE", type: "option", accessor: (row) => row.ue, defaultWidth: 110 },
    { id: "crn", displayName: "CRN", type: "text", accessor: (row) => row.crn, defaultWidth: 90 },
    { id: "teacher", displayName: "Teacher", type: "option", accessor: (row) => row.teacher, defaultWidth: 190 },
    { id: "capacity", displayName: "Seats", type: "number", accessor: (row) => row.capacity, defaultWidth: 80 },
    { id: "enrolled", displayName: "Enrolled", type: "number", accessor: (row) => row.enrolled, defaultWidth: 90 },
    { id: "free", displayName: "Seats free", type: "number", accessor: (row) => row.free, defaultWidth: 100 },
    { id: "status", displayName: "Status", type: "option", accessor: (row) => row.status, defaultWidth: 130 },
    {
      id: "shared",
      displayName: "Shared",
      type: "option",
      accessor: (row) => (row.shared ? "Every cohort" : "This cohort"),
      defaultWidth: 120,
    },
  ];
}

/**
 * One room a line's classes meet in: what it seats, how many sessions are booked there,
 * and which classes those are, on which days — so a room that turns up once can be told
 * from the room the course lives in.
 */
export type RoomUse = {
  name: string;
  seats: number | null;
  sessions: number;
  classes: { course: string; dates: string[] }[];
};

/**
 * What a line is read against: the rooms its classes meet in, and our planned seats.
 *
 * The planned seats are ours — what the department decided a group should hold. The room
 * is the registrar's booking, and it is the one that runs out: a group planned for 14 in
 * a room of 16 has two chairs to spare, and one planned for 120 in a lecture hall of 154
 * has thirty-four. So the line is drawn against its room, and the plan is said beside it.
 *
 * Its room is the one most of its sessions are booked in, not the smallest it ever uses.
 * Twenty-one lines on production meet in more than one room, most of them for a session
 * or two: L1's CM has 51 sessions in Roberto Sorbonne and one in a room of 24, and read
 * against the smallest it was a group of 109 eighty-five over. The others are named with
 * their sessions, and those too small for the line are counted apart.
 */
export type RoomReading = {
  /** Every room, the most used first. */
  rooms: RoomUse[];
  /** The room the line is read against — the most used one whose seats are known — or null. */
  main: RoomUse | null;
  /** The main room's seats, or null when no room's seats are known. */
  seats: number | null;
  planned: number;
  enrolled: number;
  /** What the bar and "x / y" read against: the room when its seats are known, else the plan. */
  against: number;
  byRoom: boolean;
  status: CapacityStatus;
  free: number;
  /** Students beyond the main room's seats; nought when they fit or no room is known. */
  overRoom: number;
  /** Students beyond our planned seats, which the room may still hold. */
  overPlan: number;
  /** Rooms the line also meets in that seat fewer than it holds, and how many sessions that is. */
  tooSmall: RoomUse[];
  tooSmallSessions: number;
};

export function roomReading(
  crns: string[],
  roomsOf: (crn: string) => RoomUse[] | undefined,
  planned: number,
  enrolled: number,
): RoomReading {
  const held = new Map<string, RoomUse>();
  for (const crn of new Set(crns.filter(Boolean))) {
    for (const room of roomsOf(crn) ?? []) {
      const seen = held.get(room.name) ?? { ...room, sessions: 0, classes: [] };
      const classes = [...seen.classes];
      for (const use of room.classes) {
        const same = classes.findIndex((other) => other.course === use.course);
        if (same < 0) classes.push({ course: use.course, dates: [...use.dates] });
        else classes[same] = { course: use.course, dates: [...classes[same].dates, ...use.dates].sort() };
      }
      held.set(room.name, { ...seen, sessions: seen.sessions + room.sessions, classes });
    }
  }
  const rooms = [...held.values()].sort(
    (left, right) => right.sessions - left.sessions || left.name.localeCompare(right.name),
  );
  const main = rooms.find((room) => room.seats !== null) ?? null;
  const seats = main?.seats ?? null;
  const against = seats ?? planned;
  const tooSmall = rooms.filter((room) => room !== main && room.seats !== null && room.seats < enrolled);
  return {
    rooms,
    main,
    seats,
    planned,
    enrolled,
    against,
    byRoom: seats !== null,
    status: statusOf(against, enrolled),
    free: against ? against - enrolled : 0,
    overRoom: seats !== null ? Math.max(0, enrolled - seats) : 0,
    overPlan: planned ? Math.max(0, enrolled - planned) : 0,
    tooSmall,
    tooSmallSessions: tooSmall.reduce((total, room) => total + room.sessions, 0),
  };
}

/**
 * The classes a line is read against. A programme's line is read against its own course's
 * room — MATH-113's for the mathematicians — since the lectures it shares are everybody's
 * and are checked against everybody on their own chips; a whole group, against all of its
 * classes.
 */
export function lineCrns(group: GroupCapacity): string[] {
  const own = group.part ? group.sections.filter((section) => section.part === group.part) : group.sections;
  return (own.length ? own : group.sections).map((section) => section.crn);
}
