/*
 * The portal grids this extension may read, and what each one may say.
 *
 * Students was the only one for a year. Courses, teachers and a student's registrations
 * are the same Serenity `ListRequest` behind three other pages of the portal, so they
 * are read the same way — and bounded the same way: which rows may be asked for is a
 * filter checked against the grid's own fields, and which columns may come back is a
 * list, never "everything the service returns". A teacher's personal e-mail and Oracle
 * id are in the service's answer; they are not in this list, so they never leave.
 *
 * Field values marked verified were read from the portal's own filter widgets on
 * 5 September 2026. The rest are shape-checked only (a code, not a sentence).
 */

export const GRIDS = {
  students: {
    path: 'StudentSearch/Enrollment/List',
    /* The Student Search page, for the sign-in prompt. */
    page: 'StudentSearch/Enrollment',
    sort: ['FULL_NAME'],
    term: true,
    idField: 'SPRIDEN_ID',
  },
  courses: {
    path: 'Courses/CoursesSearch/List',
    page: 'Courses/CoursesSearch',
    sort: ['COURSE_CODE', 'COURSE_CRN'],
    term: true,
    idField: 'COURSE_CRN',
    fields: [
      { key: 'DEPT_CODE', label: 'Department', options: [], verified: false },
      { key: 'LEVEL_CODE', label: 'Level', options: [], verified: false },
      { key: 'COLLEGE_CODE', label: 'College', options: [], verified: false },
      { key: 'PTERM_CODE', label: 'Part of term', options: [], verified: false },
      { key: 'COURSE_CODE', label: 'Course code', options: [], verified: false },
    ],
    columns: [
      'TERM_CODE', 'COURSE_CRN', 'COURSE_CODE', 'COURSE_TITLE', 'COURSE_SUBJ', 'SEQ_NUMB',
      'PTERM_CODE', 'PTERM_DESC', 'CREDIT_HRS_NUM', 'DEPT_CODE', 'LEVEL_CODE', 'COLLEGE_CODE',
      'CONTACT_HRS_NUM', 'TEACHER_NAME', 'NUM_REG_STUD', 'BEGIN_DATE', 'END_DATE', 'GRADE_MODE',
    ],
  },
  teachers: {
    path: 'StaffSearch/List',
    page: 'StaffSearch',
    sort: ['FULL_NAME'],
    term: false,
    idField: 'SPRIDEN_ID',
    fields: [
      {
        key: 'TEACHER_STATUS',
        label: 'Status',
        options: [{ value: 'AC', label: 'Active' }],
        verified: false,
      },
      {
        key: 'TEACHER_TYPE_DESC',
        label: 'Type',
        options: [
          { value: 'Full Time', label: 'Full time' },
          { value: 'Part-Time', label: 'Part-time' },
          { value: 'Flying-Professional Assignment', label: 'Flying professional' },
          { value: 'Local-Professional Assignment', label: 'Local professional' },
          { value: 'VP Visiting Professor', label: 'Visiting professor' },
        ],
        verified: false,
      },
      { key: 'LAST_TERM_CODE', label: 'Last term taught', options: [], verified: false },
    ],
    columns: [
      'SPRIDEN_ID', 'FULL_NAME', 'TEACHER_STATUS', 'TEACHER_CAT_DESC', 'TEACHER_TYPE_DESC',
      'LAST_TERM_CODE', 'TOTAL_CREDITS', 'TEACHING_COURSES_COUNT', 'TEACHING_PERIODS_COUNT',
      'TEACHING_STUDENT_COUNT', 'TEACHING_DEPT', 'TEACHER_RANK', 'TEACHING_COURSES',
      'ACADEMIC_INSTITUTION', 'PSUAD_EMAIL',
    ],
  },
  registrations: {
    path: 'StudentSearch/StudentCourses/List',
    page: 'StudentSearch/StudentCourses',
    sort: ['SPRIDEN_ID', 'COURSE_CRN'],
    term: true,
    idField: 'SPRIDEN_ID',
    fields: [
      { key: 'DEPT_CODE', label: 'Department', options: [], verified: false },
      { key: 'MAJOR_CODE', label: 'Major', options: [], verified: false },
      { key: 'COLLEGE_CODE', label: 'College', options: [], verified: false },
      { key: 'LEVEL_CODE', label: 'Level', options: [], verified: false },
      { key: 'YEARLEVEL_CODE', label: 'Year', options: [], verified: false },
    ],
    /* Attendance is out of scope, so ABSENCE_PER and JUSTIFY_ATTENDANCE_IND stay behind. */
    columns: [
      'TERM_CODE', 'SPRIDEN_ID', 'FULL_NAME', 'DEPT_CODE', 'MAJOR_CODE', 'COLLEGE_CODE',
      'LEVEL_CODE', 'YEARLEVEL_CODE', 'COURSE_CRN', 'COURSE_CODE', 'COURSE_TITLE', 'TEACHER_NAME',
    ],
  },
};

export const KINDS = Object.keys(GRIDS);

export function gridOf(kind) {
  return GRIDS[kind] || null;
}

/**
 * A grid's filter fields, with values borrowed from the student grid where the field is
 * the same code table: DEPT_CODE is DEPT_CODE whichever page asks. The student grid is
 * the one the portal probe harvests, so its lists are the live ones.
 */
export function fieldsFor(kind, studentFields) {
  const grid = gridOf(kind);
  if (!grid || !grid.fields) return studentFields || [];
  const known = new Map((studentFields || []).map(field => [field.key, field]));
  return grid.fields.map(field => {
    const shared = known.get(field.key);
    return shared && (shared.options || []).length
      ? { ...field, options: shared.options, verified: Boolean(shared.verified) }
      : field;
  });
}
