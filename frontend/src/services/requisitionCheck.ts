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
