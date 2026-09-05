# Cohort discrepancies

Confirmed intent, 3 September 2026.

- **Outcome:** A Cohorts page in Students & Timetables that warns when admissions has
  changed something about a student *after* the department placed them in a cohort,
  plus a few current-state checks — so a discrepancy between the portal and the
  department's cohorts and groups surfaces instead of being found at timetable time.
- **Shape:** A cohort picker on top driving a student list, with warnings on the rows.
  A "Not in any cohort" entry in the picker carries the reverse check.
- **User:** Coordinators, after a sync. Everyone shares the same rules; warnings are
  computed from what the coordinator's own browser holds.
- **Rules:** One department-wide set, kept on the server: "warn when *field* changes —
  at all, or to one of these values", values from the portal's own list. Cohorts gain
  an optional program and year level, which the "differs from the cohort" rules read.
- **Baseline:** When the student was placed in the cohort.
- **State checks:** In a cohort but currently in a state the rules call trouble; not in
  any cohort but in no such state — whether never placed or removed earlier.
- **Lifecycle:** Live. A warning can be dismissed, which hides it until that student's
  record changes again. Freshness is as of the last sync, and the page says when.
- **Constraint:** The change history stays browser-only; the server is never told a
  name. The folder backup is the durable record.
- **Out of scope:** Warnings shared or synchronised between colleagues; the page pulling
  from the portal itself; rules per cohort beyond program and year; any automatic action.
- **Assumed:** Any coordinator may edit the rules; a dismissal is per browser, like the
  evidence it rests on.

Revised 5 September 2026.

- **What a cohort expects** is now said in the portal's codes: one or more majors
  (MAJOR_CODE), one or more portal terms (TERM_CODE), and a year level. The free-text
  programme is gone; "differs from the cohort's" compares major, term or year level
  against those lists, matching a code or the portal's label for it.
- **Values are read through the portal's code tables.** A rule names a code (DEPT_CODE
  is SCEN); a pull may carry only the description (DEPT_DESC "Science and Engineering").
  The engine reads whichever the row has and maps between them — this is why a rule on
  the department code was silent before. The extension (1.6.2) now also asks the portal
  for DEPT_CODE, MAJOR_CODE and PROGRAM_CODE; a rule no held pull can answer is named on
  the page rather than shown as nothing.
- **Status is a field a rule may name:** whether the last sync still found the student
  in the portal ("is" / "is not" only).
- **Arrivals:** a banner per cohort lists students whose major changed *into* one of the
  cohort's majors and who are not in it, from the pull history; the student's record
  says the same.
- **The picker** counts flagged students beside each cohort's members; rule values are
  chips rather than checkboxes.
