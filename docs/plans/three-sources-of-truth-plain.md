# Three records that should agree

*A plain-language companion to the technical plan. Same decisions, no code. Written 8 September 2026.*

---

## The problem

Three separate records describe where our students are supposed to be, and no two of them are
guaranteed to match.

**The registrar's room timetable** says a given section meets in a given room, on given dates, at
given hours. It is what Facilities actually books.

**The register** says which students are enrolled in which sections. It is what the portal holds.

**Our own planning** — the sets, groups and CRNs we build in Groups & CRNs — says which group of
which set teaches which course under which CRN, and which student sits in it.

We do compare the second against the third today. Against the first we compare almost nothing, and
what we do compare is out of date by construction: the room timetable reaches the platform as a
file exported from the registrar and uploaded by hand into the Student Hub at the start of term. It
is a photograph taken in week one. Every room change, every added catch-up session and every
cancelled class since then is invisible to us.

So this is not a case of flying blind. It is a case of reading a stale copy and having no way to
tell how stale. What follows replaces the photograph with something we can refresh, and — more
importantly — makes the platform say plainly when it has not been able to look.

## What a live copy turns out to contain

I pulled the registrar's timetable for the whole department as a trial. We asked about 165
sections — every section our students are registered in this semester — and 135 of them answered.

It is a slow, deliberate pull: two sections at a time on purpose, with a second attempt on every
empty answer, and a ceiling of about eight minutes. That pace is not timidity, and Phase A below
hardens the sync button before Phase C ever runs it. Four things came out of the trial that we
cannot see today by any other means.

**Thirty-one students have a genuine clash between two of our own sections.** Most are the French
pairs we already suspected.

**Five of our own SCEN-101 sections sit in the university's protected Tuesday 16:30–18:00 option
slot** — against the English, Spanish and Sport options our students take in exactly that slot.
Eight collisions across six students, and all of them one fact rather than eight. This is the
finding we could not have reached any other way, and unlike most of what follows it is a scheduling
decision entirely within our own hands.

**Thirty of the 165 sections we asked about have no published timetable at all.** Not a failure of
the pull — genuinely nothing booked. This matters more than it sounds: any clash count we produce
is a floor, not a total, and the platform must say so rather than present silence as agreement.

**Half-semester handovers are visible.** One section ends and another takes over the same room and
hour a week later. MATH-351 does this, and so does the Linear Algebra → Algorithms pattern across
several groups. We have been undecided about whether to model MATH-351's two halves as one thing or
two; the registrar already treats them as two separate CRNs, which settles it.

## The one change that makes the rest cheap

Store the registrar's timetable as **individual dated meetings**, and record "we asked and got
nothing" as a fact in its own right rather than as an absence.

Storing real dates rather than a weekly pattern sounds like a detail. It is not. A course running
weeks 1–7 and one running weeks 8–15 in the same room and hour can then never be reported as
clashing, because they never share a date — no special handling needed. It also means nothing about
how clashes are found or reported has to change; only what they are checked against.

Recording silence explicitly matters for a blunter reason. During the trial, pulling faster made
the portal return *nothing* for about one section in seven — indistinguishable from a section that
genuinely has no classes booked. If we do not write down the difference between "asked and got
nothing" and "never asked", a failed pull looks exactly like the registrar cancelling a term's
worth of classes.

The same care runs through to what the screen says. A section is only treated as cancelled after
**two consecutive complete pulls** come back empty for it, and in the meantime its last known times
keep being used. So if a room booking disappears, nothing lurches: the platform keeps working from
what it last saw and only changes its mind once.

---

## Four things that turned out differently

### The cohort-move warning was lying to you — and hiding a real loss

You moved a student into a cohort, were told she would lose her groups, and later found she still
had them. Nothing failed. The message is a fixed sentence printed on every cohort move in either
direction, before the system has worked out whether anything would be lost. For a student who was
in no cohort to begin with it is simply false — she was not being moved *out* of anything. For that
student the groups were never at risk.

But the same rule cuts the other way, and there the loss is real. A placement in a set shared
across cohorts — a language group, typically — stays filed under the cohort the student is leaving,
so **every cohort move silently throws it away, today**. The warning is wrong about the case you
saw and silent about the case that actually destroys work.

Phase A makes the message true. Phase D keeps the shared placement, re-filing it under the cohort
the student arrives in.

