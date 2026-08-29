# Timetables

Timetabling is run by **Serco** (contact: **Sonali**), using scheduling software
(Evenmaps / Optim solutions) that integrates with Banner. You supply the courses,
teachers, and constraints; Serco drafts; you verify and approve.

## The working relationship

- **Serco sends draft timetables** for you to approve.
- Increasingly, collaboration happens through **comments in the shared SharePoint
  workbook** (rather than emailing a fresh copy each time) — get Sonali access to
  the online workbook so changes are tracked in place.
- Teaching **assignments and constraints** live in the **Teach Loads** workbook
  (SCEN dept), maintained with the HoD.

## What to check on a draft TT

When Serco sends a draft, verify:

- [ ] **Total hours match** for each CRN.
      - If a CRN has *more* hours than needed, that's fine — you can remove them
        later during the semester.
- [ ] **Every course** in your Excel exists in the TT.
- [ ] **Every teacher** exists / is placed.
- [ ] **Constraints & preferences** you set were respected.

## Constraints come from several places

- **Programme heads** (e.g. Dr Lama for FYS) provide maquette-driven structure and
  session spreading (e.g. spreading FYS sessions across Fridays, avoiding clashes
  of large groups).
- **Room capacity** is a hard constraint — there are limited 100-seat rooms, so
  FYS CM classes may need to be split across timeslots and TD/Remedial scheduled to
  limit large-room demand.
- **Course-specific** preferences (e.g. which weekday(s) a part-time teacher comes
  in, sequencing of CM/TD before a lab).

Communicate specific changes by pointing to **rows/cells** in named sheets (e.g.
"check rows 25–32 in `BSc-L1-S1`") or via **workbook comments / assigned tasks**.

## Integration with Banner

- **Banner → TT:** CRN and course-code information flows into the timetable.
- **TT → Banner:** scheduling changes reflect back for everyone.

## New programmes

New Master's programmes (MIAI from Sept 2026; Maths–Statistics/AI from Sept 2027)
need their timetables set up for the Finance department's planning, per the
confirmed opening dates:

- **MIAI:** Jan–Jun 2027 = M1-S2; Sep–Dec 2027 = M1-S1 **and** M2-S1.
- **Maths (Stats/AI):** Sep–Dec 2027 = M1-S1.

## Publishing a change to students

Students read the timetable from the SCEN Student Hub, so a change agreed with
the timetabling office is not visible to them until it is uploaded. In **Coordinator
Tools → Students and Timetables → Semesters**, a semester carries an **Update
timetable** action:

1. Upload the registrar's latest activity-list export.
2. The screen compares it against what students currently see and lists only what
   differs — rooms moved, sessions retimed, classes cancelled, make-ups added, plus
   any change to a course's lecturer, title or group.
3. **Nothing is applied until you tick it.** Anything left unticked keeps the value
   students see today, and is offered again the next time you upload.
4. Apply. Students with the page open are offered a refresh.

Points worth knowing:

- The export has no row identifier, so "the same session, moved" is worked out by
  comparison. Where that is an inference rather than a certainty the row says so —
  check those before approving them.
- A course missing from the export is flagged in red with the number of students who
  would lose it, because approving that removal also removes their enrolments. It is
  never pre-ticked.
- A course new to the export starts with nobody enrolled. Attach the filled group
  templates in the same step if students should be on it straight away.
- This is the mid-semester path. The term-start load is **Import a semester**, the button
  at the top of the same page, which replaces the whole semester rather than reviewing it.

## Practical friction to expect

- Teachers don't always **inform** when they'll be away (conferences), which forces
  cancel-and-reschedule to keep hours correct — and at Sorbonne cancelling a class
  is **mandatory**, so a substitute slot must be found in another week.
- Professors sometimes don't properly review the **first draft** and raise issues
  late. Push for early review.

See [Known issues & backlog](../reference/known-issues.md) for the structural
timetabling pain points.
