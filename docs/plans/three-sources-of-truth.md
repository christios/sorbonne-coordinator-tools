# Three sources of truth: the plan, second draft

> ## Where this stands — 10 September 2026
>
> **All 24 items are shipped, and so is every stage but one half of Stage 4.** This document
> is now a record of why the platform is shaped the way it is, not a list of work to pick up.
> Read it for the reasoning; do not read the stages as a queue.
>
> Checked against the running code and against production on the day this was written, item by
> item, rather than assumed. Two of the stages turned out to be already built when the check
> was made — Stage 4's `expected` half and the whole of Stage 5 — which is precisely the failure
> this note exists to prevent: the previous version of this table would have had a later
> session re-planning finished work.
>
> **What is genuinely not built:**
>
> - **Stage 4's handover *note*** — the half-day tail that would say "these two CRNs look like
>   a handover: same room, sequential dates". Never written. Its value dropped sharply once
>   `_expected_on` made the dates load-bearing, because the thing the note was going to explain
>   no longer produces a warning to explain.
> - **D3** — the French students in two groups of one set. The `doubled` verdict is built and
>   reports them; the policy question behind it ("is this ever legitimate, and if so how is it
>   said?") was never answered.
> - **D8** — should a shared set count toward the readiness of cohorts that do not own it?
>   Today it does not. Nobody decided that; it is what the code happened to do.
>
> **What the plan predicted and production did not confirm.** Stage 4 says `expected` being
> date-blind was wrong "for ten students, every single day". That was true when written and is
> now fixed, but the shape of the data is worth recording: of the 24 course codes the registrar
> publishes under more than one CRN this term, almost all are a CM and a TD running *side by
> side* all semester — not a handover at all. Only MATH-351 is genuinely sequential
> (24313 to 9 October, then 24311 from 19 October). A future reader should not assume "two CRNs
> for one course" means "handover"; on this data it usually means "lecture and tutorial".
>
> **The one open decision the code cannot make.** Everything above is a choice about the
> department, not about the software. They are listed in §6 and none of them is blocking.

This is the third pass. Draft one was torn apart by a completeness critic; draft two closed
those sixteen holes and a second reviewer then found ten more, six of them specification defects
that would have failed on first implementation. All ten are corrected here — the route that
shadowed its own import, an invariant asserted on an object's `.length`, a fill gate that blocked
sets with no CRNs yet, `blind` meaning two incompatible things, a missing `TermCoverage` field, a
re-filing UPDATE that could violate the primary key, a self-contradicting note grain, a path
parameter in the wrong currency, a dismissal key that voided itself on confirmation, and the
estimates.

This replaces the first draft. A completeness critic tore that one apart and was largely right;
where it was right the work is now scheduled, and where it was wrong (two claims) that is said
plainly rather than quietly accepted. Every path below is repo-relative to
`/Users/chriscay/Documents/sorbonne-timetable-update` unless it starts with `~`.

---

## 1. The shape of the thing

### 1.1 Three sources, one join spine

Everything reduces to a statement about **one CRN inside one portal term code**. Two tables
already have exactly that primary key (`portal_courses`, `active_course_crns`).

| Source | What it asserts | Where it lives today |
|---|---|---|
| **Facilities** (Serco) | *This CRN meets in this room, on these dates, at these hours* | Nowhere. Pilot only. |
| **Registration** | *This student is enrolled in this CRN* | `student_registrations`, synced by the SCEN Rosters extension — electives included, because `sync_registrations` writes the pull through unfiltered |
| **Our planning** | *This group of this set teaches this course under this CRN, with this teacher* | `cohort_scopes` → `scope_groups` → `group_crns`, plus `group_assignments` |

Two of the three are already reconciled by `registration_check`
(`backend/sorbonne/services/portal_lists.py:1175`). The third is missing, which is why "clash"
today means *is our own published plan self-consistent* rather than *does the registrar's room
schedule collide*.

### 1.2 The one structural change

**Store the registrar's timetable as dated meetings, and write absence down as a row.**

That single decision pays four times:

1. **Half-semester handovers need no model at all.** `group_clashes._overlap`
   (`backend/sorbonne/services/group_clashes.py:113-115`) opens with
   `if one.date != other.date: return None`. Dated storage means date-disjoint sections cannot
   clash, for free, in code already written and already tested. A weekly-pattern model would
   have had to invent a handover entity purely to suppress a false clash.
2. **`group_clashes.clashes()` does not change by one line.** Its input is
   `Session(crn, date, start, end)` — exactly the row shape a `facility_meetings` table hands
   back. `ClashPanel`, `clashesIn`, `publicationView.ts` and the fill's clash gate come along.
3. **Absence becomes checkable.** A CRN we asked about and got nothing for is a row with
   `schedule_state='silent'` and an `asked_at`. A CRN nobody asked about has no row. Those are
   different facts, and the pilot proves collapsing them is fatal: at concurrency 6 the endpoint
   returned an **empty list** for ~14% of calls, byte-identical to a genuine silence.
4. **Warnings become derived, not written.** Once the facts are rows, a verdict is a small pure
   function over them: recomputable, countable, filterable, dismissible.

### 1.3 The three rules the first draft was missing, and which make the rest cheap

The spine survives. What it needed was three contracts it did not have, and each one is small:

- **A lifecycle.** Meetings are replaced per *answered CRN*, never per term; only a *complete*
  pull may write a silence; a silence retires a CRN only after two of them. §3.1.
- **A canonicaliser.** One function, `session_of`, that both sources go through, so a facilities
  meeting and a Hub session for the same class are byte-identical `Session` tuples. No timezone
  anywhere, on either side. §3.2.
- **A Hub-free route.** The clash report is computed on our own server from our own tables, and
  asks the SCEN Student Hub only for the CRNs facilities could not answer for. §3.3.

Everything else in this plan is a consequence of those three plus the bug list.

### 1.4 What I am still rejecting, unchanged from the first draft

**A generalised, coordinator-authorable rules engine (v1).** `discrepancy_rules` is
`(field, kind, values)` validated against portal *student-record* column names
(`student_database.py:1737`). A three-way comparison is `(left source, right source,
comparison)` — a different rule shape needing a whole new editor for one coordinator. Checks
stay named Python functions. The generalisation that pays is that a check is one entry in a
list, not that it is a row in a table.

**Substituting facilities for `client.list_sections()` in the publication gate.** `validate()`
turns an unknown CRN into `status: "unknown"` → `unmatchedCrns` → blocks publication
(`backend/sorbonne/api/publication.py:178-185`, `frontend/src/services/publicationView.ts:40-46`).
Thirty silent CRNs would block every publish on day one. Facilities is a third source with its
own verdicts, never a substitute in the publish gate. `require_client` stays exactly where it is
on `preview_publication`, `publish`, `read_publication`'s validation half, and every route in
`api/timetables.py`.

**Handover detection keyed on course code.** All five MATH-009 → MATH-011 pairs in the pilot
(23364→23903, 23564→23904, 23365→23652, 23426→23654, 23565→23655) have identical room, identical
slot, identical head count, disjoint dates, and **different course codes**. The one same-code
pair, MATH-351 23436 → 23820, changes *component*: 23436 is "Algebra & Cryptography-CM" in 5.111,
10 students, 2026-08-31..2026-10-26; 23820 is the TD, same room, same 10 students,
2026-10-22..2026-12-17. So the Monday slots are cleanly sequential *and* the overall ranges
overlap by four days — neither of the two earlier descriptions was right. Detection keys on
**head count + shared room + sequential dates**, and tolerates a short overlap.

**Merging Course Registration's warnings into the Cohorts warnings column.** You split those
pages yourself on 2026-09-05 (`0c93134`) after measuring 611 registration lines burying every
rule warning. `WARNINGS_COLUMN.sortValue` is a raw undismissed **count**
(`frontend/src/services/studentColumns.ts:168`) and both pages open on
`defaultSort={{key:"warnings", ascending:false}}`, so colour cannot reorder rows. Merge the
furniture, not the readings.

---

## 2. What the first draft got wrong

Six corrections. The first two change what gets built; the rest change when.

### 2.1 I19 is not a deletion bug. The server already retains; the warning lies.

The first draft called it "confirmed bug", split it Stage 0 (copy) / Stage 6 (deletion rule
rewrite against scope ownership), and never said what actually happens. What actually happens:

`set_cohort` deletes `FROM group_assignments WHERE student_id = ANY(:ids) AND cohort_id <>
COALESCE(:cohort_id, '')` (`backend/sorbonne/services/student_database.py:458-462`). It keys on
**`group_assignments.cohort_id`**, which is a PK column and an FK to `student_cohorts`
(`backend/alembic/versions/0012_create_student_database.py:95-99`) — never NULL, never `''`.
Every placement path writes it as `self._cohorts_of(connection, [...]).get(student, cohort_id)`
(`:674` assign, `:717` assign_many, `:760`/`:777` place_many), and `_cohorts_of` (`:790-800`)
drops any student whose `cohort_id` is falsy, so a **cohortless** student placed into cohort X's
scope is already filed under X. Moving them into X evaluates `X <> X` = false and **deletes
nothing**.

`costOfMove` asks a different question: it skips a student only when
`student.cohortId === targetCohortId` (`frontend/src/services/cohortMove.ts:38`). A cohortless
student has `cohortId === null`, so every group is counted, `describeCost` (`:49-57`) says
"N group placements … This cannot be undone", and `requestMove`
(`frontend/src/components/StudentRoster.tsx:429-435`) raises a `ConfirmDialog` for a move that
destroys nothing. **There is no deletion rule to rewrite. There is a warning to make true.**

The same key over-deletes in the other direction, and that is where your actual ask lives. A
student of cohort A placed into an `open_to_all` scope owned by B is filed under A, so moving
A→B deletes that row (`A <> B`) — even though `_placeable` (`:803-812`) returns *every* student
for an `open_to_all` scope, so B's arrival is a legitimate occupant of the very group just
deleted. Language placements are silently thrown away on every cohort move.

So the rule is: **an assignment survives iff `assignment.cohortId === target`.** The UI's rule is
`student.cohortId === target`. They diverge on exactly two populations — cohortless students (UI
over-warns) and shared-set placements (both drop, wrongly). Part 1 (Stage 0) makes the UI ask the
server's question; part 2 (Stage 2) adds `keepShared` so a shared-set placement is *re-filed*
rather than dropped. §3.6.

### 2.2 Both stages that consume facilities were gated on the SCEN Student Hub

`read_publication` and the resolve route both take
`client: StudentPlatformClient = Depends(require_client)`
(`backend/sorbonne/api/publication.py:142`, `:193`) and call `client.list_sections` before
reaching `_sessions`. Swapping the session source does not decouple anything: with the Hub
unconfigured the route 503s and there is no clash panel to improve. `AGENTS.md` line 12 says only
Semesters and Announcements may disable themselves when the Hub is unconfigured — the roster
pages must keep working. The fix is a new Hub-free route on the portal router, an
`optional_client` dependency beside `require_client` — declared in a new
`backend/sorbonne/api/deps.py`, not in `api/timetables.py`, so a Hub-free route does not import
from the Hub-gated module (never a relaxation of `require_client`), and a rule that
the Hub is asked *only for the CRNs facilities could not answer for*. §3.3.

The corollary the critique did not name: today, with the Hub unreachable, `FillBlock`'s gate is
`clashes !== null` (`frontend/src/components/FillBlock.tsx:144`) and the fill is simply dead. Once
the route answers 200, an empty clash list from a never-pulled term would read as "no clashes" and
let a fill place two rooms at once. The gate has to become *evidence*, not *not-null*. §3.7.

### 2.3 The shared-set cohort keying is the third recurrence, and it had no work scheduled

`term_publication` joins `cohort_scopes` to `student_cohorts` on the **owning** cohort
(`student_database.py:989`), so a shared LANG set filed under Foundation Year is compared only
against Foundation Year's blocks. A student of cohort B sitting in that LANG group gets no clash
check against B's own lectures. The first draft mentioned this once, inside a subordinate clause
of D4, and scheduled nothing. It is now the first item in Stage 0. §3.4.

### 2.4 The blind count was argued for and scheduled nowhere

§1.3 of the first draft grafted it in, said it "earns its keep before any facilities work", and
then Stage 0 did not contain it, Stage 2 added `blind` to the *clash* payload only, and Stage 3
added a different thing. It is now Stage 0, it establishes the payload convention the two later
blind counts follow, and it covers the case the critique found underneath it: a term with no
`term_link` is not merely unjudged, it produces *no message at all*, so a cohort nobody has ever
checked shows a clean Warnings column. §3.5.

### 2.5 I17 / I24 were behind the sync they exist to make survivable

Stage 1 introduces the longest, most failure-prone sync in the product — 165 calls at concurrency
2 with a mandatory retry — while timeouts, cancel and the one-message fix sat in "Stage 6,
optional". Five of those pieces move to Stage 0, ahead of the sync; two move to Stage 1 with it;
two stay optional on an argument rather than by default. §4, Stage 0.

One factual correction while there: the first draft said `portalSync.ts:checkKind` "does not
catch this case — an old extension asked for `timetable` returns `unknown_grid` down a different
path". It returns neither. An old bridge replies `unknown_message` from its switch default
(`extension/bridge.js:43-44`); an old worker replies `unknown_message` from
`extension/background.js:360-361`. `checkKind` (`portalSync.ts:86-92`) only compares kinds on a
*successful* pull and is never reached, and `messageFor` (`scenRosters.ts:243-276`) has no
`unknown_message` case, so the old-extension failure currently reads "returned an unexpected
error" — for the failure mode whose consequence is 165 CRNs written `silent`.

### 2.6 Two overstated claims, one of which the critique also got wrong

**`describeMismatch` exhaustiveness.** I compiled it rather than reading it. Repro at
`scratchpad/tscheck/repro.ts`: a copy of `Mismatch` (`portalLists.ts:87-97`) with a sixth kind
`"clash"`, plus `describeMismatch` (`:533`), `describeKinds` (`PortalRegistrations.tsx:28-39`),
`registrationWarnings` (`discrepancies.ts:436-456`) and `WARNINGS_COLUMN.accessor`
(`studentColumns.ts:159`), through the repo's own `tsc` under `strict: true`. Exactly two errors:
TS2366 on `describeMismatch`, and TS2741 on the `Record<Mismatch["kind"], string>` at
`PortalRegistrations.tsx:29`. So the plan's "TypeScript names every site" is false **and** the
critique's "errors in THAT ONE FUNCTION" is also false. Two sites are checked; every site that
decides whether the verdict is *usable* is silent — `registrationWarnings` is constrained to
`kind: string` and flattens everything to `Warning.kind = "registration"`. The work that follows
is scheduled in Stage 3.

**`sets` on `StudentRow` is "the same openToAll problem again".** The critique is wrong on the
fact. `StudentRow.groups` does not come from `term_publication` or any cohort-keyed read. It comes
from `list_students` (`student_database.py:401-441`), whose `json_agg` joins
`group_assignments → scope_groups → cohort_scopes` with **no cohort predicate anywhere**. It is
keyed on the student. A cohort-B student's LANG assignment is already in that payload today, with
`scopeCode` `'LANG'`, and `rosterView.ts:177` already renders it as a chip. The `sets` column is
what the plan said it was: about ten lines. The real caveat is different — the aggregate has no
*term* filter, so `sets` would mix every semester a student has ever been placed in, and needs the
same semester-prefix rule `groupLabels` already applies (`rosterView.ts:122`, `:133-144`).

The critique's separate I22 point stands untouched and is dealt with in §3.9.

---

## 3. Structural changes

Eleven of them. Each names its blast radius, because most of these move numbers on a page you
look at every day.

### 3.1 Migration 0039, and a meeting lifecycle that cannot manufacture a phantom

`backend/alembic/versions/0039_the_registrar_s_own_schedule.py`. Additive; nothing existing
altered.

```
facility_sections   PK (term_code, crn)
  course_code, title, teacher_name, rooms (JSON-in-text),
  schedule_state,   -- 'published' | 'silent' | 'gone' | 'unseen'  ('unchecked' = no row, derived)
  ours,             -- in active_course_crns for this term
  head_count, head_count_low, head_count_high,
  meetings, rows, first_meeting, last_meeting,
  asked_at, first_seen_at, last_seen_at, silent_since, silent_pulls

facility_meetings   PRIMARY KEY (term_code, crn, meets_on, starts_at, ends_at)   -- room NOT in the key
  term_code, crn, meets_on (ISO date), starts_at, ends_at, room
  INDEX (term_code, crn)

facility_pulls
  id, term_code, pulled_at, pulled_by, complete, asked, answered, silent, malformed, failed

section_collision_notes   PK (term_code, our_crn, weekday, starts_at, ends_at)
  disposition ('accepted' | 'referred'), note, decided_at, decided_by
```

**Why it is `schedule_state` and not `status`.** In `portal_courses` and `student_registrations`,
`status` answers "is it still in the portal's list". This answers "does the registrar publish
times for it". Collapsing the two is the same class of bug as the openToAll quirk that has now
bitten three times.

**Why `room` leaves the meetings key.** On evidence, not taste. Across the pilot's 135 sections /
315 slots, no slot implies more meetings than its own first-to-last calendar span allows (0 of
315) and every single-date slot implies exactly one meeting (0 of 315). The portal emits one row
per (student, dated meeting), never one per room. One row per dated meeting is also what the
comparison needs: `Session` carries no room (`group_clashes.py:22-29`), and a duplicated meeting
would silently double the `dates` count in a folded clash window (`:107-108`). The empty room
string is already real in the pilot data, which is a second reason it cannot be part of a key. If
a later pull ever shows two rooms for one `(crn, date, start, end)`, the extension joins them
into one value (`"5.112 + 4.124/.126"`) and flags `roomConflict` on the section; it never emits
two rows.

**Write semantics, one transaction in `sync_facility_timetable(term_code, complete, asked,
sections)`:**

1. **Answered CRN** (in `sections` with ≥1 meeting): `DELETE FROM facility_meetings WHERE
   term_code=:t AND crn=:c`, insert the pull's meetings, recompute
   `meetings`/`rows`/`first_meeting`/`last_meeting` from what was just inserted;
   `schedule_state='published'`, `silent_pulls=0`, `silent_since=NULL`, `last_seen_at=now`. A
   moved room or hour cannot leave a stale row, because the CRN's meeting set is by construction
   exactly the pull's. Under MVCC a concurrent reader sees the old set or the new set, never
   neither.
2. **Silent CRN** (in `asked`, not answered) **and `complete=true`**: touch no meeting row.
   `schedule_state='silent'`, `asked_at=now`, `silent_since=COALESCE(silent_since, now)`,
   `silent_pulls+1`; `last_seen_at` is **not** advanced. Last-known meetings survive.
3. **Silent CRN and `complete=false`**: refresh `asked_at` only. An incomplete run's silences are
   worthless and may not be written. `complete` is set by the extension only when every worker
   drained its queue, and `asked` is built from the results map rather than the input list, so a
   run that dies after 80 of 165 CRNs cannot report the other 85 as asked.
4. **CRN not in `asked`**: nothing read, nothing written. No row at all reads as `unchecked`.
5. **Retirement:** when `silent_pulls` reaches 2 — two consecutive *complete* pulls that asked and
   got nothing, on top of the extension's own retry-empties-once inside each run —
   `schedule_state='gone'` and that CRN's meetings are deleted. Until then a silence is a doubt,
   not a cancellation.
6. **Route guard:** 400 if any answered CRN is absent from `asked`. A payload that contradicts
   itself is refused.

**What a silent CRN means downstream:** its stale meetings **keep** taking part in the comparison,
*and* the CRN is listed in the payload's `blind` array with `silent_since`. One flaky pull cannot
make a real clash vanish; a genuine cancellation cannot outlive two pulls. That is strictly better
than either pure policy.

**Rejecting the `pull_id` generation column** offered as the alternative: it puts a permanent
obligation on every reader to join to "latest pull per crn", and the first reader that forgets
reproduces exactly the phantom this prevents; it also grows the table by ~2,027 rows per pull for
ever. Delete-and-replace gives the same guarantee with no read-side obligation.

This deliberately matches the shape `sync_registrations` already uses — "The unit is the student,
not the row" (`portal_lists.py:431`), reconciliation per *returned* subject (`:472-478`), never
across the term. Here the unit is the CRN. The one departure is hard delete instead of a
`not_in_portal` tombstone, and it is justified: `facility_meetings` holds no coordinator decision,
nothing references it by foreign key, it is re-derivable by re-pulling, and a tombstone would push
a status filter into `_overlap`'s hot path where forgetting it is the bug.

**Blast radius:** none today. Nothing reads these tables until §3.3's route lands.

### 3.2 One canonicaliser, no timezone, parsing in the extension

**Where.** The extension parses, at the same place it de-duplicates, and puts `Session`-shaped
values on the wire:

```json
{"crn":"23436","meetsOn":"2026-10-26","startsAt":"08:15","endsAt":"10:15","room":"5.111"}
```

`meetsOn = EVEN_START.slice(0,10)`; `startsAt = EVEN_START.slice(11,16)`;
`endsAt = EVENT_END.slice(11,16)`; `room = ROOM_CODE` with the literal `"Room: "` prefix stripped
(`~/…/timetable-pilot/pull-timetables.js:151`), empty string allowed. Any row failing
`/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/` on either end increments a `malformed` counter reported with
the pull and is **never silently dropped**. That loudness is not decoration: `_overlap` wraps both
`fromisoformat` and `_minutes` in `except ValueError` (`group_clashes.py:117-122`), so an
unparseable value becomes "no clash" and is invisible at compare time. It has to be caught at
ingest or it is never caught.

Extension rather than server, decided: `MAX_ROWS` is 20000 (`extension/background.js:39`) and the
pilot term is 43,463 raw rows collapsing to 2,027 meetings. Collapsing client-side puts a whole
term ten times under the cap; collapsing server-side means raising a limit that exists for a good
reason. (The first draft's claim that a 43k payload is "a 422 waiting" is wrong in mechanism: the
extension cap truncates silently with `warning: 'truncated'`. That is worse — a truncated pull
looks answered. §3.8 stops truncation on a section boundary.)

**Timezone: none, on either side, ever.** Both sources are wall-clock Asia/Dubai and neither
carries an offset. The Hub's importer already settles this in its own words — "Academic dates are
wall-clock days; there is no zone in the export to honour"
(`~/Documents/scen-student-platform/backend/scen/services/timetable_import.py:66`) — and it
serialises `str(session.date)` plus the raw string times (`admin.py:297`). So **no `datetime`
object is ever constructed from a portal or Hub value**; dates stay strings, times stay strings,
and the only date arithmetic left is `dt.date.fromisoformat(one.date).weekday()` inside `_overlap`
(`group_clashes.py:118`). Concretely: the pilot's `new Date(e.EVEN_START.replace(' ','T'))`
(`pull-timetables.js:90`) does **not** survive into the extension — the weekday is derived
server-side from the date string, so a coordinator syncing from a laptop in another zone cannot
move a class to a different day. The term's Asia/Dubai setting (`api/timetables.py:97`,
`services/timetables.ts:72`) stays metadata the Hub renders for students, never applied to a
facilities value.