### The history panel already does what you asked for

Row highlighting and arrow-key navigation are both already in the product — open the history panel
and try them. What does *not* have them is the full student record window, which may well be what
you were reaching for.

### Half of the "bring back dismissed warnings" feature exists

Turn on "Show N dismissed" and each one appears struck through with a restore arrow. So what is
being added is the bulk version of something already there.

There is a fault underneath it, though, and it is worth naming in its own right: **dismissing a
warning is currently unreliable.** Opening one cohort's page silently discards dismissals belonging
to a cohort that page is not even showing — so a warning you cleared last week can reappear with no
explanation. That is fixed in Phase B, and the bulk restore button cannot safely exist until it is.

### Merging Course Registration into Cohorts is something you already tried

Those two pages were split apart on 5 September 2026, and the reason was recorded: 611 registration
lines on one cohort buried every other warning the page had. Colour will not fix that, because the
warnings column sorts by how many warnings a student has, and both pages open sorted on it — a
student with four registration differences would outrank a withdrawn student regardless of hue.

There *is* a real reason those two pages feel like halves of one thing, and it has nothing to do
with the merge: they are the only two screens with a cohort dropdown that do not remember your
choice. Every other one does. Move between them and your cohort silently resets.

---

## What gets built, in order

Each phase is useful on its own and nothing waits on a later one. Rough weights: Phase A about
three days, Phase B about three, Phase C a week and a half, Phases D and E about two days each,
Phase F under two. One person, and these are relative sizes rather than promises.

### Phase A — Fix what is broken

Six confirmed faults and the small irritations around them. Nothing else depends on this, which is
exactly why it goes first.

Removing a teacher from the active list stops freezing the dialog — today one failure leaves a dead
button and no message, and pressing it again is guaranteed to fail. Retired groups stop being
offered when placing a student and stop being suggested by Fill. Language sets become visible in
the placement dialog. The placement dialog handles several sets at once instead of one. The cohort
move warning starts telling the truth. The fullness bar sits on the bottom edge of every card
rather than floating above it on the shorter ones. Both stray cohort dropdowns start remembering
your choice, and labels arrive on the student profile pills.

Two further items in this phase — the filter icons and the search bar placement — are decisions 5
and 6 below, so they wait on you rather than on the work.

### Phase B — Three foundations

Less visible, but everything after this rests on it. **The first of the three will change numbers
you read every week.**

Sets shared across cohorts — languages, principally — are currently checked only against the cohort
they were created under. A student from another cohort in a shared language group is never checked
against their own cohort's lectures. This is the third time that same gap has produced a fault, and
it gets fixed properly here rather than worked around again.

When it lands, the clash count on Groups & CRNs will **go up**, and Fill will start leaving some
students unplaced with *"every group meets at the same hour as one they already hold"* where it
previously seated them into a clash. That is the check working, not breaking. How far the number
moves cannot be known until it runs against live data, so it ships with a before-and-after reading
taken off the running system.

Second: "we could not check this" becomes something the screen says in as many words, and stops
looking identical to "we checked and found nothing wrong". At the moment a cohort nobody has run a
sync for looks exactly like a cohort in perfect order.

Third: the dismissal fault above is fixed, and the bulk restore button arrives with it.

### Phase C — Bring in the registrar's timetable

Useful entirely on its own, before any comparison exists, because it answers a question we cannot
ask today: **which of our sections has the registrar not booked a room for?** Thirty of 165, this
semester.

The pull runs from the browser extension, because the portal recognises a signed-in person and our
server is not one. In practice that means a coordinator signed into the portal starts it and it
takes a few minutes. Realistically it is a once-a-term action with a re-run whenever the registrar
has been moving things — and because the sync button will show how stale the oldest pull is, you
can see when that is due rather than guess.

Also here: choosing *which* students a Fill acts on rather than all of them.

### Phase D — Clashes start telling the truth

The clash panel is relabelled to say what it now compares against, and shows how many sections it
could not see beside the number it found.

Fill changes when it refuses. Today it sits dead for everyone whenever the Student Hub cannot be
reached, even when we have a perfectly good timetable in hand. After this it stops only when it has
no timetable to check a set against — so it becomes *more* available, not less, and refuses for a
reason you can act on.

