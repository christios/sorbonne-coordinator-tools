/**
 * A part-time teacher's requisition against our planning, both ways.
 *
 * The requisition is what the contract pays for: a list of courses with hours. The
 * planning is what the cards give them: sections with hours. The two are written by
 * different people at different times and drift — a course added to the timetable after
 * the contract was signed, a course paid for and then given to somebody else. Each of
 * those is a warning, in whichever direction it runs; a difference in hours on a course
 * both sides name is the third.
 *
 * Compared per course code, because that is the only name both sides share: the
 * requisition has no CRN and the planning has no contract line. Hours are summed per code
 * on each side first, since a course taught as two sections is one line on the contract.
 */

import type { CourseRow } from "@/services/requisitions";

export type RequisitionWarning = {
  kind: "unpaid" | "untaught" | "hours";
  courseCode: string;
  /** What the planning gives, and what the requisition pays for — zero where absent. */
  planned: number;
  contracted: number;
  text: string;
};

/** The course code a requisition line stands for, in the planning's spelling. */
export function requisitionCourseCode(course: Pick<CourseRow, "courseCode" | "subjectCode" | "courseNumber">): string {
  const typed = (course.courseCode ?? "").trim();
  const built = [course.subjectCode, course.courseNumber].map((part) => (part ?? "").trim()).filter(Boolean).join("-");
  return (typed || built).toUpperCase().replace(/\s+/g, "");
}

function hoursOf(text: string): number {
  const match = String(text ?? "").match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : 0;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

export function requisitionCheck(
  planned: { courseCode: string; hours: string; retired?: boolean }[],
  requisitions: { content: { courses: CourseRow[] } }[],
): RequisitionWarning[] {
  const ours = new Map<string, number>();
  for (const section of planned) {
    if (section.retired) continue;
    const code = section.courseCode.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) continue;
    ours.set(code, round((ours.get(code) ?? 0) + hoursOf(section.hours)));
  }
  const theirs = new Map<string, number>();
  for (const requisition of requisitions) {
    for (const course of requisition.content.courses) {
      const code = requisitionCourseCode(course);
      if (!code) continue;
      theirs.set(code, round((theirs.get(code) ?? 0) + hoursOf(course.hours)));
    }
  }
  const codes = [...new Set([...ours.keys(), ...theirs.keys()])].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true }),
  );
  const warnings: RequisitionWarning[] = [];
  for (const code of codes) {
    const plannedHours = ours.get(code) ?? 0;
    const contractedHours = theirs.get(code) ?? 0;
    if (!theirs.has(code)) {
      warnings.push({
        kind: "unpaid",
        courseCode: code,
        planned: plannedHours,
        contracted: 0,
        text: `The planning gives them ${code}${plannedHours ? ` (${plannedHours} h)` : ""}, which no requisition covers`,
      });
    } else if (!ours.has(code)) {
      warnings.push({
        kind: "untaught",
        courseCode: code,
        planned: 0,
        contracted: contractedHours,
        text: `The requisition pays for ${code}${contractedHours ? ` (${contractedHours} h)` : ""}, which the planning never gives them`,
      });
    } else if (plannedHours !== contractedHours) {
      warnings.push({
        kind: "hours",
        courseCode: code,
        planned: plannedHours,
        contracted: contractedHours,
        text: `${code}: the requisition pays for ${contractedHours} h, the planning gives ${plannedHours} h`,
      });
    }
  }
  return warnings;
}

/**
 * A semester's days, Week 1's Monday to the last day of its last week ("" both when its
 * Week 1 is not set), and its academic year ("2026-2027").
 */
export type SemesterDays = { id: string; academicYear: string; from: string; to: string };

/** "2026-2027" for the portal's 262710: the two years a term code's first four digits name. */
export function academicYearOfTerm(termCode: string): string {
  const digits = termCode.replace(/\D/g, "");
  return digits.length >= 4 ? `20${digits.slice(0, 2)}-20${digits.slice(2, 4)}` : "";
}