**Identical tuples, enforced by one function.** The Hub emits `HH:MM`, not `HH:MM:SS`
(`timetable_import.py:73-83`; its own fixture is `"start": "08:30"`,
`~/Documents/scen-student-platform/backend/tests/test_enrolment_publish_api.py:92`). Our fixture
at `backend/tests/test_publication_api.py:29` uses `"08:30:00"`, which production never sends; it
is harmless only because `_minutes` truncates (`group_clashes.py:126-128`), and nothing may be
built on that accident. Add, beside `Session`:

```python
def session_of(crn: str, date: object, start: object, end: object) -> Session | None:
    """One meeting in the one shape both sources must arrive in: ISO date, HH:MM."""
```

It trims, takes `str(date)[:10]` and `str(start)[:5]`/`str(end)[:5]` after shape-checking each,
and returns `None` for anything it cannot make canonical. `_sessions`
(`api/publication.py:75-87`) is rewritten to call it, and `facility_timetable.sessions_for` calls
the same function. Both then emit byte-identical frozen tuples and `clashes()` does not change by
one line — which is this plan's whole premise, now guaranteed instead of assumed.

**Blast radius:** one deliberate behaviour change on the Hub path — a malformed Hub time is now
dropped at construction rather than silently failing to overlap later. Same outcome, visible
instead of invisible, and the drop is counted into `blind`.

### 3.3 A Hub-free clash report

1. `backend/sorbonne/api/timetables.py`, beside `require_client` (`:28`):

```python
def optional_client() -> StudentPlatformClient | None:
    """The Hub when this deployment has one, None when it has not — never a 503.

    require_client is right for a route whose subject IS the Hub. It is wrong for a route
    that would merely like a second opinion from it."""
    try:
        return get_client()
    except StudentPlatformNotConfigured:
        return None
```

`require_client` is untouched: the routes that write to the Hub must keep 503ing.

2. New pure module `backend/sorbonne/services/term_clashes.py`, lifting
`_scopes`/`_groups`/`_assignments`/`_clashes` out of `api/publication.py:45-109` **verbatim**:
`groups_of`, `assignments_of`, `cohort_clashes(cohort, sessions)`,
`term_clashes(cohorts, sessions)`. `api/publication.py:170` becomes `cohort_clashes(cohort,
sessions)`; its response is byte-identical, and the existing test at
`test_publication_api.py:139` is the regression guard for the move.

3. `_sessions` is **not** split out as its own thing — it parses the Hub's `sections` payload and
is meaningless away from it. It moves to `backend/sorbonne/services/student_timetables.py` as
`sessions_of(rows)`, which `AGENTS.md:12` already names as the only module that talks to the Hub.

4. New store `backend/sorbonne/services/facility_timetable.py` (`Session` imported from
`group_clashes`, never redefined): `Coverage(published, silent, gone, unchecked, pulled_at)` with
a `blind` property, and `FacilityTimetableStore.coverage_for(term_code, crns)` /
`.sessions_for(term_code, crns)`.

5. The consuming route goes in `api/portal.py` — which already holds `get_store` (`:42`),
`get_database` (`:46`) and the other three-source check `registration_check` (`:497`), and whose
only Hub-touching route is `term_check` (`:446`):

```python
@router.get("/terms/{term_id}/clashes")
async def read_term_clashes(term_id, store=Depends(get_store), database=Depends(get_database),
                            facilities=Depends(get_facilities),
                       client: StudentPlatformClient | None = Depends(optional_client)) -> dict:
```

Body, in this order: (a) `cohorts = database.term_publication(term_id)` — local, and legal without
the Hub because `cohort_scopes.term_id` is an opaque string by design (migration `0021:8-11`);
(b) `crns` = every non-empty CRN on those groups; (c) `term_code =
store.term_links().get(term_id, "")`; (d) facilities coverage + sessions, or an all-`unchecked`
`Coverage` when `term_code` is empty; (e) **only if** `coverage.blind` is non-empty **and**
`client is not None`, ask `client.list_sections(term_id)` inside
`try/except StudentPlatformError` and fill the blind CRNs from `sessions_of(rows)`, setting
`hubReachable`; a Hub failure degrades coverage and never fails the response;
(f) `term_clashes(cohorts, sessions)` — the **service** function; the route is named
`read_term_clashes` so it does not shadow its own import.

Response: `{termId, portalTermCode, linked, pulledAt, hubReachable: true|false|null,
cohorts: [{cohortId, clashes}], coverage: {facilities: [crn], hub: [crn], blind: [crn]}}`.

Two rules that are load-bearing:

- **Per-CRN source selection, never a union.** No CRN is ever compared against two spellings of
  its own meetings. `_overlap` compares dates as raw strings and `_minutes` splits on `:`, so a
  union of two differently-formatted sources silently double-counts or silently misses. This route
  must not ship before §3.2.
- **The Hub is not called when facilities covers every CRN.** That is how the dependency actually
  ends — no flag day, no config switch.

**What still legitimately requires the Hub** (`require_client` stays): `preview_publication`
(`publication.py:189`) and `publish` (`:203`), which write there; `read_publication`'s
`validation`/`unmatchedCrns`/`sections`/`isReady` (`:147`, `:173`, `:178`, `:185`), because the
publish gate asks whether the *Hub* holds a section for a CRN and facilities cannot answer that —
substituting it would turn 30 silent CRNs into 30 blockers; `term_check` (`portal.py:446`);
everything in `api/timetables.py`.

**What must not:** the facilities pull, its target list and its store;
`GET /portal/terms/{term_id}/clashes` and everything downstream (ClashPanel, FillBlock);
`registration_check` (`portal_lists.py:1175`) and `register_check` (`:932`).

**Blast radius:** `CourseCards.tsx:98` keeps `fetchPublication` only for `validation`
(`CourseCard.tsx:173`), and gains a second `useQueries` on the new route; `:175` reads clashes
from the new report instead of `clashesIn(publication, …)`. The publication payload itself does
not change shape.

### 3.4 `term_publication` gains three additive keys, so a shared set is checked against every cohort

`term_publication` (`student_database.py:977-1071`) keeps its owned keys **byte-identical** and
gains, per cohort entry, for `shared_ids = {row['id'] for row in scopes if row['open_to_all'] and
row['cohort_id'] != cohort_id}`:

- `sharedScopes`: `[{id, code, name, cohortId}]` in the same position/code order as `scopes`;
- `sharedGroups`: same shape as `groups` (`:1050-1058`), reusing the existing `crns` map —
  `courses`/`code_of` at `:1018`/`:1030` already cover shared scopes;
