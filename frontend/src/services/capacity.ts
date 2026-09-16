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
import { partsOf, sectionFor, type CohortCatalogue } from "@/services/studentDatabase";
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
  /** The seats the group has. Its capacity, or the section's anticipated students. */
  capacity: number;
  enrolled: number;
  /** Negative when the group is over its seats, which is the number worth seeing. */
  free: number;
  status: CapacityStatus;
};

export type CapacityStatus = "Over" | "Full" | "Room" | "Empty" | "No capacity set";

/** What the numbers say about one group, in the word a coordinator would use. */
export function statusOf(capacity: number, enrolled: number): CapacityStatus {
  if (!capacity) return "No capacity set";
  if (enrolled > capacity) return "Over";
  if (enrolled === capacity) return "Full";
  return enrolled === 0 ? "Empty" : "Room";
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
          (group.majors ?? []).length
            ? (group.majors ?? []).map((major) => ({
                group,
                label: subRowLabel(group.label, major.program, (group.majors ?? []).length),
                seats: major.seats,
                assigned: major.assigned,
                section: sectionFor(group, major.id, course.id),
                keyPart: major.id,
              }))
            : [{ group, label: group.label, seats: group.capacity, assigned: group.assigned, section: group.crns[course.id] ?? null, keyPart: "" }],
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
            // The seats; a group that never had a capacity falls back to what the
            // timetable was told to expect for this section.
            const capacity = seat.seats || Number(section.anticipated) || 0;
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
  const seen = new Map<string, CapacityRow>();
  for (const row of rows) {
    const key = `${row.cohortId}|${row.set}|${row.group}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  const groups = [...seen.values()];
  const seated = groups.filter((row) => row.capacity);
  return {
    groups: groups.length,
    capacity: seated.reduce((total, row) => total + row.capacity, 0),
    seated: seated.length,
    placements: groups.reduce((total, row) => total + row.enrolled, 0),
    over: groups.filter((row) => row.status === "Over").length,
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
};

/**
 * One row per group — and for a set everybody shares, one row per CLASS.
 *
 * A shared set is carried by every cohort that teaches it: each holds its own record of
 * "A0-F5", and all of them name the same CRN, because there is one French class at that
 * hour and the whole point of a shared set is that four years sit in it together. Keyed by
 * the cohort, that read as four groups of thirty — and the languages came to 2184 seats
 * where the university has 546.
 *
 * So a shared group is identified by its set and its label, which is what the department
 * means by a class, and the copies are folded:
 *
 * - **the enrolments add up**, once per cohort, because each copy holds that cohort's own
 *   students and the class holds all of them;
 * - **the seats do not**, because they are the same thirty chairs counted four times;
 * - **the sections are named once**, since four copies of one CRN is one CRN.
 *
 * A cohort's own group is untouched: it is identified by its cohort, as it always was.
 */
export function capacityByGroup(rows: CapacityRow[]): GroupCapacity[] {
  const held = new Map<string, GroupCapacity>();
  // Which cohorts have already added their students to a shared class, so that its three
  // sections do not add the same cohort's twenty students three times over.
  const counted = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = row.shared ? `${row.set}|${row.group}` : `${row.cohortId}|${row.set}|${row.group}`;
    const seen = held.get(key);
    if (seen) {
      // Four copies of one CRN is one CRN; a genuine second section of the group is not.
      if (!seen.sections.some((section) => section.crn === row.crn && section.courseCode === row.courseCode)) {
        seen.sections.push(row);
      }
      if (row.shared && !counted.get(key)?.has(row.cohortId)) {
        counted.get(key)?.add(row.cohortId);
        if (!seen.cohortNames.includes(row.cohortName)) seen.cohortNames.push(row.cohortName);
        seen.enrolled += row.enrolled;
        seen.free = seen.capacity ? seen.capacity - seen.enrolled : 0;
        seen.status = statusOf(seen.capacity, seen.enrolled);
      }
      continue;
    }
    counted.set(key, new Set([row.cohortId]));
    held.set(key, {
      key,
      cohortId: row.cohortId,
      cohortName: row.cohortName,
      cohortNames: [row.cohortName],
      termName: row.termName,
      set: row.set,
      shared: row.shared,
      group: row.group,
      capacity: row.capacity,
      enrolled: row.enrolled,
      free: row.free,
      status: row.status,
      sections: [row],
    });
  }
  return [...held.values()].sort(
    (left, right) => left.set.localeCompare(right.set) || left.group.localeCompare(right.group, undefined, { numeric: true }),
  );
}

/** The groups of one set, and how the set stands as a whole. */
export type SetCapacity = {
  code: string;
  shared: boolean;
  groups: GroupCapacity[];
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
    .map(([code, own]) => ({
      code,
      shared: own.some((group) => group.shared),
      groups: own,
      // Seats only where a capacity is stated: adding zeroes would claim room there is
      // no word on.
      capacity: own.reduce((total, group) => total + group.capacity, 0),
      enrolled: own.reduce((total, group) => total + group.enrolled, 0),
      over: own.filter((group) => group.status === "Over").length,
      peak: Math.max(1, ...own.map((group) => Math.max(group.capacity, group.enrolled))),
    }))
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
