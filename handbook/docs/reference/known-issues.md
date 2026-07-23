# Known issues & improvement backlog

The recurring pain points and improvement ideas for the SCEN coordinator role,
kept separate from the procedures so the "how it is" and "how it should be" don't
get tangled. Use this as a living roadmap.

!!! note
    These are captured from working notes and day-to-day friction. They are
    **problems and proposals**, not current procedure. Revisit and prune as things
    get fixed.

## Process & data-quality pain points

| Issue | Detail |
|---|---|
| **Paris makes mistakes in PVs/transcripts** | Wrong averages, missing students. Forces a verify-before-forward discipline on every Paris document. |
| **IT/data mistakes** | Occasional errors in generated artefacts (templates, transcripts, IDs) that need catching downstream. |
| **Excel format inconsistency** | Grade/list workbooks arrive in inconsistent formats needing manual fixing before they're usable. |
| **Shared-mailbox clutter** | The shared mailbox needs a clean-up ("faire le ménage d'abord"). |
| **Course-name inconsistency in Banner** | Names aren't in a consistent format — makes CRN lists and cross-checks harder. Ongoing consolidation task. |
| **Shared-workbook filters** | People applying filters to shared workbooks changes the view for everyone — use private filters. |

## Access & tooling gaps

| Issue | Detail |
|---|---|
| **Bulk student communication** | No easy way to email a defined population (all L1, all L1 Maths…). Leads to manual recipient selection. **Proposals:** distribution lists for predefined groups, or Banner-based groups / parent CRNs (raised with IT / Khader). |
| **Mailing lists** | Need proper mailing lists for staff/student groups. |
| **Permission lists (IT)** | Need IT to create/maintain permission lists for shared resources. |
| **Adding teachers to courses on Portal** | The Portal assignment flow is cumbersome. |
| **Apogée access** | Access needed (e.g. for Admissions to pull L1 student info from Paris). |
| **Teaching-loads platform** | Desire for a proper platform to manage teaching loads (vs spreadsheets). |
| **No documentation** | The gap this handbook exists to close — keep it current. |

## Improvement ideas / proposals

- **A coordinator platform.** A precursor "Sorbonne Coordinator Tools" app already
  exists (FastAPI + React) whose first service converts **Course Class Roster PDFs
  → Excel**. Candidate next services: a **grade-enquiry request form**, a
  **dashboard** to see grade changes over the years per student, and an
  onboarding-style **process app** for internal processes (grades between AD and
  Paris, etc.).
- **CRNs per year level connected to Blackboard** for communicating with L1, L2,
  etc. as cohorts.
- **Grade-enquiry request form** — a structured intake for student grade queries
  instead of ad-hoc emails.
- **Notifications on grade changes** — the internal grade platform could notify
  admins whenever a grade is changed.
- **Process definitions** — write down the recurring cross-team processes
  (e.g. how a wrong incoming grade is caught and corrected) so they're repeatable.
- **Onboarding checklist** — formalise the new-joiner checklist (see
  [Onboarding](../getting-started/onboarding.md)).

## Facilities / personal setup

Minor but real: **new office**, **desk phone**, and other setup items are tracked
via General Services / ServiceHub.

## Internal tools already built

For reference, these tools exist in the working directory and encode procedures
described in this handbook:

| Tool | Purpose |
|---|---|
| `2_grade-transfer-suad-sorbonne` | Fill the Paris L1 upload sheet from SUAD grades, with a strict verify suite. |
| `4_MoM` | Fill Disciplinary Committee Minutes-of-Meeting from JSON; transcript viewer. |
| `5_grade-consolidation` | Verify-only reconciliation of transcripts ⇄ jury Excel files. |
| `6_requisition-forms` | Generate teaching-recruitment requisition forms from planning sheets. |
| `7_refus-de-compensation` | Generate refus-de-compensation forms per the OUI/NON rule. |
| `1_course-rosters` | Course Class Roster PDFs → Excel rosters. |

Keep their self-tests/verifiers passing when you modify them.