- `sharedAssignments`: rows from `assigned` whose `scope_id` is in `shared_ids` **and** whose
  `student_id` is in this cohort's `members`. Filtering to the cohort's own students is what makes
  a clash reported under B name B's students and nobody else's.

The four queries it already runs cover every scope of the term (`:998`, `:1020-1026`,
`:1027-1034`), so the shared rows are already in memory: no extra query, no migration. The owner
cohort emits no `sharedScopes` — its own shared set is already in `scopes` — so its entry is
unchanged to the byte.

Extend the docstring to say *why* the two families are separate: **what a cohort owns decides
readiness and the registration check; what its students may hold decides clashes.** That sentence
is the anti-recurrence device. The previous two recurrences were fixed by two different local
patches (`term_scope_crns` at `:1083-1099`, the `StudentRecord` catalogue read) without ever
naming the distinction.

`api/publication.py:_clashes` (`:88-107`) becomes the only consumer: build `code_of`/`order` from
`scopes + sharedScopes` (shared appended after owned, so "CM A × LANG A1" reads in block order),
and call `clashes(groups=owned + shared, sessions=…, assignments={**owned, **shared})` — the two
dicts are keyed `(studentId, scopeId)` on disjoint scope ids, so the merge is total. Readiness
(`:157-165`) keeps owned-only, with a comment saying that widening it would block every non-owner
cohort's publish; `validate` (`:168`) keeps owned groups, so `unmatchedCrns` cannot move.

`group_clashes.py` **changes by zero lines**. `_pairs` (`:73-80`) already yields self-pairs and
skips same-scope pairs, and a shared group is by construction in a different scope from every
owned group, so every pair we need is already generated and no cross-cohort pair (A's CM × B's TD)
ever is. That is also why a term-wide pass is the wrong answer: it would produce every
L1-lecture × L3-tutorial overlap as a clash nobody can be caught by.

**Blast radius, exact.** Grows: `cohorts[].clashes` for every cohort that does not own a shared
set; the Groups & CRNs headline "N students are in two groups at the same hour"
(`CourseCards.tsx:180-181`, `:227`); ClashPanel's pair count; and fills of an ordinary block will
now leave some students unplaced with "every group meets at the same hour as one they already
hold" (`groupFill.ts:126-131`) where they were previously seated into a clash. The fill gate is
fixed for free — `FillBlock.tsx:110-114` builds its clash Set from the same per-cohort list, and
`candidate.held` comes from `assignments_of` (`student_database.py:960-975`), which does hold a
student's shared-set row because placement files it under the *student's* cohort. Unchanged:
`isReady`, `warnings`, `unassigned`, `studentsResolved`, `unmatchedCrns`, `resolved.students`,
`resolved.enrolments`, the publish payload, and every registration-check mismatch —
`registration_check` (`portal_lists.py:1187-1190`) builds `course_codes` from `cohort["groups"]`
and never reads the shared keys, deliberately, so no language verdict appears for any
non-owner cohort's students.

**I cannot state the new clash count without the live database.** This ships with before/after
counts read off the running app, not with a guessed number.

**Residual gap, accepted and written down rather than discovered:** a cohort that owns *no* scope
on the term never appears in `term_publication` at all (`cohort_ids` is derived from scope owners,
`:997`), so its students' shared-vs-shared clashes are still missed. Such a cohort has no blocks
of its own to clash against, and adding it would put an empty row on the publish screen.

### 3.5 Coverage beside the mismatches: absence of evidence becomes a row

`registration_check` (`portal_lists.py:1175`) iterates `self.term_links()`, so an unlinked
semester produces no mismatches and no message — a clean Warnings column for a cohort nobody has
ever checked. And inside a linked term, `:1207-1210` `continue`s past every student no pull
returned, counting nothing.

`StudentDatabase` gains, beside `term_publication`:

```python
def scope_terms(self, cohort_id: str) -> list[str]:
    """Every semester this cohort has sets on — linked to the portal or not."""
```

`portal_lists.py` gains two records and changes one signature:

```python
@dataclass(frozen=True)
class TermCoverage:
    term_id: str
    term_code: str        # "" when nobody has linked this semester to a portal term
    members: int
    judged: int
    blind: int            # stored, not derived: == len(skipped), but the wire carries the
                          # integer so the frontend never has to size a list to tell the cases apart
    skipped: list[str]    # by id only — a name never reaches the server
    pulled_in_term: int

@dataclass(frozen=True)
class RegistrationReport:
    mismatches: list[Mismatch]
    coverage: list[TermCoverage]

def registration_check(self, cohort_id, database) -> RegistrationReport:  # was list[Mismatch]
```

The loop head at `:1185` iterates `sorted(set(database.scope_terms(cohort_id)) | set(links))`. The
union with the link keys is deliberate: a set open to every cohort is filed under whichever cohort
holds its row (`student_database.py:1083-1091`), so `cohort_scopes WHERE cohort_id = :id` alone
would drop a term where this cohort's only presence is somebody else's shared set. The union keeps
every term checked today and adds the ones that were silent. At `:1209` the `continue` stops
discarding the student: `skipped.append(student)`.

Three integers and no booleans, so the frontend can separate three cases honestly:
`pulled_in_term == 0` → no registrations pull covers this term at all; `pulled_in_term > 0,
judged == 0` → pulls exist but returned no member of this cohort, i.e. a filter scoped to the
wrong population; `0 < blind < members` → N stragglers.

`api/portal.py:497` returns `{"mismatches": [...], "coverage": [...]}`;
`frontend/src/services/portalLists.ts:393-394` stops unwrapping `.mismatches` and returns the whole
report, so every call site is forced by the type to look at coverage. `PortalRegistrations` renders
one muted line per semester above the table — "Autumn 2026-27 is not linked to a portal term: 0 of
42 students checked", "38 of 42 checked — 4 students no pull has returned" — worded to blame our
pull, not the student. It must **not** enter `flagged` (`:121`) nor the picker's `alert` (`:148`):
a floor is not a flag. `CohortsPage`'s Warnings column must never read as clean for a term with
`judged === 0`.

The same rule applies to §3.3's route: `linked: false` ⇒ `clashes: []` with every CRN in
`coverage.blind` and `pulledAt: ""`. **"Not checked" and "nothing wrong" are different words on
screen.**

**Blast radius:** two call sites (`PortalRegistrations.tsx:79`, `StudentRecord.tsx:98`) unwrap one
level deeper. Existing mismatch content is untouched, and
`test_portal_api.py:770::test_a_student_no_pull_has_returned_is_not_judged` stays green — the
silence is preserved, it is now *counted*.

### 3.6 The cohort-move warning asks the server's question

**Part 1, Stage 0.** `costOfMove` cannot ask the right question today: `Student.groups` carries
only `{termId, scopeCode, groupLabel}` (`frontend/src/services/studentDatabase.ts:445`), built by
the `json_agg` at `student_database.py:415-417`. **One server change, and only one:** widen that
`json_build_object` with `'cohortId', a.cohort_id, 'openToAll', sc.open_to_all`. Additive, no
migration, no route, no behaviour change — `_student` (`:1716-1728`) passes `groups` through
untouched and the two keys are optional on the TS type.

Then in `cohortMove.ts`, delete the whole-student shortcut at `:38` and count per group:
`if (group.cohortId === targetCohortId) continue;`. The old shortcut becomes an accidental special
case of the new test, and keeping it would mask the shared-set case. `MoveCost` gains `retained`;
`describeCost` (`:49-57`) grows a second clause — "N placements are kept, because they are already
filed under {cohort}" — and drops "This cannot be undone" when `placements === 0`.

**Part 2, Stage 2 — the clash condition you actually asked for.** Widen retention in exactly one
place: `open_to_all` scopes. A group of a cohort-owned scope **cannot** be retained — `_placeable`
would not admit the mover to that scope at all, so the row would assert a membership the rest of
the system refuses. Server: `CohortAssignment` (`backend/sorbonne/api/student_database.py:100-106`)
gains `keep_shared: bool = False` (alias `keepShared`), so every existing caller is byte-identical.
When true, `set_cohort` runs **three** statements instead of one. `group_assignments`' primary key
is `(cohort_id, student_id, scope_id)` (`0012_create_student_database.py:95-99`), so a bare
`UPDATE ... SET cohort_id = :target` collides whenever the mover already holds a row in that shared
scope under the target — reachable after any A→B→A move. In order: (1) DELETE as today, joined to
`cohort_scopes` and restricted to `NOT s.open_to_all`; (2) DELETE the *pre-existing* shared row
already filed under `:target` where the mover also holds one under another cohort — the live
placement is the one they are arriving with, so the stale target row loses; (3) `UPDATE
group_assignments SET cohort_id = :target` for the remaining `open_to_all` rows. The UPDATE (not a bare keep) is mandatory:
`cohort_id` is in the PK and `assignments_of` reads by it (`:960-975`), so a row left filed under
the old cohort would be invisible to the new cohort's screens.

**The clash gate is a report, not a deletion, and it lives in the browser.** `set_cohort` must
never delete a placement because two hours overlap — that is exactly the invisible destruction the
module comment at `cohortMove.ts:12-23` exists to prevent. The Move dialog checks the retained set
against the target cohort's blocks using §3.3's report and lists any pair it finds, offering to
drop one. This is why part 2 is Stage 2 and not Stage 0: before §3.4 lands, that check is blind to
precisely the shared sets it is about.

Test to write first, and it fails today: `test_student_database.py::test_a_shared_placement_survives_a_move_back_to_a_cohort_it_once_held`
— place in a shared scope under A, move to B, move back to A, assert one row and no `IntegrityError`.

**Blast radius:** the `ConfirmDialog` stops appearing for cohortless moves (that is the fix); the
`FillReport`/receipt wording changes; nothing on the server changes behaviour until `keepShared`
is passed, which only `MoveToCohort` does.

### 3.7 The fill gates on evidence, not on `null`

`CourseDetail.tsx:284/:297/:464` and `FillBlock.tsx:57/:65` change their prop from
`clashes: GroupClash[] | null` to `report: ClashReport | null`, typed in a new
`frontend/src/services/termClashes.ts` (`apiFetch`, same `request` shape as
`publication.ts:84`).

```ts
const crnsHere = useMemo(() => new Set(scope.groups.flatMap(g => Object.values(g.crns ?? {})).filter(Boolean)), [scope]);
const blindHere = useMemo(() => (report?.coverage.blind ?? []).filter(crn => crnsHere.has(crn)), [report, crnsHere]);
const known = report !== null && (crnsHere.size === 0 || blindHere.length < crnsHere.size);
const ready = known && !loading && plan.placements.length > 0;   // replaces :144
```

Threshold, reasoned: today's `clashes === null` means "we know nothing about ANY CRN", so the
faithful generalisation is **block when every CRN of this set is blind** — and a set with *no CRNs
at all* is not blind, it is empty. `add_group` writes no `group_crns` row, so a newly defined set
has `crnsHere.size === 0`; `.some()` over that is `false` and would have blocked a fill that works
today (`FillBlock.tsx:144`). The `size === 0` arm is that guard — the same empty-array trap this
section flags for `groupIsRetired` forty lines above. Blocking on *partial*
blindness would make the fill permanently unusable — 30 of 165 pilot CRNs have no published
timetable — which is a worse regression than the bug.

The note at `FillBlock.tsx:195` splits in two: `!known` blocks and says "Nothing is known about
when {code}'s sections meet — the registrar's schedule has not been pulled for this semester, and
the Student Hub could not be reached. Filling waits for it rather than risk two rooms at once.";
`known && blindHere.length` warns, names the blind CRNs, and says the fill went ahead without them.
`onFilled`'s `FillReport` gains `unscheduled: string[]` — deliberately **not** `blind`. A `silent`
CRN keeps its previous meetings (§3.1) and is therefore still compared; it is stale, not blind.
`coverage.blind` means "no meetings on hand at all" — `unchecked` plus `failed` plus a silence that
never had meetings — and only those CRNs are the ones a fill genuinely went ahead without. Using
one word for both would have made the receipt claim the opposite of the truth, which is the same
class of lie as the I19 warning this plan is fixing. Same substitution in `CourseCards.tsx:180`
(`trapped`) and `:220` (the clashes column) — a term with no evidence shows "not checked", never
"0".

### 3.8 The extension: one declaration file, two families, an invariant on the wire

**The allowlist goes back into `grids.js`, the request shape does not go into `GRIDS`.** After the
`GRIDS` object (`extension/grids.js:15-141`) and before `KINDS` (`:142`):

```js
/*
 * A second family. GetTimeTable is not a Serenity ListRequest: form-urlencoded, one
 * call per CRN, GetScheduleEventsList back. It is declared here anyway, because this
 * file is where what may come back is decided, and a boundary in two files is a
 * boundary nobody reviews.
 */
export const TIMETABLE = {
  path: 'Timetable/GetTimeTable', page: 'timetable', form: true, perCrn: true,
  category: 'CRN', list: 'GetScheduleEventsList',
  columns: ['COURSE_CRN','COURSE_CODE','COURSE_TITLE','ROOM_CODE',
            'EVEN_START','EVENT_END','TEACHER_NAME'],   // EVEN_START, one N — the portal's typo
};
```

`KINDS = Object.keys(GRIDS)` (`:142`) and `gridOf` (`:144`) are untouched, so `gridOf('timetable')`
still returns null and the ListRequest path (`background.js:227-296`) can never be reached with it.
The `GRIDS` docstring gets one added paragraph naming the second family.

**Enforcement reuses the existing mechanism.** The handler computes
`TIMETABLE.columns.filter(mayReturn)` exactly as `gridSchema` does at `background.js:210`, and
trims with the existing `trim(rows, columns)` (`:50-56`). One `NEVER_RETURNED` list
(`extension/filter-schema.js:49-62`) then governs both families, and `mayReturn` (`:76-81`) stays
the single choke point. Add `'USER_NAME'` to `NEVER_RETURNED` — substring matching is safe, no
declared column contains it. And refuse a caller-supplied category outright rather than defaulting:
`if (msg.category && msg.category !== TIMETABLE.category) return {ok:false, error:'category_refused'}`,
before any fetch, mirroring the `filter_refused` shape at `:234`. `bridge.js`'s switch (`:28-45`)
never relays a category at all, so the page cannot ask for `p_UCategory=Student`.

**De-duplicate in the extension, per CRN, as each response lands.** Three reasons in order of
weight: the raw rows are one per (student, meeting) and shipping 43k of them into the page inverts
the whole arrangement described at `frontend/src/services/scenRosters.ts:1-13`; `MAX_ROWS` is
applied inside `fetchFilter` (`:269-272`) which this handler does not call, so the cap must be
re-established explicitly on the *de-duplicated* count; and the head counts exist only at the
moment of de-duplication.

