# Courses, teachers and registrations inside the platform

Confirmed intent, 5 September 2026.

- **Outcome:** Three more portal lists living in the platform the way Students does —
  Courses (the term's CRNs), Teachers (portal staff), and each student's registrations —
  so registrations can be checked against our groups, a student's courses are one click
  away, and who teaches which CRN is known without opening the portal.
- **User:** Christian now; the department's coordinators next cycle.
- **Why now:** Admissions registers from the list we export and nobody can see whether it
  landed; teachers and CRNs are kept by hand in files the platform does not read.
- **Where it comes from:** The portal's *Courses Search* grid (one row per CRN and term:
  code, title, sequence, part of term, credits, department, level, college, contact hours,
  teacher name, number registered), the *Teachers* grid (Staff Search: id, name, status,
  category, type, last term, teaching department, courses taught, rank, institution, PSUAD
  email), and *Student Courses* (one row per student × CRN, with course, title, teacher).
  Each is a portal filter in the SCEN Rosters extension, chosen and pulled like Students —
  the coordinator's filters (department, term, type), not a fixed "SCEN only".
- **Where it lives:** Courses and Teachers are shared, server-side: a teacher's name and
  PSUAD email already appear on the timetable. Personal email, Oracle ID and the like are
  never copied. Registrations follow the Students line: ids and CRNs on the server, names
  in the browser.
- **What reads it:** Groups & CRNs cells and Semester timetables check their CRNs against
  Courses. A teacher can be matched to a record in the part-time teacher database and
  brought across; the two lists stay separate apps.
- **Student record modal:** a button in the Students toolbar beside Copy and History opens
  a large modal for the selected student: portal fields, cohort and placement date, groups
  per semester, their portal registrations (CRN, course, teacher) side by side with the
  CRNs our groups say they should hold, mismatches flagged, warnings, history of changes.
  This is where "which courses is this student enrolled in" is answered.
- **Success:** After admissions registers, Cohorts shows "registered in 23224, group says
  23223" / "missing 22151" / "extra 24005" as dismissable warning pills, and the student
  modal shows the same side by side.
- **Constraint:** No new personal data on the server beyond what a timetable already
  shows; a pull stays one click in the extension.
- **Out of scope:** Schedule & Registration (the registrar's next-term planning grid with
  Add/Edit), attendance percentages, editing anything in the portal, replacing the
  part-time teacher app, the Teachers menu's personal contact fields.

Portal facts behind this (read 5 September 2026): Courses Search posts to
`Services/Courses/CoursesSearch/List` (1,691 rows for 262710, `EqualityFilter` on
`DEPT_CODE`, `LEVEL_CODE`, `COLLEGE_CODE`, `PTERM_CODE`, `TERM_CODE`); Teachers to
`Services/StaffSearch/List` (1,477 rows, filters `TEACHER_STATUS`, `TEACHER_TYPE_DESC`,
`LAST_TERM_CODE`); Student Courses to `Services/StudentSearch/StudentCourses/List`
(26,467 rows for the term, filters `DEPT_CODE`, `MAJOR_CODE`, `LEVEL_CODE`,
`YEARLEVEL_CODE`, `TERM_CODE`, `COLLEGE_CODE`). All three are the same Serenity
`ListRequest` shape the extension already speaks for Students.
