# Groups that know majors

Confirmed intent, 13 September 2026. Project 1 of three; built after the quick wins
(`quick-wins-september.md`) and before the rules (`cohort-rules-and-approvals.md`).

- **Outcome:** A group stays one thing a student is placed in once. Under it, per-major
  **sub-rows** carry how many seats that major has and, per course of the set, either a
  CRN or "not taught". A mutualized lecture is one CRN spanning both sub-rows, entered
  once; a course only one major takes has a CRN on that major's sub-row and nothing on
  the other.
- **Replaces:** the programme tag on groups and the programme tag on a set's courses.
  "Not taught" on a sub-row says what the course tag said; the sub-rows a group has say
  what the group tag said. A group with no sub-rows is exactly today's group, so sets
  without majors do not change.
- **Closed groups:** a group with no sub-row for a student's major is closed to that
  student. That is how the fill knows a physicist has no place in PHIL-TD.
- **Seats are soft between sub-rows, but only where their CRNs are identical.** In
  MTP 3A (Physics 15, Mathematics 2, one CRN) a mathematician may take a spare Physics
  seat. In CM, where the sub-rows differ on MATH-113 and PHYS-118, overflow is blocked:
  the student would otherwise follow the seat's sub-row into the wrong lecture. A
  coordinator may still override by hand, with a warning.
- **The seat decides the CRNs.** A placement records group and sub-row; the sub-row
  defaults to the student's programme from the portal.
- **Readers that change:** the Capacity page and the cards count per sub-row; the
  roster's group column, the export to the timetabler and the registration check read
  per sub-row where CRNs differ and once where they do not.
- **L1 moves over when this lands,** from the snapshots in iCloud `14_l1-groups`: CM
  becomes one group with two sub-rows, MTP gets per-major seats, OPT-TP folds into MTP
  as a Physics sub-row, PHIL-TD and OPT-TD keep one sub-row each. The five TP students
  and the undated Optics sections wait for the same moment.
- **Success:** L1 rebuilt with no empty duplicate group anywhere, and the capacity page
  answering per major.
- **Constraint:** existing cohorts keep working untouched throughout; the change ships
  behind a migration that turns today's tags into sub-rows.
- **Out of scope:** two placements per student; a cap on one course inside a group
  (e.g. a smaller lab room) — asked and declined, seats per sub-row are enough.