**Head count per meeting, not per section.** The extension keeps how many raw rows fell into each
`(meetsOn, startsAt, endsAt)` key. One distinct value → `headCount` = it. More than one →
`headCount: null`, `headCountLow`/`headCountHigh` = min/max. Answered nothing → silent, no section
body, no division attempted. **Divide-by-zero becomes structurally impossible rather than guarded**:
a meeting key exists only because a row produced it. `head_count` is NULL-able and NULL means "not
a single number", never 0. Every consumer skips NULL — named now so it is not rediscovered later:
the register-drift comparison against `portal_courses.registered` must not fire on a NULL, and
Stage 4's handover detector must refuse a NULL pair rather than coerce it to 0. On screen: even →
"106 registered (registrar)"; uneven → "104–106 across meetings" as a quiet "roster varies" note.

I re-derived the plan's "verified with zero exceptions" claim from the artefact rather than
trusting it: 135 sections, 315 slots, every slot's row count divisible by its section's head count
(0 exceptions), 43,463 rows → 2,027 meetings. It holds today. It is also already fragile: **179 of
those 315 slots imply fewer meetings than their calendar span**, i.e. the registrar skips weeks
routinely. Per-meeting counting is what survives that; the ratio is the thing that breaks.

**Wire format, hop 1 — page ⇄ extension.** Reply:

```
{ ok:true, kind:'timetable', termCode,
  asked:   { ours:[crn], registered:[crn] },   // built from the REQUEST, order preserved, deduped
  sections:[{ crn, courseCode, title, teacherName, rooms:[...], headCount, headCountLow,
              headCountHigh, meetings:[{date,start,end,room}] }],
  silent:  [crn],                              // asked, answered, zero rows after ONE retry
  failed:  [{ crn, error:'http'|'network'|'deadline' }],
  complete, rawRows, keptRows, malformed, truncated, fetchedAt,
  warning: null|'truncated'|'partial' }
```

The load-bearing invariant, asserted in the handler before it returns and again in a test:
`asked.ours.length + asked.registered.length === sections.length + silent.length + failed.length`.
(The first draft wrote `asked.length`; `asked` is `{ours, registered}`, so that assertion was
`undefined === n` — always false in JS, a `TypeError` in the Python that mirrors it.) That is what makes the pilot's
own bug unwritable — `pull-timetables.js:146`'s `.filter(([, rows]) => rows.length)` dropped every
silence from the saved artefact and left the 30-of-165 figure alive only in a `console.warn` at
`:166`.

**`silent` and `failed` are separate**, and the pilot conflated them too:
`pull-timetables.js:65` catches a thrown fetch and writes `got.set(id, [])`, so an exception became
an empty list indistinguishable from a genuine silence. A call that errored is not evidence of
absence. Same rule for the handler's own 8-minute deadline (under `PULL_LIMIT_MS`,
`scenRosters.ts:33`): it stops asking, returns with `asked` still complete and the un-asked CRNs in
`failed`. **Truncation stops on a section boundary** — a half-written section reads as answered and
manufactures both a false clash and a false head count.

**Progress is mandatory, not a courtesy.** The 60 s silence timer is restarted only by
`fetch_progress` (`scenRosters.ts:133-138`, relayed at `bridge.js:66-78`), so the handler calls
`onProgress` (`background.js:188-193`) after every CRN. Without it a pull whose individual calls
are fast but whose whole run is minutes dies at 60 s.

**Concurrency 2 and one empty-retry stay inside the handler**, with the pilot's comment
(`pull-timetables.js:33-38`) carried over verbatim. These are correctness constants, not tuning
knobs.

**Wire format, hop 2 — page → our server.**
`POST /api/v1/portal/terms/{term_id}/sync/timetable`, body `{termCode, complete, asked:{ours,
registered}, sections, silent, failed, pulledAt}`. Pydantic: `asked` **required and non-empty** —
a body with `sections` and no `asked` is a 422, not a silent partial write. Total meetings capped
at the existing `MAX_ROWS` (`api/portal.py:39`).

**The CRN list comes from us:** `GET /api/v1/portal/terms/{term_id}/timetable-targets`, returning
two lists rather than one union — `ours` (an `active_course_crns` row for the term, plus live
non-retired `group_crns.crn` for the term's scopes) and `registered` (every other CRN our students
hold, from `student_registrations` with `status='in_portal'`). The split is not cosmetic; §6/D2
turns on it, and a foreign section that answers empty is written `unseen`, never `silent`, and
never enters the `noTimetable` bucket. A refusal must never be reportable as "the registrar
published no timetable for another department's 44 sections".

A fifth `SyncKind` in `frontend/src/services/portalSync.ts`, appended **last** in
`syncTargets.ts` — after registrations, because the CRN list is derived from them, the same
reasoning as the students-first comment at `syncTargets.ts:29-31`.

### 3.9 I22: a correlated column, not two flat ones

The critique is right and the first draft's design is dead. `applyFilters` runs
`active.every(filter => passes(row, column, filter))` (`tableFilter.ts:302`) and each `passes`
reads only its own column's accessor (`:274-290`), so `sets include LANG` AND
`meetsOn include Tue` matches a student who takes languages and separately has MATH on Tuesday. A
flat `meetsOn` column is **worse than no column**: it reads like a correlated question and
silently answers a different one.

The smallest capability that answers correlated questions is a **correlated column value** — one
token per (set, weekday) pair on one `multiOption` column. `tableFilter.ts` does not change at all.

- Token: `${scopeCode} ${weekday}` → `"LANG Tue"`, `"TD Mon"`, written exactly as the Groups column
  writes its labels (`studentColumns.ts:129-136`); display joins with `" · "`. Semester prefix
  follows `groupLabels`' existing rule verbatim (`rosterView.ts:122`, `:133-144`) — reuse that
  function's rule, do not invent a second one. Weekday names come from `group_clashes._WEEKDAYS`
  (`:135`), not a new list.
- **Blindness is a token, not a silence.** A group whose CRN has no `facility_meetings` row
  contributes the literal token `"day unknown"`. Without it, `Meets exclude LANG Tue` is a false
  negative over incomplete evidence.
- Row shape: `StudentRow` gains `placements: {termId, scopeCode, groupLabel, groupId}[]` and
  `meets: string[]`; `groups: string[]` is left exactly as it is (`rosterView.ts:177`) so every
  existing filter, copy preset and test keeps working. Backend: exactly one additive key,
  `'groupId', g.id`, into the `json_agg` at `student_database.py:415-417`. No migration.
- The join happens in the browser from the single `fetchCourseCards()` call
  (`api/student_database.py:730`), which is cohort-blind and therefore immune to the openToAll
  filing quirk. Weekdays come from a new `GET /api/v1/portal/terms/{term_code}/section-days`
  returning `{days: {crn: ["Mon","Tue"]}, blind: [crn]}` — on the **portal** router deliberately,
  so it carries no `Depends(require_client)`. Match on CRN alone, term-blind, exactly like
  `used_by` (`portal_lists.py:801`).
- Conjunction over tokens is already free: `Meets include all of [LANG Tue, MATH Tue]` is
  `multiOptionFilterFn`'s existing `"include all of"` (`tableFilter.ts:177-178`). The worked
  example composes as four chips with no new syntax: Major is Physics & Maths · Year is L3 ·
  Meets include LANG Tue.
- Neither new column goes into `DEFAULT_SHOWN` (`studentColumns.ts:84-93`) —
  `reconcileLayout`'s stored-layout branch (`:280-286`) would otherwise push a column onto every
  coordinator's existing table. They behave like the ~45 hidden portal columns.

The flat **`Set`** column (distinct `scopeCode`, ~10 lines, no server change) ships separately and
earlier: a membership column ANDed with another membership column is a conjunction, not a
correlation, and it is the correct answer to "for languages" in one tick.

**Stated plainly rather than discovered later, what stays unanswerable:** time-of-day correlation
("languages on Tuesday afternoon" — set×day×slot tokens explode the list); teacher correlation;
anything keyed on a course rather than a set ("who has MATH-100 on Tuesday" is a question about a
section and belongs on Groups & CRNs); and "is she free on Tuesday", which needs
`student_registrations × facility_meetings` because electives are not in `group_crns` at all.

### 3.10 A dismissal family for CRN-subject verdicts — and the prune bug that blocks it

**The blocking bug first.** The prune predicate is a negation: `CohortsPage.tsx:173` passes
`mine = (key) => !isRegistrationKey(key)` (`dismissals.ts:62`). Any third key family is therefore
claimed as the Cohorts page's own, and since a CRN key is never in that page's live set, **the
first render of the Cohorts page would delete every CRN dismissal in the browser.** So before any
CRN key exists, `dismissals.ts` gains a *positive* family function:

```ts
export type Family = "rule" | "registration" | "crn";
export function familyOf(key: string): Family { … }          // prefix "registration|" / "crn|" / else rule
export const owns = (...families: Family[]) => (key: string) => families.includes(familyOf(key));
```

`CohortsPage.tsx:173` → `owns("rule")`; `PortalRegistrations.tsx:109` → `owns("registration")`;
`ActiveCourses` → `owns("crn")`. Rule keys keep no prefix, so **no existing key string changes and
no dismissal is voided**. Same store, `scen-discrepancy-dismissed:v1`; do not bump the version.

**Key shape:** `crn|<termCode>|<crn>|<verdict>|<fingerprint>`, family word first, mirroring the
registration key at `discrepancies.ts:448`. E.g. `crn|262710|23436|noTimetable`,
`crn|262710|23436|teacherDiffers|<ours>≠<theirs>` (both sides comma-split through `_name_key`,
`portal_lists.py:1496`, sorted — the same `value≠expected` shape as `discrepancies.ts:262`).

**`noTimetable` carries no fingerprint at all.** The first draft wrote
`crn|262710|23436|noTimetable|silent`, which flips to `…|gone` the moment `silent_pulls` reaches 2
— so every dismissed silence resurfaces at exactly the moment it is *confirmed* dead, which is the
opposite of what a dismissal means. `silent` and `gone` are two readings of one fact (this section
has no schedule) and share one bucket and one key. Only `teacherDiffers` and the other
comparison verdicts carry a fingerprint, because for those the fact really can change.

**The fingerprint is the fact, never the observation.** `asked_at`, `first_seen_at`,
`last_seen_at`, `pull_id`, `silent_pulls` and any other counter are excluded. Including `asked_at` resurrects every
dismissal on every pull; that single mistake makes the family useless. Write it as a rule in the
module comment, because §3.1's table puts three timestamps beside `schedule_state` and the next
person will reach for one.

Does a dismissal survive the data changing? No, by construction, and that is the design
(`dismissals.ts:4-7`): the key changes when the fact changes, the old key leaves the live set,
`pruneDismissed` drops it, the warning returns. A CRN that goes published and then silent again
re-uses the identical key and is therefore still dismissed — correct, because "yes, that section is
online" is a standing decision about a standing fact.

**`blind` is not dismissable and gets no key.** It is the declared floor on a count. A dismissed
floor is a count that lies. Muted line, no ✕.

**Which buckets get a ✕:** only those whose correct remedy may be "nothing" — `noTimetable` and
`teacherDiffers`. `gone` / `arrived` / `unregistered` name work and keep none.

**The surface.** `RegisterBanner` (`ActiveCourses.tsx:273-321`) is a bespoke amber div with a
hand-rolled `sm:grid-cols-3` list (`:313`). Replace it with the shared `WarningBanner` +
`WarningRows` (`WarningBanner.tsx:43`, `:86`), already used by `CourseCards.tsx:328` and
`GroupSchema.tsx:244`. Working agreement #2 makes this the required move, and it supplies per-kind
pills, a severity ladder and a `detail: ReactNode` slot for each row's ✕ — strictly less work than
growing the bespoke grid to five columns and hand-rolling a dismiss control a third time.
`attention` (`:167-169`) must become a count over **undismissed** keys, or 30 dismissed rows keep
the banner up for ever, plus the same "Show N dismissed" toggle the two roster pages carry.

**Storage stays browser-local, but for a new reason — say so.** `dismissals.ts:8-10` justifies
locality by the evidence being local. That does not hold here: every coordinator sees the same 30
silent CRNs from the same server rows. Keep it local in v1 anyway (no table, no route, no auth
story) and record in the module comment that this is the one family that could later move
server-side without breaking the "never hide a warning someone never saw" argument.

Also: `register-check` is absent from `freshen`'s list (`syncTargets.ts:50-63` names nine keys, not
that one), so a sync run leaves the banner stale. Add it in the same change or the new buckets are
judged against the pull before last.

### 3.11 Restore is one verb; recheck is a cache fix, not a button

**Restore — scope: per page, per cohort, restore-what-you-can-see.** `dismissals.ts` gains
`restoreMany(keys)` and `clearDismissed()` (~12 lines, same load/mutate/save shape). The button
renders inside the existing `{dismissedCount ? … }` span (`CohortsPage.tsx:288-295`,
`PortalRegistrations.tsx:166-173`) **only while `showDismissed` is true**, labelled "Bring all N
back" — so the number in the button is the number the adjacent toggle has just revealed, and the
effect is observable. A third instance inside the new `WarningBanner` over the `crn|` family.

Its key set is `all.filter(w => w.dismissed).map(w => w.key)` (`all` already exists at
`CohortsPage.tsx:197`) **plus this cohort's dismissed arrivals** — which requires splitting
`CohortsPage.tsx:202` into `arrivals` (undismissed, for the banner) and `dismissedArrivals`
(today discarded). That is the only route by which a dismissed arrival ever comes back:
`ArrivalsBanner` (`:347-402`) is handed only `onDismiss`.

Not per-rule: `ruleId` is a real rule id for discrepancy warnings but the literal `"registration"`
for every registration warning (`discrepancies.ts:449`), so one per-rule control would restore
hundreds of lines under one label. One global escape hatch — "Clear every dismissal in this
browser" — behind `ConfirmDialog` (never `window.confirm`), in the page header only, not
duplicated per page.

**What restore does to warnings dismissed against data that has since changed: nothing, and it must
not.** Those keys are in no live set and there is no fact left to un-dismiss. The distinction the
first draft never stated: **prune-because-the-fact-changed is correct; prune-because-another-cohort
-is-on-screen is the bug.** `judge()` (`CohortsPage.tsx:44-72`) already returns every cohort's
warnings *and* arrivals, and `byCohort` (`PortalRegistrations.tsx:83-87`) already holds every
cohort's mismatches, so the correct `live` set is one map-flatten away. Gate the Registrations
prune until every `checks` query has settled — `retry: false` at `:79` means an errored cohort
otherwise reads as "not live" and is eaten.

