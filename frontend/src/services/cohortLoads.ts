/**
 * Teacher hours cohort by cohort: the department's teaching-load sheet, drawn from the plan.
 *
 * The department kept this by hand — a workbook tab per cohort listing every course and
 * its sections, who teaches each and for how many hours, and under it how the cohort's
 * hours split between full-timers, part-timers, visiting professors and PhD students or
 * postdocs. That split is what the Head of Department and the budget ask about. It is
 * the same plan Teacher hours already reads, turned the other way: by course and section
 * rather than by teacher, and over the academic year rather than one semester.
 *
 * Read exactly as the timetable workbook's rows are (`requestSheets`): a section's own
 * answers over its course's, one line per part of a handover, retired groups left out,
 * and a class several sub-rows share counted once. So a teacher's hours here add up to
 * what the By teacher table says they are.
 */

import { cardSeats, rowsPerPart, subRowLabel, type Card } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import type { ActiveTeacher } from "@/services/portalLists";

export type StaffStatus = "FT" | "PHD" | "VP" | "PT";

/** The statuses, in the order the sheet lists them. */
export const STAFF_STATUSES: { status: StaffStatus; label: string; long: string }[] = [
  { status: "FT", label: "FT", long: "Full-time" },
  { status: "PHD", label: "PhD/Pdoc", long: "PhD student or postdoc" },
  { status: "VP", label: "VP", long: "Visiting professor" },
  { status: "PT", label: "PT", long: "Part-time" },
];

/** Where a section's hours go in the split: a status, a teacher nobody has given one, or nobody yet. */
export type Bucket = StaffStatus | "UNSET" | "NOBODY";
export const BUCKETS: Bucket[] = ["FT", "PHD", "VP", "PT", "UNSET", "NOBODY"];

export function bucketLabel(bucket: Bucket): string {
  if (bucket === "UNSET") return "No status yet";
  if (bucket === "NOBODY") return "Nobody yet";
  return STAFF_STATUSES.find((entry) => entry.status === bucket)?.label ?? bucket;
}

/**
 * What the portal's type reads as, when the department has not said.
 *
 * A local professional assignment is paid by the hour, as a part-timer is; a flying
 * professional assignment is somebody sent from Paris, as a visiting professor is. A
 * teacher only the part-time database knows is a part-timer.
 */
export function statusFromPortal(type: string, source = ""): StaffStatus | "" {
  const said = type.trim().toLowerCase();
  if (!said) return source === "part-time" ? "PT" : "";
  if (said.includes("visiting") || said.includes("flying")) return "VP";
  if (said.startsWith("full")) return "FT";
  if (said.includes("part") || said.includes("local")) return "PT";
  return "";
}

/** What a teacher is for the budget: the department's word where it has given one, the portal's otherwise. */
export function staffStatusOf(teacher: Pick<ActiveTeacher, "type"> & Partial<ActiveTeacher> | null | undefined): StaffStatus | "" {
  if (!teacher) return "";
  const said = (teacher.staffStatus ?? "").toUpperCase();
  if (STAFF_STATUSES.some((entry) => entry.status === said)) return said as StaffStatus;
  return statusFromPortal(teacher.type ?? "", teacher.source ?? "");
}

export type LoadKind = "CM" | "TD" | "TP" | "OTHER";
export const LOAD_KINDS: LoadKind[] = ["CM", "TD", "TP", "OTHER"];

/** One line of the sheet: a part of a section, its teacher, its hours. */
export type LoadSection = {
  key: string;
  termId: string;
  cohortId: string;
  /** The course card it is under: one per cohort, semester and course code. */
  cardKey: string;
  /** "TD 1", "CM 1 · Physics", with the part when a section is handed over. */
  label: string;
  crn: string;
  teacherId: string;
  /** Empty when nobody teaches it yet. */
  teacher: string;
  status: StaffStatus | "";
  kind: LoadKind;
  hours: number;
  /** Placed in the group, less any exempt from this course. */
  students: number;
};

export type LoadCourse = { card: Card; coefficient: string; sections: LoadSection[] };

/** Hours by bucket, for one semester or the year. */
export type Split = Record<Bucket, number>;

export type CohortLoad = {
  cohortId: string;
  cohortName: string;
  /** The year's semesters this cohort has courses in, in order, each with its courses. */
  semesters: { termId: string; courses: LoadCourse[] }[];
  /** By semester id, and "year". */
  split: Record<string, Split>;
  kinds: Record<LoadKind, number>;
  /** Who teaches how many of its hours over the year, most first. Nobody-yet is in the split, not here. */
  teachers: { teacherId: string; teacher: string; status: StaffStatus | ""; hours: number }[];
};

const emptySplit = (): Split => ({ FT: 0, PHD: 0, VP: 0, PT: 0, UNSET: 0, NOBODY: 0 });

export const bucketOf = (section: Pick<LoadSection, "teacher" | "status">): Bucket =>
  !section.teacher.trim() ? "NOBODY" : section.status || "UNSET";

export const splitTotal = (split: Split): number => BUCKETS.reduce((sum, bucket) => sum + split[bucket], 0);