Also here: **placing one student into all their groups at once.** Its home is the student record
window, because that is the only screen organised by student — everywhere else is organised by set
or by cohort. It also appears as a second mode of the existing placement dialog and behind the
existing Fill button: one feature in three places rather than three features.

Two limits worth knowing before you meet them. Group capacity is advisory rather than enforced, so
two people filling at the same time can still overfill a group. And placing a student into several
sets writes one set at a time, so a failure halfway through leaves the earlier sets already
written — it will tell you which.

One honest exclusion: it will *list* language sets but not seat anyone in them. Language groups are
chosen by level, we hold no level data, and a language group picked on capacity and major would be
confidently wrong. Placing those by hand stays the answer.

### Phase E — The clashing students, and the Tuesday option slot

The 31 students with clashes between our own sections surface individually, alongside the warnings
that already exist.

The Tuesday-slot collisions are handled differently, and deliberately: they are recorded **once per
section pair, not once per student**, which is what stops them becoming a wall of red. Each gets
one of three outcomes — move **our own** section out of the slot, which is the actual fix and
entirely within your power; accept it, because the option slot is protected university-wide and the
students chose a clashing option; or refer it once, about the slot, to whoever owns the option
block. Settled collisions leave the count, so the screen can reach zero.

A collision between two sections that both belong to other departments is not reported at all.
There is one this semester, it affects one student, and neither section is ours to move.

### Phase F — The remaining comparisons

**Half-semester handovers stop producing false warnings.** Today both halves of a handover count as
expected all year, so ten students are reported as missing a registration every single day — the
second half before it has started, the first half after it has ended. That is wrong now, not
wrong-in-future, and the fix needs nothing new stored: it uses the dates Phase C already brings in.

Questions that depend on the day of the week become answerable — *"do we have any physics student
in L3 with languages on a Tuesday?"* is the shape, and it is unanswerable today at any price
because nothing records which day a student's sets actually meet.

The portal's teacher for a CRN is compared against the one we assigned, and where the portal's
record and ours disagree it is reported the same way every other warning is.

### Phase G — On request

Seeing who is in a group from the group card, and the smaller sync conveniences. Real requests;
nothing else is waiting on them.

---

## Your twenty-four requests

**Already done — 1.** Row highlighting and arrow keys in the history panel. Both are in the
product; it is the record window that lacks them.

**Confirmed faults — 7**

| | |
|---|---|
| Cohort move warned about groups it never removed — and silently discards shared ones | Phases A and D |
| Language sets missing from the placement dialog | Phase A |
| Fill suggests retired groups | Phase A |
| Fullness bar floats above the bottom on some cards | Phase A |
| Removing a teacher freezes the dialog | Phase A |
| Dismissed warnings are quietly discarded when another cohort is on screen | Phase B |
| Students in two French groups | Half the check exists; the rest is Phase F |

**New capability — 16.** Placing a student in all groups at once · choosing who a Fill acts on ·
placing into several sets at once · excluding retired groups from placement ·
warning when the registrar has a student in nothing · comparing the portal's
teacher against ours · warnings on Active Courses · seeing who is in a group · sync timeouts and
retries · one clear message when the portal is not signed in · labels on the profile pills ·
day-of-week questions · copying live data into testing · filter icons · merging Course Registration
into Cohorts · search bar placement.

Five of these wait on a decision from you — copying live data into testing, the filter icons, the
French groups question, merging Course Registration into Cohorts, and the search bar. Decisions 2,
7 and 8 below arose from the plan rather than from your list, which is why there are eight
decisions and five blocked requests.

---

## Eight decisions

Each has a recommendation, so you can accept or overrule rather than design from scratch. Only
decisions 1, 5 and 6 hold up Phase A; the rest can wait weeks without stalling anything.

**1. Copying live data into the test environment.** *Blocks nothing — it is rehearsal on real
shapes, not a prerequisite.* Three ways to do it.

*Replaying the platform's own read requests* uses the access token already on this machine. It
copies no student names, because there are none held on the server to copy. It *can* reach the
staff list, so it runs with that step switched off by default — about seventy staff names and email
addresses, and only the teacher comparison in Phase F needs them.

*Building a bulk export into the product* would be complete and exact, but it means a permanent
route where one token fetches the entire database in a single request. That is a standing risk
bought for a testing convenience, so it is a fallback rather than a plan.

*Copying the database directly* would put a live production credential on your laptop, and would
bring across the whole staff directory including 1,476 email addresses — by default rather than by
request.

