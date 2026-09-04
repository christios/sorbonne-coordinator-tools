# Group assignment inside the platform

Confirmed intent, 4 September 2026.

- **Outcome:** Group assignment done inside the coordinator tools, so a fact is changed in
  one place and everything derived from it — the registrar template, the admissions list,
  what students see — follows.
- **User:** Christian this cycle; anyone with the platform next cycle. No scripts, no chat.
- **Why now:** Every change today means editing four workbooks by hand, and the platform
  that is meant to be the source of truth never saw the real assignments.
- **The fill:** Per block, on the Groups & CRNs page. Order students by ID, first name,
  last name or randomly; fill *balanced* or *packed to capacity*, chosen per block; a
  group may prefer a programme (Physics → G3) and take those students first. Preview
  first — who goes where, group sizes, clashes — and write nothing until confirmed,
  exactly like Update.
- **Clashes:** Computed from the Student Hub's session times, so the timetable is imported
  before filling; a fill never places a student in two overlapping groups, and the page
  flags existing ones.
- **Late arrivals:** Nobody already placed moves; the newcomer takes the least-full
  permitted group.
- **Files out:** The registrar template (already exported) and a new admissions flat list —
  one row per student, one CRN column per component, blank where a course does not apply.
- **Success:** Move one student in the platform; re-download both files and publish — all
  three agree, with nothing edited by hand.
- **Constraint:** Names and majors stay in the browser, so the fill runs there and sends
  only id → group to the server. No new personal data on the server.
- **Out of scope:** Placement-test banding and language-level rules (no ranking data yet);
  nested TP-in-TD groups; the student-facing handout (the Hub replaces it); a capacity or
  results *file* (group sizes against capacity already show on the page).
- **Build order:** clashes from the Hub's sessions → the fill with preview → the admissions
  export.

Where it came from: the "Student groups" sessions of August–September 2026, which ran the
FYS, L1 and Language cycles as scripts against OneDrive workbooks
(`13_placement-test-2026/_tool`, `14_l1-groups/_tool`, `14_lang-groups-26-27`).