/**
 * Every semester's days, from the semester plans (Week 1 and how many weeks), and the
 * semester on screen by its year alone when it is not one of them.
 */
export function semesterDaysOf(
  plans: { semesterId: string; termCode: string; weekOne: string; weeks: number }[],
  shown?: { id: string; termCode: string } | null,
): SemesterDays[] {
  const known = plans.map((plan) => ({
    id: plan.semesterId,
    academicYear: academicYearOfTerm(plan.termCode),
    ...(daysOfSemester(plan.weekOne, plan.weeks) ?? { from: "", to: "" }),
  }));
  return shown && !known.some((entry) => entry.id === shown.id)
    ? [...known, { id: shown.id, academicYear: academicYearOfTerm(shown.termCode), from: "", to: "" }]
    : known;
}

/** Week 1's Monday to the Sunday ending its last week; nothing for a semester with no Week 1 set. */
export function daysOfSemester(weekOne: string, weeks: number): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekOne) || !(weeks > 0)) return null;
  const last = new Date(`${weekOne}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + weeks * 7 - 1);
  return { from: weekOne, to: last.toISOString().slice(0, 10) };
}

/**
 * The semesters a requisition pays into: those its contract dates overlap.
 *
 * A requisition names no semester — its title is free text — but it runs between two dates,
 * and a semester runs from its Week 1 for its weeks. Semester 1's requisitions run to 31
 * December, after its last class and before Semester 2's first, so each lands in the one
 * semester it is for; a requisition for the whole year lands in both, and is counted in both.
 *
 * Without dates on either side, or dated outside every semester, it goes by its academic
 * year, so a requisition is never lost from every semester for a missing date.
 */
export function semestersOfRequisition(
  requisition: { academicYear: string; contractFrom: string; contractTo: string },
  semesters: SemesterDays[],
): string[] {
  const { contractFrom: from, contractTo: to } = requisition;
  if (from && to) {
    const overlapping = semesters.filter((semester) => semester.from && from <= semester.to && to >= semester.from);
    if (overlapping.length) return overlapping.map((semester) => semester.id);
  }
  const year = requisition.academicYear.replace(/\s+/g, "");
  return semesters.filter((semester) => Boolean(year) && semester.academicYear === year).map((semester) => semester.id);
}

/**
 * One semester's side of the check: its requisitions, and the sections to hold them against.
 *
 * The sections are the semester's, and those of any other semester its requisitions run
 * into — a requisition for the whole year pays for Semester 2's courses too, and held
 * against Semester 1's alone it would read as paying for courses nobody gave them.
 *
 * Asked of a part-time teacher with a requisition in some semester, so a semester that has
 * none yet says its courses are unpaid rather than saying nothing.
 */
export function semesterContract<
  S extends { termId: string; courseCode: string; hours: string; retired?: boolean },
  R extends { academicYear: string; content: { contractFrom: string; contractTo: string; courses: CourseRow[] } },
>(
  sections: S[],
  requisitions: R[],
  semesters: SemesterDays[],
  semesterId: string,
): { requisitions: R[]; runsPast: R[]; warnings: RequisitionWarning[] } {
  const placed = requisitions.map((requisition) => ({
    requisition,
    into: semestersOfRequisition({ academicYear: requisition.academicYear, ...requisition.content }, semesters),
  }));
  const here = placed.filter((entry) => entry.into.includes(semesterId));
  const reach = new Set([semesterId, ...here.flatMap((entry) => entry.into)]);
  const planned = sections.filter((section) => reach.has(section.termId));
  return {
    requisitions: here.map((entry) => entry.requisition),
    runsPast: here.filter((entry) => entry.into.length > 1).map((entry) => entry.requisition),
    warnings: here.length || planned.some((section) => !section.retired) ? requisitionCheck(planned, here.map((entry) => entry.requisition)) : [],
  };
}
