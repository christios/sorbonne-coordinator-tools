export type CourseRow = {
  id: string;
  /** Catalogue metadata is a snapshot aid only; requisitions retain their own course values. */
  catalogCourseId?: string;
  crn?: string;
  courseCode?: string;
  subjectCode: string;
  courseNumber: string;
  level: string;
  title: string;
  hours: string;
};

export type RequisitionContent = {
  department: string;
  program: string;
  jobTitle: string;
  classType: string;
  employeeType: "FT" | "PT";
  contractFrom: string;
  contractTo: string;
  courses: CourseRow[];
};

/** Sums the numeric portion of each course load without discarding decimal hours. */
export function totalTeachingHours(courses: CourseRow[]): number {
  const total = courses.reduce((sum, course) => {
    const match = course.hours.match(/\d+(?:[.,]\d+)?/);
    return sum + (match ? Number(match[0].replace(",", ".")) : 0);
  }, 0);
  return Math.round((total + Number.EPSILON) * 1_000) / 1_000;
}

export function formatTeachingHours(hours: number): string {
  return String(hours);
}

export function missingRequisitionFields(requisition: { label: string; academicYear: string; content: RequisitionContent }): string[] {
  const missing: string[] = [];
  if (!requisition.label.trim()) missing.push("Requisition title");
  if (!requisition.academicYear.trim()) missing.push("Academic year");
  if (!requisition.content.department.trim()) missing.push("Hiring department");
  if (!requisition.content.program.trim()) missing.push("Programme");
  if (!requisition.content.jobTitle.trim()) missing.push("Job title");
  if (!requisition.content.classType.trim()) missing.push("Type of class");
  if (!requisition.content.contractFrom) missing.push("Contract from");
  if (!requisition.content.contractTo) missing.push("Contract to");
  if (!requisition.content.courses.length) missing.push("At least one course");
  requisition.content.courses.forEach((course, index) => {
    const prefix = `Course ${index + 1}`;
    if (!course.title.trim()) missing.push(`${prefix} title`);
    if (!course.subjectCode.trim()) missing.push(`${prefix} subject code`);
    if (!course.courseNumber.trim()) missing.push(`${prefix} number`);
    if (!course.level.trim()) missing.push(`${prefix} level`);
    if (!course.hours.trim()) missing.push(`${prefix} hours`);
  });
  return missing;
}

type RequisitionCompletionInput = { label: string; academicYear: string; content: RequisitionContent };

/** Identifies the furthest incomplete part of the guided requisition workflow. */
export function lastIncompleteRequisitionStep(requisition: RequisitionCompletionInput): { section: "details" | "courses"; focusTarget: string } | null {
  const { content } = requisition;
  const incompleteCourse = content.courses.find((course) => !course.title.trim() || !course.subjectCode.trim() || !course.courseNumber.trim() || !course.level.trim() || !course.hours.trim());
  if (!content.courses.length) return { section: "courses", focusTarget: "add-course" };
  if (incompleteCourse) {
    const field = !incompleteCourse.title.trim() ? "title" : !incompleteCourse.subjectCode.trim() ? "subject-code" : !incompleteCourse.courseNumber.trim() ? "course-number" : !incompleteCourse.level.trim() ? "level" : "hours";
    return { section: "courses", focusTarget: `course:${incompleteCourse.id}:${field}` };
  }
  if (!requisition.label.trim()) return { section: "details", focusTarget: "requisition-title" };
  if (!requisition.academicYear.trim()) return { section: "details", focusTarget: "academic-year" };
  if (!content.department.trim()) return { section: "details", focusTarget: "department" };
  if (!content.program.trim()) return { section: "details", focusTarget: "program" };
  if (!content.jobTitle.trim()) return { section: "details", focusTarget: "job-title" };
  if (!content.classType.trim()) return { section: "details", focusTarget: "class-type" };
  if (!content.contractFrom) return { section: "details", focusTarget: "contract-from" };
  if (!content.contractTo) return { section: "details", focusTarget: "contract-to" };
  return null;
}
