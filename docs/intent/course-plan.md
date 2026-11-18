# Course plan — each course's hours, its lead, and its weeks

Confirmed intent, 18 November 2026.

- **Outcome:** the department keeps, for every course it teaches in a semester, its total CM,
  TD and TP hours and how they are laid out week by week. The course's lead lays the weeks out
  in the Timetable preferences request, and the Semester plan uses the layout when classes are
  placed.
- **Why now:** the hours live in free text on Groups & CRNs rows ("2 sessions — weeks 2 to 14")
  and in people's heads; the plan places series over all the weeks and nobody can tell whether
  a course gets what its lead planned.
- **Users:** coordinators set the totals and pick the leads; each lead answers once a semester;
  coordinators read the answers, and answer for a lead who sent theirs by email.

## Decisions the user confirmed (18 November 2026)

- **Totals locked.** Coordinators set a course's CM, TD and TP hours. The course lead only
  spreads them over the weeks; a lead who disagrees with a total says so in a note.
- **One course lead per course per semester,** picked by hand by coordinators, with NO
  suggestion — not even the CM teacher.
- **One plan per course per semester,** shared by every cohort that takes it.
- **The first release includes the Semester plan,** not just the form step. Linking the
  plan to the syllabus builder's course schedule is a later phase and is not built.

## What it is

1. **Hours of a course,** per semester, beside the course's other per-semester facts
   (coefficient, program): CM, TD and TP hours — TD and TP per group — and the usual length
   of one session of each. Coordinators edit them. Groups & CRNs course rows show the course's
   hours and say when a row differs; Teaching loads and requisitions keep reading the rows.
2. **Course lead,** per course per semester, set by coordinators beside the hours.
3. **Course schedule step** in the invited Timetable preferences request, only for a teacher
   who leads at least one course that semester (as Hour reductions is only for full-timers).
   One grid per course: rows CM / TD / TP, columns the teaching weeks (the semester's weeks
   with its breaks skipped, numbered as the Semester plan numbers them), each cell the number
   of sessions that week. Each row keeps a running total against its locked target
   ("24 of 24 h") and has a "Spread evenly" button; each course has a note. Coordinators see
   the answers on the Timetable preferences page and can fill them in for a lead.
4. **Semester plan:** the tray shows each class's course weeks for its component; placing a
   series proposes those weeks; the plan flags a series whose weeks or hours per week don't
   match the course plan. Nothing blocks a placement, as with preferences.

## Choices made while building (not asked; say so if wrong)

- **Where coordinators set hours and leads:** a new page, **Active courses** (under Courses,
  beside Active CRNs), one row per course active in the header semester with its program,
  coefficient, hours, lead and where the lead's answer stands. A row opens the course's plan:
  hours, lead, and the lead's weeks. The course's record shows the same summary with a button
  to it. Until now there was no one-row-per-course list: Active CRNs is per CRN.
- **Session length is required with hours.** A total can't be laid out in sessions without
  it, and the running total is sessions × length.
- **The step comes second:** Hour reductions (full-timers), then Course schedule (leads),
  then Preferences and constraints, which ends with Submit. Like Hour reductions, it can be
  skipped for now and is saved on its own ("Save and go on").
- **"Spread evenly"** turns the row's target into whole sessions (target ÷ length, rounded)
  and spreads them over every teaching week, the extra ones evenly apart.
- **What the plan compares:** the hours placed in each teaching week against sessions ×
  length for that week, and each class's length against the session length. A class a holiday
  takes away counts as not placed. Only a course whose lead (or a coordinator) has laid weeks
  out is compared week by week; the length is compared as soon as it is set.
- **What a Groups & CRNs row is compared on:** its hours and its session length (the two
  numbers); the free-text sessions and weeks are shown, not parsed.
- **Placing proposes** the weeks the course plan still has sessions for after this class's
  other series; without a layout, every week, as before. A class with no duration on Groups &
  CRNs takes the course plan's session length.

## Out of scope

- The syllabus builder's course schedule (session cards) — a later phase.
- Changing what Teaching loads, teacher hours or requisitions read.
- Blocking a placement, or rewriting Groups & CRNs rows from the course plan.