**Recheck is not a second button.** `CohortsPage.tsx:110-134` reads IndexedDB in a mount-only
effect with `[]` deps; `freshen` (`syncTargets.ts:50-63`) invalidates nine React Query keys, none
of which that effect watches, so after a sync in the same tab the rules keep being judged against
the pull before last. Make the evidence a query — `queryKey: ["browser-evidence"]`, `queryFn` =
the existing `Promise.all([rowsHeld(), allChanges(), latestPullAt()])` — and add
`"browser-evidence"` to `freshen`'s list. A button for what should be automatic is a UI apology
for a stale cache; once the cache is right there is no second verb left to build.

---

## 4. Sequencing

Seven stages. Each is independently shippable, each names the items it closes and the tests that
make it done, and **nothing depends on a later stage**. Per working agreement #4, every test
against a confirmed bug is written and seen to fail before its fix.

### Stage 0 — Clear the decks (0a ~3 days, 0b ~3 days) · **SHIPPED**

> **On the estimates in this plan.** They are relative sizings, not commitments, and the second
> reviewer was right that the first draft's were fiction: eleven items, ~40 named tests, a
> `PlaceInBlock` rewrite and three structural backend changes were called "3 days". Stage 0 is
> therefore split. **0a** is the six confirmed bugs plus the page furniture — independently
> shippable, unblocks nothing else, and is where to start. **0b** is the three structural backend
> changes (§3.4 shared-set keys, §3.5 coverage, §3.10 the dismissal family) that Stages 1-3 rest
> on. Stage 1's "5 days" is a migration, a new extension fetch family, two routes, a refactor and
> another ~40 tests: read it as a week and a half. Nothing below is sized for more than one
> developer.

No migration, no facilities, no Hub, no extension change. This stage is the whole reason the rest
is cheap, and three of its items are prerequisites in the strict sense: the prune must be correct
before a third dismissal family exists, the shared-set keying must be correct before Stage 2 claims
clashes tell the truth, and `SyncStep.errorCode` must exist before a 165-call sync starts writing
into it.

**0.1 — `term_publication` gains `sharedScopes`/`sharedGroups`/`sharedAssignments`** (§3.4). First
item in the stage, before I07/I13 make cross-cohort language placement easy and multiply the
population this bug is blind to. ~30 backend lines, no migration.
- `test_publication_api.py::test_a_shared_set_clashes_with_every_cohorts_blocks_not_only_its_owners` — Foundation Year owns LANG (`open_to_all=True`); cohort L1 owns CM and holds B001 in both its CM group and LANG A1; the sections fixture gives L1's CM CRN and the LANG CRN the same Monday 08:30-10:00. Assert L1's report carries one clash naming `['CM A','LANG A1']` with `students == ['B001']`. **Fails today: L1's clashes list is empty.**
- `::test_a_shared_sets_clash_names_only_the_cohorts_own_students`
- `::test_a_shared_set_is_not_a_readiness_requirement_for_a_cohort_that_does_not_own_it` — pins the publish gate against a future "simplification" that merges the shared keys into `scopes`.
- `::test_two_cohorts_own_blocks_at_the_same_hour_are_still_not_a_clash` — pins the rejection of a term-wide comparison.
- `::test_a_shared_set_does_not_change_what_the_semester_publishes` — asserts the exact `_resolve_term` map and `payload['resolved']`.
- `test_portal_api.py::test_the_registration_check_still_ignores_a_shared_sets_courses` — guards the blast radius this fix deliberately did not take.

**0.2 — The dismissal store: positive families, correct prune, bulk restore** (§3.10 first half,
§3.11). New file `frontend/src/services/dismissals.test.ts` (none exists today).
- `dismissals.test.ts` — `familyOf` reads the family from the key and an unprefixed key is a rule; a CRN dismissal survives a prune run by the Cohorts page; a rule dismissal survives a prune run by the register; `restoreMany` removes only the keys it is given; `clearDismissed` empties the store.
- `CohortsPage.test.tsx::it("keeps a dismissal that belongs to a cohort the page is not showing")` — **write first, fails today**; needs a two-cohort fixture, which no test has.
- `CohortsPage.test.tsx::it("keeps a dismissed arrival, which is not one of the warnings on the table")`
- `CohortsPage.test.tsx::it("Bring all N back restores exactly the dismissed warnings on screen")` and `it("a dismissed arrival can be brought back")`
- `CohortsPage.test.tsx::it("a sync re-judges the rules against the new pull without a remount")` — the evidence-as-query fix.
- `PortalRegistrations.test.tsx::it("keeps another cohort's dismissed difference while this cohort is on screen")` and `it("does not forget a dismissal while a cohort's check has failed")`

**0.3 — Coverage on the registration check** (§3.5).
- `test_portal_api.py::test_the_check_says_how_many_students_it_could_not_see` — cohort of 3, pull returns 2, assert `coverage == [{members:3, judged:2, blind:1, …}]`
- `::test_a_semester_with_no_portal_link_is_reported_as_nobody_checked_rather_than_nobody_wrong`
- `::test_a_term_this_cohort_has_sets_on_is_covered_even_before_anyone_links_it`
- `::test_a_linked_term_this_cohort_has_no_sets_on_is_still_checked`
- `::test_a_term_with_no_registrations_pull_is_wholly_blind` — `judged == 0`, `blind == members`, `pulledInTerm == 0`, `mismatches == []`, so the silence pinned by `test_portal_api.py:770` is preserved rather than relaxed.
- `PortalRegistrations.test.tsx::it("says a semester is unlinked and unchecked instead of showing no warnings")` and `it("the blind count is not added to the flagged count")`
- `CohortsPage.test.tsx::it("does not show a clean warnings column for a semester nobody has checked")`

**0.4 — I19 part 1: the move warning stops lying** (§3.6).
- `cohortMove.test.ts::"costs nothing to move a cohortless student into the cohort their groups are already filed under"` — **write first, fails today**: returns `placements: 1`, must return 0.
- `cohortMove.test.ts::"counts a group filed under another cohort, which is the one the server does delete"`
- `cohortMove.test.ts::"counts a shared set filed under the cohort they are leaving, and says it separately from the rest"`
- `MoveToCohort.test.tsx` (new file)::`it("says nothing about losing groups when the move costs nothing")`
- `StudentRoster.test.tsx::it("moves a student who is in no cohort without warning that they lose their groups")` — the lie is only visible as a `ConfirmDialog`; mirrors the existing case at `:470`.
- `test_student_database.py::test_a_cohortless_student_joining_the_cohort_their_groups_are_filed_under_keeps_them` and `::test_a_placement_carries_the_students_own_cohort_so_the_roster_can_say_what_a_move_costs`

**0.5 — I07 then I13: shared sets reachable, and several at once.** I07 is two lines, not one:
`PlaceInBlock.tsx:47-50` must pass `withShared = true` **and** change its query key to
`["catalogue", cohort.id, termId, "with-shared"]`, because `WorkbookTools.tsx:46` and
`AddFromPortal.tsx:45` use the identical shared-less key and the two payloads would fight over one
cache entry. Then I13: replace the single Block/Group pair (`PlaceInBlock.tsx:103-136`) with a
repeated `{scopeId, groupId}` row under the one semester picker, N sequential
`assignStudents` calls, per-set outcomes. No server change — `assign_many` already does one scope
at a time and already names who it turned away. The modal's description ("a block is only open to
its own", `:76`) must stop saying that unconditionally.
- `PlaceInBlock.test.tsx::it("offers the sets open to every cohort, not only this cohort's own")` — **write first, I07's regression test, fails today**; the existing assertion at `:91` changes from `("cohort-1","term-1")` to `("cohort-1","term-1", true)`.
- `::it("asks for the catalogue under its own cache key")` — render after a shared-less read of the same cohort/term in one `QueryClient` and assert the shared set is still offered.
- `::it("places one selection into three sets in a single pass, one request per set")`, `it("will not offer the same set twice")`, `it("can take them out of one set while placing them in another")`, `it("reports which sets were written when a later one fails")`, `it("forgets every set row when the semester changes")` (extends `:122`), `it("warns, but does not refuse, when two chosen groups meet at the same hour")`.

**0.6 — I09 + I06: retired groups out of the fill and the dialog.** Derive client-side —
`groupIsRetired = g => { const s = Object.values(g.crns); return s.length > 0 && s.every(x => x.retired); }`.
The `s.length > 0` guard is load-bearing, not defensive: `add_group` creates no `group_crns` rows,
and a bare `every()` over an empty array is `true`, which would hide every brand-new group and
break the existing fixtures (`PlaceInBlock.test.tsx:31-33`).
- `FillBlock.test.tsx::it("does not fill a group whose every section is retired")` — **write first**
- `FillBlock.test.tsx::it("still fills a group retired for one course of the set and live for another")`
- `PlaceInBlock.test.tsx::it("still offers a group that has no sections yet")`

**0.7 — I14: the removal dialog stops freezing.** `ConfirmDialog` gains a `busy` prop
(`:62` disables only on `!ready` today, and `:24` makes `ready` unconditionally true with no
`confirmPhrase`); close on `onSettled`, not `onSuccess`; treat 404 as the outcome asked for.
- `ConfirmDialog.test.tsx::it("will not confirm twice while the caller is busy")` — **write first**
- `ActiveTeachers.test.tsx::it("treats a teacher who has already been removed as removed")` and `it("closes the dialog and says what failed, instead of leaving a dead button")`
- Apply the same fix to `ActiveCourses.tsx:120-129` in the same commit — the selections there are larger — with a new `ActiveCourses.test.tsx` carrying the same two cases.

**0.8 — I11: the fullness bar flush.** `flex flex-col` + growing spacer on the article at
`CourseDetail.tsx:203`, so the bar at `:265` sits on the bottom edge. Do this **before** anything
adds a line to that card.
- `CourseCards.test.tsx::it("keeps the fullness bar on the card's bottom edge whatever else the card carries")` — a *structure* assertion, stated as such in the test, because jsdom performs no layout. This one is a proxy, so working agreement #3 applies with full force: verify live at a width where `sm:grid-cols-2` is active and again at `2xl:grid-cols-3`, with one short and one tall card in the same row.

**0.9 — I17/I24, the five pieces that must precede the big sync** (§2.5).
1. `errorCode` on `SyncStep` (`syncRun.ts:30-44`), set in the catch at `:215-217` from `error instanceof PortalError ? error.code : ""`. Today only `(error as Error).message` survives. `scen-sync-run:v1` is cross-tab state read at `:63` and via the `storage` event at `:87-89` — widening it twice is two compatibility events instead of one.
2. One sentence instead of N: group `failed` by `errorCode` in `PortalSyncButton`, print the shared reason once and drop the per-step red spans at `:171`. An expired session fails every target because every target calls `pullFilter` first (`portalSync.ts:98`) — today that is ~6 identical sentences; the timetable step adds a failure surface that is per-CRN.
3. Pre-flight `isExtensionInstalled()` before `startRun` at `PortalSyncButton.tsx:106` (1.5 s) — a missing extension becomes one instant sentence instead of N × the 60 s silence timer.
4. Bound the server leg: `AbortSignal.timeout(90_000)` created in `syncTarget` (`portalSync.ts:94-133`) and threaded as an optional `signal`; **no blanket default in `apiFetch`**, which is also the choke point for publication and the workbook apply. Today `drive()` awaits an unbounded promise at `syncRun.ts:213` while the 15 s heartbeat keeps writing `beatAt`, so `isAbandoned` never fires, `clearRun` refuses while running and the Clear button is hidden: a stalled POST is unrecoverable.
5. The reload trap: move `resumed.current = held.id` (`SyncRunDriver.tsx:24`) to **after** a `resumeRun` that actually took the run over. One line. `resumeRun` bails at `syncRun.ts:142` for a run that is neither this tab's nor yet abandoned, so one reload inside the first 90 s currently burns the one attempt — and a timetable run is the longest window in which someone will reload.
- `syncRun.test.ts::"keeps the reason, not only the sentence"`; `PortalSyncButton.test.tsx::"one sentence when every list failed for the same reason"` (the existing mixed-path test at `:98-110` must keep passing unchanged) and `"says the extension is missing before pulling anything"`; `portalSync.test.ts::"gives up on our own server rather than parking for ever"` with an injectable budget, because `syncRun.test.ts:120-136` deliberately holds `syncTarget`'s promise open; `SyncRunDriver.test.tsx` (new)::`"a reload during a run it may not take over does not burn its one attempt"`.

**0.10 — The furniture and the trivia.** `useRemembered(COHORT)` on both roster pages —
`CohortsPage.tsx:94` and `PortalRegistrations.tsx:67` are the only two cohort pickers that ignore
the shared contract at `remembered.ts:10-13`, so moving between them silently resets the cohort,
which is most of what makes them feel like two half-pages (I20 furniture half). Plus the flat
`Set` column (§3.9, ~10 lines, I22 first half), the filter icons (I03, D5), the record pill labels
(I21), and the search placement (I23, D6).

**0.11 — I01, the prod→dev copy.** A blocked prerequisite chore, not a deliverable, and **nothing
in Stages 1–6 may be sequenced behind it** — every one of those stages can be built against the
fixtures that already exist. Its value is rehearsal on real shapes. Blocked on D1.

