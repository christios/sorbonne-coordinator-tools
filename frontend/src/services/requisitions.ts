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
