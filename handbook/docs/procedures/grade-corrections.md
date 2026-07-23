# Grade corrections

Changing a grade **after** transcripts have been generated is error-prone because
one grade lives in several places. This is the disciplined way to do it so nothing
goes out of sync.

## FYS grade change (post-transcript)

1. **Update Banner** via `SHATCKN`.
      - Make sure you pick the **correct semester** — the change could be in S1,
        S2, or both.
2. **Reprint the transcript** from **SRS**.
3. **Update the PV template** with the new grade.
4. **Reflect the change across every relevant sheet**, e.g.:
      - `Term-1-After-Catch-Up` and the before-catch-up version,
      - `Term-2` carry-over sheets,
      - any aggregate/jury sheets.
5. **Update the original working workbook** given to the professors — either do it
   yourself or ask the professors to. Add a **comment noting the change was made
   after the S2 transcript was generated**.
6. **Send Admissions only the transcripts that changed** — not the whole cohort.

!!! tip "Batch corrections"
    Wait roughly **a week** before running the procedure, so you can process as
    many change requests as possible **in bulk** rather than one at a time. It
    dramatically reduces the sync burden and the number of one-off emails to
    Admissions.

## Bachelor grade change

For L1–L3 the authoritative correction happens **at Paris** (they hold the PV and
transcript). Flag the specific student ID and the corrected value to the
responsible Paris counterpart (Steve / Annick / Solène …), ask for the corrected
**PV + RDN**, verify it, route signatures, and forward only the changed documents
to Admissions.

## The catch-up correction invariant

A grade should only change after catch-up if the student **officially refused
compensation** (i.e. chose the resit) for that course. Before applying any
after-catch-up increase:

- Confirm the change corresponds to a genuine resit result, and
- Confirm the student is on the **refus de compensation** record for that course
  (source of truth: the *L1 Refus de Compensation* workbook in the SCEN archives —
  one sheet per course code, matched by Apogée ID, expecting **OUI**).

The final grade after catch-up follows the **max rule** — see
[Catch-up exams](catch-up-exams.md).

## Keeping automation in sync

If you use the **grade-transfer** tool to feed Paris, remember:

- The source SUAD sheets are **actively edited** — a correction can land after
  your last generation, silently making the output stale. **Always regenerate and
  re-verify right before upload** and compare source vs output timestamps.
- After the catch-up session, the final S2 grades live on the **Session 2** sheets,
  not Session 1. Point the tool at the right source sheet.

!!! warning "One change, many places"
    The recurring root cause of grade errors is a change applied in one place but
    not the others. Treat "update everywhere + note it + send only what changed"
    as a single indivisible step.
