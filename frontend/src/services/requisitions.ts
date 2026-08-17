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
