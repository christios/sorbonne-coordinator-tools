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

Revised 5 September 2026 — Courses is a register of CRNs.

- **What the page is for:** a register of the department's CRNs for a term. One row per
  CRN: the course it belongs to, what it hangs from, and the course's UE. Every row is a
  link — to the portal's entry for the CRN, and to the portal's entry for its parent — so
  a link leading nowhere shows as one rather than reading as a number.
- **How a CRN gets in:** choosing a course on the portal's Courses page takes in every CRN
  the portal lists for it at that moment. The ones the registrar makes later are flagged,
  not taken in silently; a banner takes them in on request.
- **The register is two deep and no deeper.** A CRN the sections hang from is the top of
  its course and has no parent itself; nothing may hang from a section that already hangs
  from something; nothing hangs from itself. Refused by the server, not only by the
  picker, since the workbook's Parent CRN column is written from this.
- **Parent CRN is per CRN**, chosen from that course's own CRNs. The portal makes one row
  per course that the sections hang from — plain title, no teacher, nobody registered —
  and that CRN is the workbook's Parent CRN, so it is offered as the suggestion. It is
  also what names the course, instead of whichever section came first.
- **UE is per course**, edited from any of its CRN rows and changing all of them.
- **The banner**, as on Cohorts: CRNs we hold that the portal has stopped listing, CRNs the
  portal lists for our courses that nobody has taken in, and CRNs a course card teaches
  under that the register does not hold.
- **The timetable workbook** reads the Parent CRN of each section from the register, so a
  course whose sections hang from two parents can say so.
