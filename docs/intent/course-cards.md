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
- **The page:** no cohort or semester dropdowns. One list of course cards across cohorts
  and semesters, with the search box and the filter chips the other pages have (semester,
  cohort, group set, teacher, type, retired) — not the table component: cards, collapsed
  to a line each, opened to show the sections and groups inside. The semester is chosen
  only when exporting, since the workbook is one semester.
- **Success:** open the semester, assign teachers and constraints on the cards, download
  the workbook, and it is the file that would have been sent — teacher hours right.
- **Constraint:** nothing about students changes shape; the cohort's placements and CRNs
  survive the move.
- **Out of scope:** the timetabler's side (rooms, slots, the actual timetable — the Hub
  import stays); structured constraint logic; MSc and Languages beyond what a card says.

Where it came from: the "Student groups" session's scripts (`13_placement-test-2026/_tool/
build_groups.py`, `14_l1-groups/_tool/build_l1.py`), whose rules define the group sets,
and the constraints workbook they read.

Revised 5 September 2026.

- **Active courses.** A course's title, UE and parent CRN belong to the department's own
  list of courses — chosen from the portal's Courses page (or added by hand) the way
  Active teachers are chosen from Teachers — and are edited there, not on the card. A
  card shows neither UE nor parent CRN; it says when its code is not on the active list.
- **Dropdowns, not typing:** a group set carries active courses only (a picker); a
  section's CRN is chosen from the portal's list for that course and semester when the
  semester is linked, typed only when it is not; the teacher from Active teachers.
- **Cards read cleanly.** Rows are read-only — group, CRN with its verdict, teacher,
  hours, sessions, duration, weeks, students, and what is asked of the timetable in one
  line — and a dialog edits a row. The Degree column of the workbook is the cohort's
  majors.

- **Two kinds of set, not three** (5 September 2026): a set is plain — its groups numbered
  across whatever courses it carries, one or many — or nested inside another. "Its own
  numbering" was a plain set with one course; nothing behaved differently, so it went.

5 September 2026 — sets the whole department shares, and a Capacity page.

- **A set may be open to every cohort.** Languages are one set of classes for everybody:
  A1-G1 holds first, second and third years at once, because the level of French decides
  the group and the degree does not. Twelve of the nineteen language groups of Semester 1
  hold more than one cohort, so copying the set per cohort would split one class into four
  with a quarter of the seats each. An open set takes any student the department holds and
  counts all of them; each is still filed under their own cohort, so every per-cohort view
  reads true. Every other set is unchanged and still turns outsiders away.
- **Capacity**, under Groups & CRNs: the Capacity sheet the workbooks carried, kept live.
  One row per section — CRN, group, seats, enrolled, seats free, status — with retired
  sections left out because nobody is in them. Seats are the group's capacity, falling
  back to the section's anticipated students. The totals count a group once however many
  courses its set carries, and count seats only where a capacity is stated.
