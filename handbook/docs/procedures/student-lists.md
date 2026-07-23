# Student lists

How to pull student and course lists, and the one gotcha that bites every year
(repeating students + CRNs).

## Getting a student list from Portal

*Portal → Students → Current Students → Term → Department Code = **Science and
Engineering** → Year = **FY*** (adjust the year filter for L1/L2/L3).

Both **course lists and student lists** come from Portal. Remember Portal only
**reflects Banner** — Admissions maintains the underlying student data.

## Repeating students — the CRN gotcha

When you build a list of **repeating students** for a course, use the **CRN of the
coming semester**, not the current one.

- Normally the two are the **same**, so it doesn't matter…
- …**except when the maquette has changed**, in which case the CRN differs. For
  **26-27 the L2 maquette is entirely new**, so this matters right now.

!!! warning
    Getting this wrong means repeating students are attached to a defunct CRN.
    Always confirm the **coming** semester's CRN for the course when the maquette
    has changed.

## Working in shared list workbooks

The catch-up and student-list workbooks are **shared and edited by several
people**. To avoid confusion:

- Use **private filters** (filter views), never apply a filter that changes the
  view for everyone else.
- If a shared sheet "looks wrong", check whether someone left a **filter applied**
  before assuming data is missing.

## Removing / adding students to exam lists

For catch-up lists specifically, students are added by default (all failed
courses) and **removed** when they validate a course/block — see
[Catch-up exams](catch-up-exams.md). Keep the shared list authoritative and
notify professors of removals.

## Identity cross-checks

Student IDs and name spellings are **not always consistent across systems**
(Banner vs Paris/Apogée vs SUAD grade sheets). When cross-referencing lists, match
on **A00 ID + name** and flag any student who appears in one system but not
another (e.g. graded in SUAD but missing from the Paris roster) rather than
silently dropping them. The grade-transfer/consolidation tools do this matching
automatically and fail loudly on mismatches.
