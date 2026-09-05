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

import type { CohortCatalogue } from "@/services/studentDatabase";
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
        for (const group of scope.groups) {
          const section = group.crns[course.id];
          if (!section || section.retired) continue;
          // The group's seats; a group that never had a capacity falls back to what the
          // timetable was told to expect for this section.
          const capacity = group.capacity || Number(section.anticipated) || 0;
          const enrolled = group.assigned;
          rows.push({
            key: `${held.cohort.id}|${scope.id}|${group.id}|${course.id}`,
            cohortId: held.cohort.id,
            cohortName: held.cohort.name,
            termId,
            termName: termName(termId),
            set: scope.code,
            shared: scope.openToAll,
            group: group.label,
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
  enrolled: number;
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
    enrolled: groups.reduce((total, row) => total + row.enrolled, 0),
    over: groups.filter((row) => row.status === "Over").length,
    withoutCapacity: groups.length - seated.length,
  };
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
