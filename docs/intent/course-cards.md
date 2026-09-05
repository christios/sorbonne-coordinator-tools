# Groups & CRNs as course cards — the timetable request, in the platform

Confirmed intent, 5 September 2026.

- **Outcome:** Groups & CRNs becomes the department's timetable request, per cohort and
  semester: a card per course, listing its sections — CM, TD, TP groups — each with CRN,
  parent CRN, group set and label, teacher, hours, sessions per week, duration, weeks,
  anticipated students, day/time/room preference, parallel constraint and comments.
  Downloading the workbook the timetabler gets (`Time-Tables-26-27.xlsx`: a sheet per
  cohort and semester, the CRN table, teacher hours) replaces editing it by hand.
- **User:** Christian this cycle; the department's coordinators next.
- **Why now:** the request lives in a spreadsheet nobody else can check, and its groups
  are re-typed into the platform for placement.
- **One model — group sets:** a section belongs to a group set. A set spans the courses
  whose sections share its numbering (FYS: the TD group G1–G6 across MATH 001/009/011,
  the CM group G1–G2; L1: G1/G2/G3 across Mathematics, Computer Science, Mechanics TD,
  IWW TD), or is its own (Readiness, Philosophy TD, Geometric Optics, Languages), or
  nests inside another (Mechanics TP G.nA/G.nB within TD G.n, split by the two TP
  capacities). A student is placed in a set's group once; every section of that group,
  in every course, follows. Placements, the fill, clashes, publishing and the admissions
  list read the group sets. Nested sets are new; the rest is today's blocks, seen from
  the course rather than as a matrix. The matrix, its cells and its add-rows go.
- **Where it comes from:** a card's course and sections are picked from the term's portal
  Courses list — title, CRN, parent CRN, portal teacher and registered count fill
  themselves; a section is typed by hand only when the portal has none yet. A retired
  section is marked, not deleted; it is skipped by the fill and the export says so.
  Teacher is chosen from Active teachers, with the portal's name beside it as a check.
  Facts are fields (hours, sessions per week, duration, weeks, anticipated students);
  wishes are text (room, day, time preference, parallel / not in parallel, comments).
- **Success:** open the semester, assign teachers and constraints on the cards, download
  the workbook, and it is the file that would have been sent — teacher hours right.
- **Constraint:** nothing about students changes shape; the cohort's placements and CRNs
  survive the move.
- **Out of scope:** the timetabler's side (rooms, slots, the actual timetable — the Hub
  import stays); structured constraint logic; MSc and Languages beyond what a card says.

Where it came from: the "Student groups" session's scripts (`13_placement-test-2026/_tool/
build_groups.py`, `14_l1-groups/_tool/build_l1.py`), whose rules define the group sets,
and the constraints workbook they read.
