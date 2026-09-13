# Cohort rules, warnings, approvals and automatic placement

Confirmed intent, 13 September 2026. Project 2 of three, after `groups-with-majors.md`.

- **What a cohort should take is derived, not typed:** the courses in its sets, per
  major sub-row. On top, each cohort keeps a short list of what is always allowed
  outside our groups (sport, a language taught elsewhere).
- **Warnings for registrations outside our groups,** per student. Anything registered
  that is neither in the student's groups nor on the cohort's allowed list warns. The
  student's profile lets a coordinator mark that elective **approved**, and the warning
  goes away. Students may hold several electives; approval is per student.
- **Emile (A00028109):** Spanish registrations while placed in a French group warn on
  him until approved. Today they never enter the check, because the check only judges
  courses that exist in one of our sets.
- **Automatic placement:** when a student appears in a cohort with no groups, or a set
  gains a course, the platform proposes clash-free placements across every set, seats
  per sub-row respected, and lists them as proposals. The coordinator confirms the
  batch, changes a few, or rejects. Not fully automatic, and not following the
  registrar's registrations as the source of placement.
- **Requisitions against planning,** per teacher, both ways: warn when the planning
  gives them a course or hours the requisition does not cover, and when the requisition
  pays for a course or hours the planning never gives them.
- **Teacher checks** are about the CRNs a teacher is assigned. Beside them, a view of
  hours on the portal's timetable against hours in our planning, per teacher, with
  **no warning attached**: mid-semester changes and cover are normal.
- **History on the server** for students in our cohorts: every cohort move, every group
  placement and removal, and every change in registered courses, with the coordinator
  and the date, shown in the student's History card next to the portal changes.
- **Success:** Emile's Spanish shows as a warning and disappears once approved; a new
  L1 student is placed in one confirmation.
- **Constraint:** names still never reach the server; history and approvals are keyed
  on student id.
- **Out of scope:** hand-written course lists per cohort; warnings on teacher hours.

## Built 13 September 2026

- **Allowed outside the groups:** the cohort card's pencil has a field "Always allowed
  outside the groups" — course codes or whole subjects. Stored on the cohort.
- **Outside verdict:** the register now judges every registered course, not only the
  courses of our sets. A course in no set, not on the cohort's list and not approved for
  the student is an *outside* verdict, shown as a Register warning on the Cohorts table
  and in the student's CRNs card. It is left out of the registrar's worklist on purpose:
  the remedy is a decision, not a registration to key in.
- **Approvals:** the verdict carries an *Approve* button on the student's record. The
  approval is stored on the server per student, portal term and course, signed and dated;
  the record lists them under "Approved outside the groups" with a withdraw cross.
  Emile's Spanish (SPAN-601) warns until approved, and the warning goes when it is.
- **History on the server:** every cohort move (and the groups it cost), every placement,
  move between groups and removal — from the record, the roster, the fill, the walk and
  the workbook upload — every approval and withdrawal, and every registration that
  appears or disappears between two pulls (students in our cohorts only; a student's
  first pull is a baseline, not a change). Each line is signed by the coordinator, or
  marked as the registrar's pull. The History card reads them beside the browser's
  pull history, newest first.
- **Proposed placements:** the Cohorts page shows, under the arrivals banner, everyone
  the semester's readiness names as missing from a set, with a clash-free group proposed
  in each set — seats per sub-row respected, own sub-row first — as one table with a
  tick per student and a "Place" button behind a confirmation. Nowhere-to-put-them
  cases are listed for a person. Languages are never proposed. Says nothing when
  everyone is placed.
- **Requisition against planning:** a part-time teacher's record compares the contract's
  courses and hours with the cards' both ways — a course the planning gives that no
  requisition covers, a course paid for that the planning never gives, hours that
  differ — as warnings under the hours tiles. The tiles themselves stay a comparison
  with no warning, as decided.
- **Teacher checks** were already about assigned CRNs (the Active courses register);
  nothing changed there.

Not done: the Active teachers table does not carry a requisition-warning column (it
would need every requisition read on the page); the comparison lives on the record.
Prod needs the allowed list set on each cohort (SPRT at least) before the outside
verdicts are useful there.