**Closes:** I03, I04, I06, I07, I09, I11, I13, I14, I19 (part 1), I20 (furniture), I21, I22 (Set
column), I23, I24 (halves A), I17 (items 1–5), plus the three structural prerequisites (§3.4, §3.5,
§3.10's family predicate). Marks I02 already-built. I01 waits on you.

### Stage 1 — The registrar's schedule, stored (5 days) · **SHIPPED**

Useful alone, without the Hub and without any later stage: it answers *which of our CRNs has the
registrar not put on a timetable?* — 30 of 165 in the pilot, each one a class with no room booked.

- Migration 0039 (§3.1), including `section_collision_notes` so Stage 3 adds no migration of its own.
- `session_of` in `group_clashes.py`; `_sessions` rewritten to call it and moved to
  `student_timetables.sessions_of` (§3.2). This lands **here, ahead of Stage 2 changing where
  sessions come from** — changing a live clash panel's normalisation and its source in the same
  stage leaves no clean bisect if a clash count moves.
- The `term_clashes.py` extraction from `api/publication.py` (§3.3 step 2) as its own commit, a
  pure refactor with no wire change. The commit message says why the diff touches
  `api/publication.py` and not `services/group_clashes.py`: **the clash service is already
  source-agnostic** — `clashes(*, groups, sessions, assignments)` takes a plain `list[Session]`,
  `Session` is four strings with no provenance field, and nothing in the module imports
  `student_timetables`. The coupling was entirely two route-level `Depends`. A later reader will
  otherwise try to "fix" the service.
- `optional_client`, `FacilityTimetableStore`, `GET /portal/terms/{term_id}/clashes` (§3.3). It
  ships here rather than in Stage 2 because Stage 1 freezes the wire format the ingest writes
  into; if the route's Hub-free shape (coverage, per-CRN provenance) is discovered in Stage 2, the
  stored schema is already wrong. Nothing consumes it yet — that is Stage 2 — but its tests do.
- `GET .../timetable-targets` and `POST .../sync/timetable` (§3.8). Extension 1.8.0: the
  `TIMETABLE` declaration and its two pure tests as the **first** commit, before the handler is
  written — the declaration is the review artefact, and writing the handler first is how the
  privacy boundary ends up in `background.js` by accident.
- I24 half B, now that there is something to report: widen `useSyncTargets` to return
  `{targets, ready, syncedAt, neverSynced}` (both consumers destructure) and render the **oldest**
  `lastSyncedAt` with `describeAge` (`rosterStore.ts:461-470`) in the fixed-width `tabular-nums`
  slot. Oldest, not most recent, decided: after this stage the button's whole job is a staleness
  floor, and "just now" while the term's timetable is a week old is exactly the lie this feature
  exists to prevent. `lastSyncedAt` is already fetched and discarded at `syncTargets.ts:29-44`, so
  it costs zero requests. Leave the grey lines at `CohortsPage.tsx:269` and
  `PortalRegistrations.tsx:156` alone — those report this browser's IndexedDB age, a different claim.
- The version gate, corrected (§2.5): add `extensionVersion()` to `scenRosters` (ping already
  returns the manifest version at `background.js:300-303`; `isExtensionInstalled` throws it away),
  refuse the timetable target below 1.8.0 before pulling, and add an `unknown_message` case to
  `messageFor`.
- `register_check` gains a `noTimetable` bucket; `RegisterBanner` becomes shared `WarningBanner` +
  `WarningRows` with `crn|` dismissal keys and the ✕ (§3.10); `register-check` joins `freshen`.
- One line on `SectionBlock` (`CourseDetail.tsx`): the folded weekly pattern and room, or a
  `no timetable published` pill.
- I08, the smaller half of the I05/I08 feature: extract `FillBlock` into `FillPlanner` taking
  `scopes: CatalogueScope[]` (was one `scope`) and `candidates` (was hard-coded), and add the one
  "Who" control — *Everyone not yet in this set* (default, byte-identical to today) or *Only the
  students I choose*. It lands entirely in a mount that already exists and is in daily use, and it
  makes Stage 2's two new mounts pure wiring. Fix `FillBlock.tsx:94` while in the file:
  `student.cohortId === cohort.id` excludes a cohortless student even when they already hold groups
  filed under that cohort, and once the fill can be pointed at chosen students, "this student is not
  offered and I cannot see why" becomes a support question.

**Tests that are the point** (the first draft had two; there are fourteen):
- Lifecycle: `test_facility_timetable.py::test_a_moved_meeting_replaces_the_old_one_rather_than_joining_it`; `::test_a_crn_that_answers_nothing_keeps_its_meetings_and_is_marked_silent`; `::test_two_consecutive_complete_silences_retire_the_crn_and_delete_its_meetings`; `::test_an_incomplete_pull_marks_nothing_silent`; `::test_a_crn_nobody_asked_about_is_left_untouched_and_reads_as_unchecked`; `::test_a_payload_answering_for_a_crn_it_did_not_ask_about_is_refused`; `::test_a_sync_body_without_asked_is_refused` (422, no rows written); `::test_a_failed_crn_keeps_what_it_had`.
- Canonicalisation: `::test_a_facilities_meeting_and_a_hub_session_for_the_same_class_are_the_same_session`; `::test_a_seconds_bearing_time_from_either_source_lands_on_the_same_minute`; `::test_a_meeting_the_portal_wrote_wrong_is_counted_not_dropped`; `::test_no_portal_value_is_ever_read_as_a_moment_in_time`.
- Hub independence: `test_portal_api.py::test_the_clash_report_answers_with_no_student_hub_configured`; `::test_the_hub_is_not_asked_at_all_when_facilities_covers_every_crn`; `::test_an_unreachable_hub_degrades_the_clash_report_rather_than_failing_it`; `::test_a_crn_is_read_from_one_source_only_never_from_both`; `test_publication_api.py::test_the_publish_gate_still_refuses_without_the_student_hub`; `test_group_clashes.py::test_clashes_are_computed_from_plain_sessions_with_no_reference_to_where_they_came_from`; `test_auth_gate.py::test_every_route_refuses_an_anonymous_request` (exists — must stay green).
- Extension: `portalFilters.test.ts::"every column the timetable declares passes the same boundary as a grid's"` (iterate `TIMETABLE.columns` through `mayReturn`, then assert `mayReturn('USER_NAME')` is false); `portalWorker.test.ts::"the timetable pull returns only the seven declared columns"` (stub a row carrying `USER_NAME`, `PERS_EMAIL`, `ORACLE_ID`; assert `JSON.stringify(reply)` does not contain the student login); `::"asks the portal for the CRN category and nothing else"`; `::"refuses a category other than CRN without calling the portal"` (expect `requests.length === 0`, mirroring `:304-313`); `::"one row per student collapses to one meeting, and the head count is the ratio"`; `::"a head count that does not divide is left unsaid rather than rounded"`; `::"a CRN that answers nothing is reported, not dropped"` (the regression test for `pull-timetables.js:146`); `::"a call that errors is failed, not silent"`; `::"an empty answer is asked once more before it is believed"`; `::"stops at the ceiling on a whole section boundary"`; `::"says how far along it is, so the page's silence timer is not tripped"`; `portalSync.test.ts::"refuses the timetable pull to an extension too old to know it"` — the regression test for "165 CRNs recorded as silent".
- Head counts: `::test_a_section_whose_meetings_all_carry_the_same_roster_has_a_head_count`; `::test_a_student_who_left_mid_term_leaves_a_range_and_no_head_count`; `::test_a_silent_crn_has_no_head_count_and_divides_nothing`.
- Foreign sections (if D2 is yes): `::test_a_foreign_crn_that_answers_empty_is_unseen_not_silent`; `::test_unseen_sections_stay_out_of_the_no_timetable_bucket`; `::test_a_foreign_section_stores_no_head_count`; `::test_the_sync_rejects_a_crn_in_registered_that_is_in_the_register`; `::test_a_term_pulled_with_registered_off_records_no_foreign_rows_at_all`.
- Dismissals: `ActiveCourses.test.tsx::"a dismissed noTimetable CRN leaves the banner and comes back when its times are published"`; `::"the banner closes when every bucket is dismissed"`; `crnWarnings.test.ts::"the key holds still across two pulls that changed only asked_at"`.
- Fill: `FillBlock.test.tsx::"fills everyone not yet in the set when nobody is chosen, which is what it did before"` (pin the unchanged default first, so the extraction is provably behaviour-preserving); `::"fills only the students ticked"`; `::"sends only the ticked students' ids to the server, and no names"`; `::"offers a student the cohort holds no record of but whose groups are filed under it"`; `::"will not fill while the timetable's word on clashes is not in"` (the existing case at `:114` must survive the extraction unchanged).

**Closes:** I08, I24 (age + version gate), the ingestion half of the three-source model.
**Depends on:** Stage 0 only for the card layout fix and the dismissal families.

### Stage 2 — Clashes start telling the truth (2 days) · **SHIPPED**

- **First commit:** `FillBlock`/`CourseDetail`/`CourseCards` switch from `clashes` to
  `ClashReport` and gate on evidence (§3.7) — before ClashPanel is relabelled and before any new
  verdict is added.
- ClashPanel labelled "against the registrar's room schedule", with the blind count beside the
  clash count, sourced from the Stage 1 route.
- I05: two more mounts of `FillPlanner` (§ below), no new page.
- I19 part 2: `keepShared` + the Move dialog's clash report over the retained set (§3.6).
- `PortalTermLink` mounted a second time on Groups & CRNs beside the semester picker (D7), with its
  check button hidden when `fetchTimetableStatus().configured` is false rather than 503ing on click.

**Caveat to keep stating out loud:** the Hub's timetable is itself the registrar's activity-list
export, uploaded at term start. So this is not "our plan vs our plan" becoming honest — it is a
stale registrar copy being replaced by a live one. The gain is freshness and coverage, not truth.
Where the two disagree is itself a signal; Stage 5 names it.

**I05's answer to "where should this live": three mounts of one component, and no new page.**
(a) Groups & CRNs, the existing "Fill {code}" button (`CourseDetail.tsx:397`, mount at `:459-469`;
twin at `CourseCard.tsx:186-196`) — unchanged entry point, that is I08 and it shipped in Stage 1.
(b) The student record modal, a "Place in every set" action on the Groups card
(`StudentRecord.tsx:281`), `studentIds = [row.studentId]`. **This is the home**, because the record
modal is the only surface organised BY STUDENT — every other one is organised by set or by cohort —
and it already holds all four inputs: `fetchCatalogue(cohortId, undefined, true)` under the
distinct `"with-shared"` key (`:117-120`), `fetchAssignments` (`:121-125`), `fetchTimetableTerms`
(`:107`), and `fieldHeld("MAJOR_CODE_DESC")` (one line, already written at `FillBlock.tsx:85`).
(c) The roster's floating selection bar, as the **second mode** of the placement dialog rather than
a third button — `SelectionActions.tsx:15-21` documents "The two things that can be done, as two
buttons", and a third would spend that decision on a distinction better drawn one level down.
"Place in a group…" becomes "Place in groups…" and its dialog leads with one segmented control:
*I'll name the groups* (Stage 0's I13) or *Propose them* (`FillPlanner`). Update that comment in
the same change; working agreement #6 treats it as the record of intent.

Four rules inside the walk, in a new pure `frontend/src/services/groupWalk.ts` around an
**unchanged** `planFill`:
- **Semester first, in every mount.** "TD" means different groups in different semesters; the
  reason is already written at `PlaceInBlock.tsx:56-57`.
- **Scope order parent-before-child** on `parentScopeId`, `position` as tiebreak — `planFill` reads
  `candidate.held[parentScopeId]` (`groupFill.ts:98`, `:128`), so a TP set planned before its TD
  reports "not yet in a group of the set this one nests in" for a student the walk is about to place.
- **Fold each choice into `held` before the next set.** The load-bearing detail: `planFill`'s entire
  cross-set memory is `candidate.held` (`:96-99`). Without the fold the walk cheerfully seats a
  student in TD 1 at 08:30 and TP B at 08:30 — the clash rule defeated by the loop wrapped around
  it. Seed `held` from `fetchAssignments(cohortId)` minus the scopes in the walk, so a set the walk
  is not planning still constrains it.
- **Drop a group whose own CRNs collide** before calling `planFill`: `_pairs` yields each group
  against itself and the module header says such a group "cannot hold anyone at all"
  (`group_clashes.py:5`, `:76-77`), but `FillBlock.tsx:111` drops those entries and `permitted()`
  could not use them anyway.

When no group has room: invent nothing, overfill nothing — `seat()` already returns false and the
student lands in `unplaced` with "every group is full" (`groupFill.ts:102-104`, `:135-139`;
`capacity === 0` means unlimited). A partial walk is the correct outcome, not an error. Two things
the preview must say out loud because they are true and currently unsaid: capacity is a
browser-side convention (neither `place_many` nor `assign_many` reads `scope_groups.capacity`, so a
concurrent fill can still overfill), and the write is per scope, so N sets are N requests and a
failure halfway leaves the earlier sets written.

**Shared sets (languages): list them, do not seat them.** Show each as "chosen by level — place by
hand", with a link into the manual mode. `docs/intent/group-assignment.md:27-28` puts
placement-test banding and language-level rules explicitly out of scope, the platform holds no
level data, and a LANG group chosen on capacity and major would be confidently wrong. Note that
§3.4 removes the *other* reason (clash blindness) — after Stage 0 the walk could see those clashes;
it still declines on the level-data ground alone. Stage 0's I13 is the interim answer and it works
today.

**Tests:**
- `FillBlock.test.tsx::it("will not fill when nothing is known about when this set's sections meet")`; `it("fills when some of the set is covered, names the sections it could not see, and puts them on the receipt")`; `it("treats an empty clash list from a semester nobody pulled as no evidence, not as no clashes")`; `it("keeps a student out of a group that meets at the same hour as one they hold, and says so")`
- `CourseCards.test.tsx::it("says a semester has not been checked rather than showing no clashes")`
- `groupWalk.test.ts::"plans a parent set before the set nested inside it"`; `"folds each set's choice into what the student holds, so the next set cannot be at the same hour"` (the load-bearing case); `"drops a group whose own CRNs meet at the same hour"`; `"places the sets it can and names the one where every group is full"`; `"leaves a set open to every cohort for a human, and says why"`; `"is constrained by groups the student holds in sets the walk is not planning"`
- `StudentRecord.test.tsx::"offers to place a student in every set of a semester from their record"`; `"writes one request per set, and reports the sets it could not place"`; `"will not propose groups while the timetable's word on clashes is not in"`
- `StudentRoster.test.tsx::"proposes groups for the whole selection from the placement dialog's second mode"`
- `test_student_database.py::test_keep_shared_refiles_an_open_to_all_placement_instead_of_dropping_it`; `::test_keep_shared_still_drops_a_group_of_the_cohort_being_left`

**Closes:** I05, I19 (part 2). **Depends on:** Stages 0 and 1.

### Stage 3 — The 31 clashing students, and the collisions nobody owns (2 days) · **SHIPPED**

- `student_clashes(sessions, registrations)` beside `clashes()` in the same module, sharing
  `_overlap`/`_windows`. Not `clashes()` itself — an elective belongs to no group.
- One new `Mismatch.kind = "clash"` out of `registration_check`, so it rides the machinery that
  already renders, counts and dismisses — **plus the two pieces that make that claim true**
  (§2.6): narrow `registrationWarnings`' constraint from `kind: string` to `kind: Mismatch["kind"]`
  and map it through a `Record<Mismatch["kind"], Warning["kind"]>`, so `Warning.kind` gains members
  and `describeWarning`'s switch (`discrepancies.ts:402`) becomes a third checked site; and give
  `WARNINGS_COLUMN` a **category** to filter by (accessor returns "clash" / "not registered" /
  "major differs", display keeps the full sentence). Without the second, Stage 3 adds 31 rows
  nobody can filter to, because `optionsFor` builds the tick-list from the rendered strings and a
  registration sentence carries the course code and the CRNs.
- I12, the `registration.none_at_all` gap — same file, same shape, and it uses Stage 0's coverage to
  avoid flooding before the first pull.
