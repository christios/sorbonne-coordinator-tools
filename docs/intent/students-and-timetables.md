# Intent — the timetable as the single source of truth

Confirmed 2026-08-25. This is what the restructure is *for*; the specs and plans that follow
consume it. If a design decision later contradicts something here, the contradiction is the
thing to resolve, not the line to quietly drop.

## The intent

- **Outcome** — The registrar's timetable becomes the single source of truth for a semester.
  Groups, CRNs and what students see all derive from it or validate against it, and
  Coordinator Tools owns "who is in which group" and publishes that to the student platform.
- **User** — the coordinator, and the 2803 students who read the result.
- **Why now** — S1 2026-27 starts in early September, and today the same fact lives in two
  places (the group-template workbooks *and* the roster console) with nothing checking that
  they agree.
- **Success** — a semester can be built end to end without a student-list workbook: upload
  the timetable, define the blocks in a table validated against it, assign students, push.
  And a re-issued export never silently reverts work the coordinator has done.
- **Constraint** — per-course overrides must survive re-import. Redoing that polish every
  time Serco re-issues the file is the thing being escaped.
- **Out of scope** — the student-facing app's own interface; how the portal sync works; and
  migrating the currently published semester, which is rebuilt in the new flow instead.

## Decisions taken during the interview

1. **The app owns enrolment and pushes it.** Coordinator Tools resolves block → CRN and
   sends student → CRN to the platform. The platform's file-based enrolment import is
   retired. One owner, so there is nothing to drift.
2. **The group reference is half derived, half authored.** The timetable already encodes
   `MATH-001-TD-Gr.3 → 23652`, so the CRN side is derived and read-only. What the timetable
   cannot know is which per-course groups travel together as one **block** — that is the
   coordinator's decision, authored in a table and validated against the timetable.
3. **Overrides are per course and they stick.** `title`, `short_title`, `kind`,
   `group_label` and `staff` can be overridden; the coordinator's value wins over the
   registrar's and survives re-import.
4. **Blocks are per (cohort, semester).** A cohort is a durable population — "L1 2026-27" —
   and its block structure is defined separately for each semester, because groups reshuffle
   between S1 and S2. Both dropdowns earn their place.
5. **The live semester is rebuilt, not migrated.** Its 180 workbook-derived enrolments are
   replaced by a push once its blocks exist.

## Vocabulary

Two different things were both called "groups". They are not the same object and the
ambiguity was already causing trouble:

- **Section** — a per-course teaching group as the registrar publishes it: `MATH-001 TD
  Gr.3`, one CRN. Derived from the timetable, never authored.
- **Block** — a set of sections that travel together, which a student is assigned to as a
  unit: "L1 Block A" = Maths Gr.3 + Physics Gr.1 + French F2. Authored by the coordinator.

Use these words. "Group" alone means neither.

## What the original list was missing

Recorded because each is real work that nobody had asked for yet:

1. **The publish step.** The request described inputs and screens but nothing that said "and
   now students see it". Once the app owns enrolment, a per-semester publish is the
   load-bearing piece — and it needs its own review, because it can unenrol people.
2. **Unassigned students.** With blocks driving enrolment, a student in no block gets a blank
   timetable and nothing surfaces it. Needs a count that cannot be missed.
3. **Overrides collide with the update diff.** The review screen needs a row type of its own:
   *the registrar changed a field you override — keep yours, or take theirs?* Without it the
   diff offers to revert the coordinator forever.
4. **Cohort management becomes homeless.** Removing the Cohorts page takes rename, delete and
   see-members with it; create-from-dropdown covers only creation.
5. **One screen, two doors.** "A Groups button on a semester" and "the Groups & CRNs page" are
   the same screen reached from two directions. Build it once, reachable from both, so there
   is no question which is authoritative.

## Sequencing

Ordered by what blocks running S1, not by what is most interesting.

| Phase | What | Why here |
|---|---|---|
| 1 | Data model and publish: derived sections, blocks per (cohort, semester), CRN validation, push to the platform, then rebuild the live semester and retire the workbook | Nothing else works without it, and it is the only phase that blocks running S1 |
| 2 | The block table: one table per block, rows and columns addable, per-entry validation ticks, "Upload workbook", reachable from the semester row and the side pane | The interface for what phase 1 makes possible |
| 3 | Navigation: modals, "Import a timetable", the Cohorts page removed, cohort create and manage from the dropdown, unassigned-students count | Real improvements, but S1 can run without them |
| 4 | Per-course overrides, the editing view, and teaching the diff its new row type | The most complex platform change, and it can follow term start |

**The workbook path stays alive until a push has demonstrably produced the right
enrolments.** Retiring it is the last step of phase 1, not the first — otherwise there is a
window in which S1 cannot be published at all.