function kindOf(component: string): LoadKind {
  const said = component.trim().toUpperCase();
  return said === "CM" || said === "TD" || said === "TP" ? said : "OTHER";
}

/** Every line of the given semesters' cards, in the order the cards and their sets come. */
export function loadSections(cards: Card[], termIds: string[], teachers: ActiveTeacher[]): LoadSection[] {
  const byId = new Map(teachers.map((teacher) => [teacher.id, teacher]));
  const byName = new Map(teachers.map((teacher) => [teacher.fullName.trim().toLowerCase(), teacher]));
  const lines: LoadSection[] = [];
  for (const card of cards) {
    if (!termIds.includes(card.termId)) continue;
    for (const set of card.sets) {
      for (const row of set.rows.flatMap((entry) => rowsPerPart(entry))) {
        // A shared cell is one class however many sub-rows show it: counted on the first.
        if (row.sharedCell && !row.firstSubRow) continue;
        const section = row.section ? filled(row.section, set.course.request) : null;
        if (!section || section.retired) continue;
        const record = (section.teacherId && byId.get(section.teacherId)) || byName.get(section.teacher.trim().toLowerCase());
        const teacher = (section.teacherId ? byId.get(section.teacherId)?.fullName : "") || section.teacher;
        const group = subRowLabel(row.group.label, row.major?.program ?? "", (row.group.majors ?? []).length);
        const part = (row.parts ?? 1) > 1 ? ` · part ${section.part}` : "";
        lines.push({
          key: `${card.key}|${set.scope.id}|${row.group.id}|${row.major?.id ?? ""}|${section.part}`,
          termId: card.termId,
          cohortId: card.cohortId,
          cardKey: card.key,
          label: `${set.scope.code} ${group}`.trim() + part,
          crn: section.crn.trim(),
          teacherId: record?.id ?? section.teacherId,
          teacher: teacher.trim(),
          status: staffStatusOf(record),
          kind: kindOf(row.course.component || row.scope.code),
          hours: Number(section.hours) || 0,
          students: Math.max(0, cardSeats(row).placed - (row.exempt ?? 0)),
        });
      }
    }
  }
  return lines;
}

/** One block per cohort with anything planned in these semesters, in the cards' order. */
export function cohortLoads(cards: Card[], termIds: string[], teachers: ActiveTeacher[]): CohortLoad[] {
  const lines = loadSections(cards, termIds, teachers);
  const cohorts = new Map<string, CohortLoad>();
  for (const card of cards) {
    if (!termIds.includes(card.termId)) continue;
    const sections = lines.filter((line) => line.cardKey === card.key);
    if (!sections.length) continue;
    const cohort =
      cohorts.get(card.cohortId) ??
      {
        cohortId: card.cohortId,
        cohortName: card.cohortName,
        semesters: [],
        split: {},
        kinds: { CM: 0, TD: 0, TP: 0, OTHER: 0 },
        teachers: [],
      };
    let semester = cohort.semesters.find((entry) => entry.termId === card.termId);
    if (!semester) {
      semester = { termId: card.termId, courses: [] };
      cohort.semesters.push(semester);
    }
    semester.courses.push({ card, coefficient: card.active?.coefficient ?? "", sections });
    cohorts.set(card.cohortId, cohort);
  }
  for (const cohort of cohorts.values()) {
    cohort.semesters.sort((left, right) => termIds.indexOf(left.termId) - termIds.indexOf(right.termId));
    const year = emptySplit();
    const byTeacher = new Map<string, CohortLoad["teachers"][number]>();
    for (const semester of cohort.semesters) {
      const split = emptySplit();
      for (const section of semester.courses.flatMap((course) => course.sections)) {
        split[bucketOf(section)] += section.hours;
        year[bucketOf(section)] += section.hours;
        cohort.kinds[section.kind] += section.hours;
        if (!section.teacher) continue;
        const key = section.teacherId || section.teacher.toLowerCase();
        const held = byTeacher.get(key) ?? { teacherId: section.teacherId, teacher: section.teacher, status: section.status, hours: 0 };
        held.hours += section.hours;
        byTeacher.set(key, held);
      }
      cohort.split[semester.termId] = split;
    }
    cohort.split.year = year;
    cohort.teachers = [...byTeacher.values()].sort((left, right) => right.hours - left.hours || left.teacher.localeCompare(right.teacher));
  }
  return [...cohorts.values()];
}

/** The department: every cohort's split added up, by semester and for the year. */
export function departmentSplit(cohorts: CohortLoad[], termIds: string[]): Record<string, Split> {
  const total: Record<string, Split> = Object.fromEntries([...termIds, "year"].map((id) => [id, emptySplit()]));
  for (const cohort of cohorts) {
    for (const [id, split] of Object.entries(cohort.split)) {
      for (const bucket of BUCKETS) total[id][bucket] += split[bucket];
    }
  }
  return total;
}

/** "16%" of a total, or "" when there is nothing to share. Whole percents, as the sheet reads. */
export function shareOf(hours: number, total: number): string {
  return total > 0 ? `${Math.round((hours / total) * 100)}%` : "";
}