- **The collisions, which is what the critique's "who owns the 44 electives" question actually
  needs.** I recomputed from the pilot artefacts (135 sections; `portal-student-crns-262710.csv`,
  374 students), overlapping folded slots on weekday + clock + date range. Ours-vs-foreign: **8
  instances across 6 students — and every one is the same fact.** Our SCEN-101 sections 23302,
  23303, 23421, 23909, 23910 sit at Tue 16:30–18:00, the university's Tuesday option slot, against
  ENGL-631 22592, ENGL-616 22590, SPAN-601 22059, SPAN-604 20599 and SPRT-631 23670. Also one
  foreign-vs-foreign instance (MGMT-101 10200 × ECON-101 22683, one student).

  So this is **not a student verdict**. It is a section collision between one of our sections and
  one we do not own, and reported per student it produces six identical red lines nobody can act on.
  Reported per section it is one line with an owner and three real dispositions: move **our**
  section out of the slot (the actual fix, entirely within your power); accept it, because the
  option slot is protected university-wide and the students chose a clashing option; or refer it
  once, about the slot, to whoever owns the option block. "Move a student out of ENGL" is never the
  remedy.

  Grain: one row per `(term_code, our_crn, weekday, starts_at, ends_at)`, carrying the foreign
  counterparts as evidence and a **count** of affected students computed server-side from
  `student_registrations` — ids only, no name crosses anything. Surface: a fourth `collides` bucket
  in `register_check` and a fourth `<Column>` in the (now shared) banner.

  **The three-way split, and it is what keeps the fixable apart from the unfixable.** The
  discriminator is membership of `active_course_crns` (migration 0032) — the stored, curated
  boundary, never a subject prefix. (The pilot's tidy "44 non-SCEN" is exactly SPRT 15 + ENGL 9 +
  SPAN 7 + ECON 7 + ARAB 3 + MGMT 1 + GERM 1 + SOCI 1 by prefix, and that arithmetic is a
  coincidence of this term: SPAN/ARAB/ENGL overlap the shared language sets we do author.)
  · **Both** in the register → ours-vs-ours, a planning defect, student-subject, `kind="clash"`.
  · **Exactly one** → `collides`, section-subject, on the register page.
  · **Neither** → **not reported at all.** MGMT-101 × ECON-101 is the pilot's one case: we teach
  neither, we can move neither, the student chose both. Reporting it is precisely the permanent
  unactionable red the critique names.

  Settling: `section_collision_notes` (shipped in migration 0039) records `accepted` | `referred`
  with a note; settled rows leave `collides` so `attention` can reach zero, and are still listed
  under a "Settled" heading with their reason. Because the key is our own section's slot, **the
  note expires by itself the moment the registrar moves our section** — the same fact-shaped-key
  discipline as `Warning.key`, with no expiry bookkeeping. Server-side and not the browser
  dismissal store, deliberately: `dismissals.ts:8-9` justifies locality by the evidence being
  local, and here every input is server-side and identical for every coordinator.
- I15 registrar half: `_doubled_in_a_set` already fires per student (`portal_lists.py:1224`); D3
  decides whether it is silent for the reason I suspect.