**Recommendation: the first.** If you want the direct copy, say so explicitly; it is a real change
in what this laptop holds.

**2. May the extension ask the registrar about other departments' sections?** *Blocks part of Phase
C and all of Phase E's Tuesday-slot work; the rest of Phase C ships without it.*

The trial already pulled those 44 sections once, on your own portal session, which is how we know
about the Tuesday slot at all. The portal answers when asked. But "it answered" is not the same as
"the registrar understands this account to cover collecting 44 other departments' room schedules,
every term, as routine."

**Recommendation: yes, but ask once in writing first** — times and rooms only, nothing about their
enrolments. Whoever answers this decision is the person who would write to the registrar. The work
is built so this part stays switched off until you have an answer, so nothing waits on it. If the
answer is no, we lose sight of six students' Tuesday collisions and nothing else.

**3. The French students in two groups.** *Blocks nothing immediately, but it decides where the
larger half of Phase F's work goes.* This is 24 of the 31 clashes, so it is the biggest single
number in this report.

Two possibilities, and they need different fixes. Either the registrar has enrolled those students
in two French CRNs — in which case the check already exists, already fires per student, and the
work is to find out why it is quiet. Or *our own* records place them in two French groups — in
which case no check exists at all and Phase F builds one.

**Recommendation: settle it by looking at one student** — their Groups cell against their warnings
on Course Registration. If the warning is there, it is the registrar's side and the question is why
it is not reaching you; if the Groups cell shows two French groups and no warning fires, it is
ours. Most likely cause of a silent check: the French groups have no CRNs recorded against them yet.

**4. Merge Course Registration into Cohorts?** **Recommendation: keep them as two pages, but make
them behave alike** — the same remembered cohort, the same search, the same layout. You split them
on evidence on 5 September and a third record is about to arrive. Take the remembered-cohort fix
now and revisit in a month.

**5. Filter icons in green and red.** *Blocks one Phase A item.* **Recommendation: coloured on
hover only.** The house rule reserves red for destructive actions, and clearing a filter destroys
nothing. If you want them coloured at rest that is a fine call — but write the exception down, or
the next time someone tidies the styling it will quietly go back.

**6. Search bar above the cohort dropdown.** *Blocks one Phase A item.* **Recommendation: the two
roster pages only.** On Groups & CRNs this reverses a deliberate change that moved the search
*down*, to sit directly over the list it filters. Two of the five screens with a cohort dropdown
have no search at all.

**7. A small control needs a second home.** The link between our semesters and the registrar's
terms can currently only be set on a page that switches itself off when the Student Hub is
unavailable — and the new timetable work is specifically designed to keep working without the Hub.
**Recommendation: add it** to Groups & CRNs next to the semester picker, as a second place to set
the same link. It stays where it is on Semesters; nothing is taken away.

**8. Should a shared language set block another cohort's publish?** Today a missing language group
blocks Foundation Year's publish simply because the language set was created under Foundation Year.
**Recommendation: no.** Nothing records who is *expected* to take a language, so turning this on
would block every publish on day one.

---

## What I would advise against

**Do not let a missing registrar timetable stop a publish.** Thirty sections currently have no
published times. Treat those as faults and every publish stops. This is the one change here capable
of breaking something that works today.

**Do not commission a query builder.** The filtering already in the product is stronger than it
looks: you can stack several conditions at once, exclude as well as include, and save a set of
filters as its own tab. The reason *"any physics student in L3 with languages on a Tuesday"* cannot
be asked is not that filtering is too weak — it is that "languages" and "Tuesday" are currently two
unrelated facts, so asking for both matches a student who takes languages *and separately* has
something on Tuesday. The fix is to record the pairing, not to build a new tool.

**Do not raise the pull speed.** It looks like a setting we could safely turn up. It is not: at the
faster speed the portal came back empty for about one section in seven, and we now write that
emptiness down as fact — so going faster would record classes as unscheduled that are not.

**Do not report a collision between two sections that both belong to other departments.** There is
one this semester, it affects one student, and neither section is ours to move. Reporting it is
permanent red that nobody can clear.

---

## Where to start

Phase A. Six real faults, visible to whoever uses the tool, nothing else waiting on them, and each
one gets a test written before the fix so it cannot come back.

Three answers would unblock it completely: decisions 1, 5 and 6. The other five can wait.