**Tests:** `portalLists.test.ts::"describeMismatch says what a clash is"`;
`studentColumns.test.ts::"the Warnings filter offers one tick per kind, not one per sentence"`;
`discrepancies.test.ts::"a registration key keeps its shape when a kind is added"` (extends the key
pin at `:481-489`, so no coordinator's dismissals silently expire);
`test_portal_api.py::test_collision_needs_exactly_one_of_ours`;
`::test_both_ours_is_a_student_clash_not_a_collision`;
`::test_collision_is_one_row_per_slot_not_one_per_student`;
`::test_a_settled_collision_leaves_attention`;
`::test_moving_our_section_unsettles_a_collision`;
`::test_collides_is_empty_when_the_term_has_no_facilities_pull` (blind, not zero);
`::test_collision_count_carries_no_student_ids_beyond_a_number`;
`ActiveCourses.test.tsx::"the banner lists collisions and omits settled ones"`.

**Closes:** I12, I15 (registrar half). **Depends on:** Stage 2.

**One cost the critique flagged and I am carrying knowingly:** `PortalRegistrations` fires one
`registration-check` per cohort on mount with `retry: false`, and this stage makes each strictly
more expensive. With four cohorts that is fine; the moment a fifth appears, or the clash
computation shows up in a profile, the fix is to key the clash half on the term rather than the
cohort and let the four cohorts share one computation. Not pre-emptively.

### Stage 3b — The Meets column (1 day) · **SHIPPED**

§3.9's correlated column. It consumes `facility_meetings` so it cannot precede Stage 1, and it is
the one surface where the facilities pull pays you back on a question you actually ask rather than
on a check you have to be told to read.

**Tests:** `tableFilter.test.ts::"two flat columns cannot correlate a set with a day"` — the
regression that proves the rejected design wrong; `meets.test.ts::"a token is a set and a day
together"`; `::"a group whose CRN has no facility row yields 'day unknown', not silence"`;
`::"a student with groups in two semesters gets the semester prefix; one semester does not"`;
`tableFilter.test.ts::"include all of answers two correlated clauses at once"`;
`StudentRoster.test.tsx::"the Meets column renders empty and the roster still works when
section-days never answers"`; `studentColumns.test.ts::"a stored layout keeps the new Meets column
hidden"`; `test_portal_api.py::test_section_days_answers_without_the_student_hub`;
`::test_section_days_reports_a_crn_with_no_facility_row_as_blind_not_absent`.

**Closes:** I22 (second half). **Depends on:** Stage 1.

### Stage 4 — Date-aware `expected`, and the handover note (2 days) · **`expected` SHIPPED, note NOT BUILT**

> **Since:** the date-aware half is built, as `_expected_on` in `portal_lists.py` — three
> tiers (running today, else not-yet-started, else everything) with an undated section kept
> whatever tier wins, and `TermCoverage.undated_crns` declaring the fail-open rather than
> hiding it. Verified on production: MATH-351's real handover produces no false warnings, and
> the only `missing` verdicts in the department are three genuine ones about a student who
> registered for their lectures and not their tutorials.
>
> The **note** was never written, and is worth less than it looks. It was to explain a pair a
> coordinator would otherwise puzzle over — but once the dates decide which half is expected,
> the pair stops producing anything to puzzle over.
>
> One correction to the paragraph below, from the data rather than from reasoning: of the 24
> course codes the registrar publishes under more than one CRN this term, almost all are a
> lecture and a tutorial running **side by side all semester**. Only MATH-351 is genuinely
> sequential. "Two CRNs for one course" is not a synonym for "handover".

**This moves ahead of the teacher work, and the PK change leaves the plan entirely.**

The first draft scheduled a `group_crns` primary-key change — `(group_id, course_id,
part_of_term)` — at "1 day", in the same paragraph that said it needs "its own release, its own
tested backfill". It is also not needed by anything in the data. Every handover in the pilot is
already two rows under today's schema: all five MATH-009→MATH-011 pairs change **course code**, and
two codes are two `scope_courses` rows (unique on `(scope_id, code)`, `0012:69`), which one set
permits; the one same-code pair, MATH-351 23436→23820, changes **component**, and CM and TD live in
different sets. I scanned all 135 pilot sections for a same-code, disjoint-date, shared-room pair
that would collide in one cell: **there is none.** So the PK change is speculative work on a live
production table that fixes nothing anyone has seen. Its trigger for reopening, written down so a
later session does not resurrect it on a hunch: *a real group that must hold two CRNs for one
course code inside one set.* If that ever appears it is its own release in four steps — additive
nullable column, dual write, backfill, PK swap — rehearsed first on the local copy from I01, with
an assertion added to `test_migrations.py`.

What Stage 4 actually needs is **already broken today**, not from 2026-10-22 as the first draft's
deadline claimed. `expected` is date-blind: `registration_check` unions every CRN our planning holds
for a course code (`portal_lists.py:1195-1206`) and `_judge` reports every unioned CRN the registrar
does not currently hold as `missing` (`:1294-1303`). For MATH-351 that means
`expected = {23436, 23820}` all year: before 26 October the students are `missing` 23820, after
2 November they are `missing` 23436. Ten students, wrong every single day, now.

The fix needs **no migration at all**. Stage 1 already stores `first_meeting`/`last_meeting`; a
section whose window excludes the judged date is not expected. A CRN that is `silent` or
`unchecked` has no window, stays expected (fail open), and is declared in Stage 0's blind count —
which is exactly the guarantee that count exists to give.

Plus the handover **note** (0.5 day): head count + shared room + sequential dates, tolerating a
short overlap, ignoring course code, refusing a NULL head-count pair rather than coercing it to 0.
Presented as a note, never a warning.

**Tests:** `test_portal_api.py::test_a_section_that_has_finished_is_not_still_expected`;
`::test_the_two_halves_of_a_handover_are_never_both_expected_on_one_day`;
`::test_a_crn_the_registrar_has_not_timetabled_stays_expected_and_is_counted_blind`;
`::test_a_null_head_count_is_never_compared_against_the_register`;
`test_group_clashes.py::test_two_sections_that_hand_over_in_the_same_room_are_a_note_and_not_a_clash`.

**Depends on:** Stage 1 (the meeting windows). Nothing else.

### Stage 5 — Teacher and register drift (1½ days) · **SHIPPED**

- Fifth/sixth `register_check` buckets: `teacherDiffers` (ours from `group_crns.teacher_id` →
  `active_teachers`, theirs from `portal_courses.teacher_name`, compared through `_name_key` at
  `portal_lists.py:1496`, split on commas first because it is a list). Fold `_loose`
  (`api/portal.py:483`) into `_name_key`.
- **Three-state, not boolean.** Only 1 of 39 `group_crns` rows carries a `teacher_id`; 29 carry
  free text. States: *Planned*, *Named but not linked*, *Not in our planning*. The middle state is
  the worklist, and a boolean would read "Not in our planning" for 42 of 43 active teachers and
  look like a bug.
- `list_active_teachers` gains a `sections` count and the planning column (I10).
- `CourseDetail.tsx:261-263` stops doing its own exact-string compare and reads the verdict.
- I15 planning half: a cohort-blind `HAVING count(DISTINCT group_id) > 1` query.
- Before building on `portal_courses.part_of_term`: it is synced (`portal_lists.py:209-219`, from
  `PTERM_CODE`) but nothing reads it except two display columns, and **nobody has checked that
  Banner gives the two halves of a handover different PTERM codes**. One request against
  `GET /api/v1/portal/courses?term=262710` settles it. Do not build on it before that.

**Closes:** I10, I18, I15 (planning half). **Depends on:** Stage 1 for the facilities teacher name;
the portal-vs-planning half could ship earlier if you want it sooner.

### Stage 6 — Optional, on demand · **SHIPPED** (I16 and I17 were done alongside the rest)

- I16, the group roster modal.
- I17 items 8–9, and here is the argument rather than the default. **No automatic retry of a failed
  step:** the retry that matters is per-CRN and already lives in the timetable handler; re-running a
  whole step to recover one CRN is 165 calls to fix one; the dominant failures (`auth`,
  `extension_unavailable`) are deterministic so a retry only doubles the wait; and
  `syncRun.test.ts:49-63` asserts `syncTarget` is called exactly 3 times when a step throws a plain
  `Error`, so an unknown-code-retryable policy breaks a named test for no gain. What ships instead
  is a **"Retry the N that failed"** button in the idle branch beside Clear
  (`PortalSyncButton.tsx:144-153`) that flips only `failed` steps to `waiting` and calls
  `resumeRun` — `drive`'s `find(step => step.state === "waiting")` (`syncRun.ts:201`) re-picks them
  with no new control flow. And a **Stop button** with a `cancelled` flag: once the server leg is
  bounded (0.9 item 4) and the reload trap is fixed (item 5), there is no known way to wedge a run,
  so cancel is a comfort rather than a repair.

**Closes:** I16, I17 (remainder).

---

## 5. The 24 items

| id | One line | Verdict | Size | Stage | Primary file |
|---|---|---|---|---|---|
| I01 | Copy prod data into local dev | **shipped** — and now carries the sweep and the part-time database too | small | 0 (chore, blocks nothing) | `backend/scripts/copy_prod_to_dev.py` (new) |
| I02 | Row highlight + arrow keys on the history pane | **shipped** (040bdf7) | trivial | — | `frontend/src/components/StudentRoster.tsx:199` |
| I03 | Circle-plus / circle-x filter icons | **shipped** — funnel-plus / funnel-x, not circles | trivial | 0 | `frontend/src/components/TableFilterBar.tsx:119` |
| I04 | Bulk restore dismissed warnings, and stop the prune eating them | **shipped** | small | 0 | `frontend/src/services/dismissals.ts:54` |
| I05 | One-click "place this student in every set" | **shipped** — `groupWalk` around an unchanged `planFill`, two mounts | medium | 2 | `frontend/src/components/StudentRecord.tsx:281` |
| I06 | Retired groups excluded from `PlaceInBlock` | **shipped** | small | 0 | `frontend/src/components/PlaceInBlock.tsx:121` |
| I07 | Shared/openToAll sets missing from `PlaceInBlock` | **shipped** | small | 0 | `frontend/src/components/PlaceInBlock.tsx:49` |
| I08 | Choose which students a fill acts on | **shipped** — a Who control on the fill, default unchanged and pinned first | small | 1 | `frontend/src/components/FillBlock.tsx:93` |
| I09 | Retired groups excluded from the fill | **shipped** | small | 0 | `frontend/src/components/FillBlock.tsx:119` |
| I10 | Portal teacher vs our teacher | **shipped** — `teacherDiffers` / `teacherUnnamed` | medium | 5 | `backend/sorbonne/services/portal_lists.py:932` |
| I11 | Fullness bar not flush on some cards | **shipped** | trivial | 0 | `frontend/src/components/CourseDetail.tsx:203` |
| I12 | No warning when the registrar has a student in nothing | **shipped** — the `unplaced` bucket | medium | 3 | `backend/sorbonne/services/portal_lists.py:1208` |
| I13 | `PlaceInBlock` handles only one set at a time | **shipped** — one row per set | medium | 0 | `frontend/src/components/PlaceInBlock.tsx:103` |
| I14 | Active Teachers removal freezes the dialog | **shipped** — `onSettled`, not `onSuccess` | small | 0 | `frontend/src/components/ConfirmDialog.tsx:62` |
| I15 | Students in two groups of one set (French) | **shipped** — `_doubled_in_a_set`, read across the semester | medium | 3 (registrar) + 5 (planning) | `backend/sorbonne/services/portal_lists.py:1224` |
| I16 | Eye icon → who is in this group | **shipped** | medium | 6 | `frontend/src/components/CourseDetail.tsx:227` |
| I17 | Sync timeouts, retries, cancel | **shipped** — `retryFailed` and a Stop | medium | 0 (items 1–5) + 6 (retry button, Stop) | `frontend/src/services/syncRun.ts:213` |
| I18 | Teacher/CRN validation on Active Courses | **shipped** — accept / refer, with a note | medium | 5 | `backend/sorbonne/services/portal_lists.py:932` |
| I19 | Cohort move warned about groups, removed none | **shipped** — both parts, `keepShared` included | small | 0 (the warning) + 2 (`keepShared`) | `frontend/src/services/cohortMove.ts:38` |
| I20 | Merge Course Registration into Cohorts | **shipped** — one page; Course Registration is the register half of Cohorts | medium | 0 (furniture only) | `frontend/src/components/CohortsPage.tsx:94` |
| I21 | Small-print labels on record pills | **shipped** | trivial | 0 | `frontend/src/components/StudentRecord.tsx:216` |
| I22 | Ad-hoc queries ("physics, L3, Tuesday, languages") | **shipped** — `Set` and the `Meets` column | medium | 0 (`Set`) + 3b (`Meets`) | `frontend/src/services/studentColumns.ts:128` |
| I23 | Search bar above the cohort dropdown | **shipped** | small | 0 | `frontend/src/components/StudentRoster.tsx:557` |
| I24 | One clear sync message + age on the button | **shipped** — one message, and the age on the button | small | 0 (the message) + 1 (the age) | `frontend/src/components/PortalSyncButton.tsx:146` |

**Already fixed:** I02 only. **Blocked on you:** I01 (D1), I03 (D5), I15 (D3), I20 (D4), I23 (D6),
plus the elective pull (D2) which gates part of Stage 1 and all of Stage 3's `collides` bucket.

---

## 6. Decisions I need from you

### D1 — The prod→dev copy is a constraint waiver, not a recommendation · **TAKEN: built, with the waiver written into the script**

Your stated rule is that **production data loads go through the app's own API, never direct DB
access to prod**. A copy is a read, so the rule is not literally engaged — but the real question is
a credential one, and it reverses a decision you already made: on 5 September you had the API token
built precisely so that neither a migration nor a database URL would be needed, and **there is no
production `DATABASE_URL` on this machine today**. I checked: `backend/.env` carries
`DATABASE_URL → localhost:5433/sorbonne_student_db` and `TEST_DATABASE_URL →
localhost:5433/sorbonne_test` (keys and hosts read, no values); there is no `backend/.fastapicloud`,
no `~/.pgpass`, no `neonctl`, and `pg_dump`/`psql` are not on PATH. `README.md:174` puts the Neon URL
in FastAPI Cloud encrypted secrets, so only you can produce it.

Three options, honestly:

**(i) Replay the existing authenticated GETs into a local instance.** Needs the production base URL
(public, `README.md:5`), the API token already on this machine
(`~/.config/sorbonne/api-token`, 46 bytes, mode 600), and a User-Agent header (Cloudflare rejects
urllib's default with error 1010). No new production code, no new credential, no database URL. Data
that travels: registrar student ids, CRNs, cohort/scope/group ids and labels, course codes and
titles. **Names are kept out structurally, not by discipline — there are none server-side to leak**:
`students` is `(student_id, status, cohort_id, first_seen_at, last_seen_at, updated_at)` plus
`cohort_since`, and `sync_registrations` states and enforces "Only ids and CRNs are written; the
names in the pull stop here" (`portal_lists.py:434`). Coverage: every table this feature touches
*except* the portal-sourced ones — and those are better filled by running the app's own Portal sync
against `localhost`, because the SCEN Rosters extension is already injected into
`http://localhost:*/*` (`extension/manifest.json:22-31`). That is fresher than prod and skips the
per-student loop entirely. So the first draft's "~3,000 sequential requests" figure was wrong: the
real shape is ~15 bulk GETs plus a normal extension sync. Cost: it loses timestamps and actor
columns, and it needs a prod-id→local-id map as it goes.

**(ii) A new read-only bulk-export endpoint.** Total, id-faithful coverage. Cost: it mounts a
permanent bulk-export route — one bearer token becomes the whole database in one request — to buy a
dev convenience. `auth_gate.py:39-45` protects it the moment it mounts and `test_auth_gate.py:62`
proves it, but a standing exfiltration surface is still the wrong price. Keep as fallback only if
(i)'s id remapping proves painful.

**(iii) `pg_dump` from a Neon read-only branch.** The one option that needs a credential not on this
machine, and the only one that copies **staff PII by default rather than by request**:
`portal_teachers.full_name`/`psuad_email` (1,476 addresses), `active_teachers`, `part_time_teachers`,
`coordinator_accounts`, `api_tokens` — kept out only by `--exclude-table-data` flags and
post-restore `TRUNCATE`s, i.e. opt-out.

→ **Recommendation: (i), as `backend/scripts/copy_prod_to_dev.py`** (Python; `backend/scripts/`
already holds `dev_session.py` and `migrate_sqlite_syllabi.py` — the first draft's `.sh` does not
match the folder). Order, keeping the id map: cohorts → views → students (`POST /views/{id}/sync`
writes `cohort_id` NULL, `student_database.py:355-359`, so `POST /students/cohort` follows) →
term-links → per cohort the catalogue → assignments → active-courses/crns/teachers. Then run the
extension sync locally. Give it `--no-teachers`: step 7 is the entire PII exposure of the option
(~70 staff names and e-mails) and only Stage 5 needs it.

**If you choose (iii), say so explicitly** — it puts the first production database credential on
this laptop and it copies the whole staff directory including every portal teacher e-mail address,
which no API route would have handed over unasked.

**Hard rule whichever way you go:** never restore into `sorbonne_test` and never point
`TEST_DATABASE_URL` at the copy. `backend/tests/conftest.py:13-16` defaults it to
`localhost:5433/sorbonne_test` and `:19-32` runs `alembic upgrade head` against it session-wide,
while `test_portal_api.py:32-47` DELETEs eleven tables and `test_student_database_api.py:37-42`
DELETEs two more — both autouse, both committed via `engine.begin()`, neither rolled back. **One
pytest run destroys the copy.**
- `test_copy_from_prod.py::test_it_refuses_to_write_to_anything_but_a_local_database` (new — the script's only real hazard is a mis-set target)
- `test_copy_from_prod.py::test_it_never_reads_a_list_that_carries_a_person_s_name_unless_asked`

### D2 — May the extension ask the registrar about sections that are not ours? · **TAKEN: yes, and it is how the department-vs-department collisions are found**

May the SCEN Rosters extension pull the room schedule of the ~44 elective and option sections our
own students are registered in (SPRT, ENGL, SPAN, ARAB, GERM, ECON, SOCI, MGMT this term), or
should it ask only about CRNs in our register?

Empirically the portal answers: the pilot holds all of those sections pulled on your own session,
`USER_NAME` is null for `cat=CRN`, and the CRN list is already ours because `sync_registrations`
writes the registrations pull through unfiltered. But **"the endpoint answered" is not "the
registrar understands this account's access to cover systematically harvesting ~44 other
departments' room schedules at term start and on every re-pull"**. Nothing in the repo records such
a permission: `grids.js:1-13` documents a self-imposed boundary, `manifest.json` host_permissions is
only `reg.psuad.ac.ae/*`, and `docs/` holds no policy on portal reads. That is a permission question
about the registrar, not about this code.

→ **Recommendation: yes, but narrowly, and ask once in writing before Stage 1 ships.** Meeting times
and rooms only; de-duplicated in the extension before it sends; **no head count stored for a section
we do not own** (a foreign section's enrolment size is a fact about another department that no
verdict of ours needs — the collision count comes from our own `student_registrations`); and a
foreign silence recorded as `unseen` rather than `silent`, so a refusal can never be mistaken for
"the registrar published no timetable". **Ship Stage 1 with the `registered` half switched off** so
nothing waits on the answer: the 30-of-165 finding and every register bucket are about our own
sections.

If the answer is no, the fix is one clause in the timetable-targets query (drop the
`student_registrations` leg), Stage 3's `collides` bucket cannot exist, and an ours-vs-elective
clash stays invisible. That is a defensible outcome — we would simply not be able to see a clash we
could only fix by moving our own section anyway — but it costs the 6 students in the pilot.

### D3 — The French students in two groups · **OPEN** — the `doubled` verdict reports them; the policy behind it was never settled

Is the registrar registering them in two French CRNs, or do *our* `group_assignments` hold them in
two French groups?
→ **Recommendation: check one student's Groups cell against their Warnings pill on Course
Registration.** The registrar-side check already exists and fires per student (`_doubled_in_a_set`,
`portal_lists.py:1224`); if it is silent, the likeliest cause is that the French groups carry no
CRNs yet (`term_scope_crns` filters `gc.crn <> ''`). The planning-side check does not exist at all
and is Stage 5 either way. One look decides which half is real.

### D4 — Cohorts + Course Registration: one page or two? · **TAKEN: one page**

→ **Recommendation: two pages, shared furniture.** You split them on measurement three days ago and
a third source is now arriving. Stage 0 does the six-line remembered-cohort fix; re-ask in a month.
If you want them merged, merge as a segmented control that swaps *which family feeds the Warnings
column*, never as one column with two sources — the count-based sort (`studentColumns.ts:168`) will
lead the page with volume regardless of colour.

### D5 — Filter icons: green/red at rest, or on hover only? · **TAKEN: funnel-plus and funnel-x, at rest**

→ **Recommendation: hover only, as the clear button does today (`TableFilterBar.tsx:89`).**
`AGENTS.md:34` and the binding `ui-ux-decisions.md` reserve red for destructive actions, and
clearing filters destroys nothing. If you want them worn at rest, add a dated line to AGENTS.md
recording the exception, or the next session will revert it.

### D6 — "Search on top wherever there is a cohort dropdown" · **TAKEN: built, and it says which it is searching**

→ **Recommendation: the two roster pages only, via an opt-in prop.** On Groups & CRNs this reverses
commit 138c600, whose comment at `CourseCards.tsx:330-342` records that the search was deliberately
moved *down* to sit over the list it narrows. Two of the five cohort-dropdown pages (Capacity, Group
schema) have no search at all.

### D7 — `PortalTermLink` on Groups & CRNs · **TAKEN: mounted there**

The Hub-free clash report needs a `term_link` to reach the facilities rows, and `PortalTermLink` is
mounted only at `SemesterList.tsx:166` — on a Hub-gated page. So today a deployment with no Hub
cannot create the link the Hub-free feature needs.
→ **Recommendation: mount it, next to the semester picker, small and unlabelled beyond its
placeholder.** It adds a control to a page you reorganised on 2026-09-05 (`0c93134`), which is why
I am asking. The fallback if you would rather not is a sentence on the coverage line linking to
Semesters — worse only when the Hub is down, which is exactly the case this is for.

### D8 — Should a shared set count toward the readiness of cohorts that do not own it? · **OPEN** — today it does not, which nobody decided

I.e. should "L1 has 40 students with no language group" block L1's publish, the way it already
blocks Foundation Year's because Foundation Year happens to hold the row?
→ **Recommendation: not in this change, and probably not as a blocker at all.** Nothing records
which students are expected to take a language, language levels are outside the platform, and
turning it on would block every publish on day one for every cohort — the same failure mode §1.4
rejects for facilities behind `validate()`. If you want it, the honest shape is a non-blocking
warning once there is somewhere to record the expectation. §3.4 ships a test that pins the current
answer either way, so changing your mind later is one line and one test.

---

## 7. What I would not do

**Do not put facilities data behind `enrolment_resolution.validate()` in the publication path.**
Thirty silent CRNs become thirty `unknown` verdicts, feed `unmatchedCrns`, and block every publish.
This is still the single change here that can break a working page.

**Do not "make the clash service source-agnostic".** It already is.
`clashes(*, groups, sessions, assignments)` (`group_clashes.py:32-37`) takes a plain
`list[Session]`; `Session` is four strings with no provenance field (`:22-29`); nothing in the
module imports `student_timetables`. A change made in its name would be churn. The coupling was
`api/publication.py:142` and `:193` — two route-level `Depends`, not a service design.

**Do not split `_sessions` out "to decouple it".** `_sessions(rows)` reads `row["sessions"]` out of
the payload `client.list_sections(term_id)` returned; it *is* a Hub parser, and moving it to its own
file leaves it just as dependent on a Hub response. It moves to `services/student_timetables.py`
because that is where Hub parsing belongs, and the decoupling comes from the new store and the new
route.

**Do not relax `require_client`.** Add `optional_client` beside it. The publish and upload routes
must keep answering 503 when the Hub is unconfigured (`timetables.py:28-36`).

**Do not raise the pull concurrency above 2, and do not "optimise" the empty-retry away.** They read
like tuning knobs and are correctness constants: at 6, ~14% of calls returned an empty list
indistinguishable from a genuine silence, and we are now writing that state to the database. Carry
the pilot's comment into `background.js` verbatim.

**Do not fold meetings to weekly patterns at write time.** The fold is what destroys handover
evidence, and the pilot's own folded output is wrong — `weekly()` pushes one date per *raw* row
(`pull-timetables.js:87-103`), so 22134 MATH-100 reads 1484 for what is 14 Mondays. Fold for
display, in `frontend/src/services/timetableView.ts`.

**Do not put a `pull_id` generation column on `facility_meetings`.** It transfers a permanent
obligation to every reader and the first one that forgets reproduces the phantom clash it was meant
to prevent. §3.1.

**Do not build a query builder for I22, and do not build the two flat columns either.**
`services/tableFilter.ts` is already a query engine with typed operators, negation, data-derived
tick-lists and saved tabs. But the first draft's "the gap is two columns on the row" was wrong: two
flat columns ANDed cannot express "languages *on* Tuesday". The gap is a correlated *value*. And
`FilterBuilder.tsx` is not the foundation — it composes a *registrar search*, and the portal has
never heard of our sets.

**Do not change the `group_crns` primary key.** Nothing in the pilot needs it, and Stage 4's real
problem is a date-blind `expected` that is wrong today and needs no migration at all. §4, Stage 4.

**Do not add an `ours` boolean to `active_teachers` or `active_courses`.** "Ours" is a stored
decision (`active_course_crns`); "planned" is a derived consequence (`group_crns`, via the
cohort-blind `used_by` subquery at `portal_lists.py:801`, which is also the only formulation immune
to the openToAll quirk). A stored flag restates what three writers already record and goes stale the
first time a section's teacher changes.

**Do not report a collision between two sections we do not own.** MGMT-101 × ECON-101 is the pilot's
one case, it affects one student, and neither section is ours to move. Reporting it is permanent
unactionable red. §4, Stage 3.

**Do not build the restore button before fixing the prune,** and do not add a third dismissal family
before the prune predicate is positive. Shipped in the wrong order, the button is indistinguishable
from the loss it is meant to remedy, and the family is a first-render data-loss bug.

**Do not treat "regenerate warnings" as one verb — and then do not build the second one.** *Restore*
brings back your dismissals. *Recheck* is not a button: `CohortsPage.tsx:110-134` reads IndexedDB in
a mount-only effect with `[]` deps, so make the evidence a query and add it to `freshen`. A button
for what should be automatic is a UI apology for a stale cache.

**Do not merge the shared-set keys into `term_publication`'s `scopes`/`groups`.** It looks like a
simplification and it would (a) block every non-owner cohort's publish on readiness and (b) add a
language verdict to `registration_check` for every student of every non-owner cohort — a product
decision nobody has raised. §3.4 ships a test that pins this.
