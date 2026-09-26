import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightCircle, CalendarClock, ClipboardList, EyeOff, Globe, GraduationCap, LayoutGrid, RotateCcw, Users, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useStaffUser } from "@/components/useStaffUser";
import { CohortActions } from "@/components/CohortActions";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoTip } from "@/components/InfoTip";
import { LabelledPicker } from "@/components/LabelledPicker";
import { NewCohort } from "@/components/NewCohort";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { RegistrationChangesButton } from "@/components/RegistrationChangesButton";
import { StudentRoster } from "@/components/StudentRoster";
import { WARNING_ICONS, WARNING_TONES } from "@/components/StudentTable";
import { useRemembered } from "@/components/useRemembered";
import { usePageState } from "@/components/usePageState";
import {
  STATUS_FIELD,
  STATUS_OPTIONS,
  arrivalsFor,
  labelOf,
  registrationWarnings,
  rulesFor,
  groupWarnings,
  electiveWarnings,
  exemptGroupWarnings,
  linkWarnings,
  sourceOf,
  unjudgeable,
  warningsForCohort,
  type Arrival,
  type Change,
  type Options,
  type Rule,
  type Warning,
  type WarningSource,
} from "@/services/discrepancies";
import { type Dismissal, dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";
import { describeMismatch, fetchRegistrationCheck, type Mismatch, type RegistrationReport } from "@/services/portalLists";
import { allChanges } from "@/services/pullHistory";
import { COHORT } from "@/services/remembered";
import { latestPullAt, rowsHeld } from "@/services/rosterStore";
import { displayNameOf, fetchSchema, studentIdOf, type RosterRow } from "@/services/scenRosters";
import {
  fetchAssignments,
  fetchCourseCards,
  fetchEveryExemption,
  fetchDiscrepancyRules,
  fetchStudents,
  setCohort,
  type Cohort,
  type Student,
} from "@/services/studentDatabase";
import { fetchPublication } from "@/services/publication";
import { afterPlacement } from "@/services/afterPlacement";
import { fetchTimetableTerms } from "@/services/timetables";
import { isRunning, subscribe } from "@/services/syncRun";

/** This browser's evidence: what the portal last said, and every change it has recorded. */
type Evidence = {
  current: Map<string, Record<string, string>>;
  names: Map<string, string>;
  changes: Map<string, Change[]>;
  /** Every field name any held row carries — what the rules can be judged on. */
  carried: Set<string>;
  asOf: number | null;
};

/** The warnings of every cohort at once, so the picker can count them beside the members. */
function judge(
  cohorts: Cohort[],
  students: Student[],
  rules: Rule[],
  evidence: Evidence,
  options: Options,
): { byCohort: Map<string, Warning[]>; arrivals: Map<string, Arrival[]> } {
  const placed = students.map((student) => ({ studentId: student.studentId, cohortId: student.cohortId, cohortSince: student.cohortSince }));
  // The status is this application's, so it joins the portal's fields here rather than in
  // a pull. A student this browser holds no row for is still nothing to judge by — unless
  // the portal has dropped them, which is the one fact about them the status does carry.
  const status = new Map(students.map((student) => [student.studentId, student.status]));
  const current = (id: string) => {
    const held = evidence.current.get(id);
    const state = status.get(id) ?? "";
    if (!held && state !== "not_in_portal") return undefined;
    return { ...(held ?? {}), [STATUS_FIELD]: state };
  };
  const changes = (id: string) => evidence.changes.get(id) ?? [];
  const byCohort = new Map<string, Warning[]>();
  const arrivals = new Map<string, Arrival[]>();
  for (const cohort of cohorts) {
    // The shared rules and this cohort's own; the outward look only when a rule asks for it.
    const own = rulesFor(rules, cohort.id);
    byCohort.set(cohort.id, warningsForCohort({ cohort, students: placed, rules: own, current, changes, options }));
    arrivals.set(cohort.id, arrivalsFor({ cohort, rules: own, students: placed, current, changes, options }));
  }
  return { byCohort, arrivals };
}

/** The three records to begin with — the old "All", and the commonest answer. */
const EVERY_RECORD: readonly WarningSource[] = ["record", "registration", "timetabling", "groups", "electives"];

/**
 * The three records, in the order the page's filter offers them.
 *
 * Named once here because two things read the list: the filter above the table, and the
 * cohort picker's per-record counts. Two lists would be two lists to keep in step.
 */
const RECORDS: { id: WarningSource; counted: string }[] = [
  { id: "record", counted: "with a record that has drifted from admissions" },
  { id: "registration", counted: "the portal has in other sections than we placed them in" },
  { id: "timetabling", counted: "booked into two places at one hour" },
  { id: "groups", counted: "we have not placed in a group of one of the sets" },
  { id: "electives", counted: "taking an elective no coordinator has approved" },
];

/**
 * The pill's few words for one verdict, and which record it belongs to.
 *
 * The clash of hours comes out of the same check as the registrations and is not one of
 * them: it is not a fault of the register, it is not chased with the registrar, and a
 * coordinator clearing registrations does not want it in the way. It is timetabling.
 */
const SAID: Record<Mismatch["kind"], { say: (mismatch: Mismatch) => string; source: WarningSource }> = {
  missing: { say: (m) => `${m.courseCode} not registered`, source: "registration" },
  wrong: { say: (m) => `${m.courseCode} elsewhere`, source: "registration" },
  extra: { say: (m) => `${m.courseCode} extra`, source: "registration" },
  unplaced: { say: (m) => `${m.courseCode} in no group`, source: "registration" },
  // The SET is what is doubled, and the course code here is the two group labels.
  doubled: { say: (m) => `${m.scopeCode} twice`, source: "registration" },
  // Which of ours, and when — the two things that tell one clash from another.
  collides: { say: (m) => `${m.courseCode} ${m.scopeCode}`, source: "timetabling" },
  exempt: {
    say: (m) => `${m.courseCode}${m.scopeCode ? ` (${m.scopeCode})` : ""} exempt, still registered`,
    source: "registration",
  },
};

/**
 * The few words a verdict's pill shows: the kind, and the one thing that identifies it.
 *
 * Not the bare kind — six rows all reading "not registered" say only that something is
 * wrong six times — and not the whole sentence, which the cell has no room for. The course
 * code or the slot is what tells one from another at a glance; everything else is a hover
 * or a click into the record away.
 */
const readMismatch = (mismatch: Mismatch) => ({
  label: SAID[mismatch.kind].say(mismatch),
  source: SAID[mismatch.kind].source,
});

/**
 * Which of the two records the table is showing, with how many students each has flagged.
 *
 * Not a tidying-up: the two questions are chased with different people, and a coordinator
 * working through the register's differences does not want thirty major-code warnings in
 * the way. The counts are of STUDENTS, so they do not add up — somebody can be flagged by
 * both, and is counted under both.
 */
function SourceFilter({
  showing,
  onToggle,
  counts,
}: {
  /** The records whose warnings are shown. Any combination; none shows nothing. */
  showing: ReadonlySet<WarningSource>;
  onToggle: (id: WarningSource) => void;
  counts: Record<WarningSource, number>;
}) {
  /*
   * Three toggles, any combination — the same control as the "Registrations to change"
   * dialog, so the two read alike. There used to be an "All" beside them, which made the
   * three a choice of one; two records at once was not something the page could show.
   */
  const options: { id: WarningSource; name: string; icon: typeof AlertTriangle; hint: string }[] = [
    { id: "record", name: "Status", icon: AlertTriangle, hint: "Where the portal's record and ours have drifted apart" },
    { id: "registration", name: "Registration", icon: ClipboardList, hint: "Where the portal has them in other sections than we placed them in" },
    { id: "timetabling", name: "Timetabling", icon: CalendarClock, hint: "Where the hours a student is booked into cannot all be attended" },
    { id: "groups", name: "Groups", icon: LayoutGrid, hint: "Where we have not put a student in a group of one of the cohort's sets" },
    { id: "electives", name: "Electives", icon: GraduationCap, hint: "Courses outside the cohort's groups that no coordinator has approved yet — approve them on the student's record" },
  ];
  return (
    <div
      role="group"
      aria-label="Which warnings to show"
      title="A student flagged by both records is counted under both, so these do not add up"
      className="inline-flex gap-1 rounded-md border border-[#d3d9e2] bg-white p-1"
    >
      {options.map(({ id, name, icon: Icon, hint }) => (
        <button
          key={id}
          type="button"
          aria-pressed={showing.has(id)}
          title={hint}
          onClick={() => onToggle(id)}
          // On, it takes the colour its pills have in the table, so the toggle and what it shows read as one.
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
            showing.has(id) ? WARNING_TONES[id] : "text-[#98a2b3] hover:bg-[#f6f8fb]"
          }`}
        >
          <Icon size={12} aria-hidden="true" />
          {name}
          <span className={`tabular-nums font-normal ${showing.has(id) ? "opacity-75" : "text-[#98a2b3]"}`}>{counts[id]}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Where the portal and the department disagree about a cohort — in either record.
 *
 * The same table as the Students page — columns, filters, search, copy presets, moving —
 * narrowed to one cohort and given a Warnings column. The rules are shared and live on
 * the server; the evidence is this browser's, because the server is never told a name.
 * So the page is only as fresh as this browser's last sync, and says so.
 *
 * It carries BOTH halves of the registrar check, which used to be two pages:
 *
 *   - whether admissions still agrees with us about who this student is, and
 *   - whether the registrar has them registered in the sections we placed them in.
 *
 * One page because it is one question — "is this cohort right?" — and because they were
 * answered from the same table over the same students, so a coordinator was reading one
 * roster twice and holding the differences in their head. The two are told apart by
 * colour and icon in the cell, and can be looked at one at a time with the source filter;
 * the Warnings column ranks by the severity of the worst one rather than by how many
 * there are, so the register's small differences cannot bury a withdrawal.
 */
export function CohortsPage({
  cohorts,
  focus,
  onFocusTaken,
}: {
  cohorts: Cohort[];
  /**
   * A cohort and some of its students to land on — how Groups & CRNs hands over the
   * people a set has not placed. This is where placing happens, so this is where
   * "6 in no group" leads.
   */
  focus?: { cohortId: string; studentIds: string[] } | null;
  /** Said once those students are on screen, so the handover is not made twice. */
  onFocusTaken?: () => void;
}) {
  /*
   * The cohort, shared with every other page that asks for one.
   *
   * A coordinator works a year at a time — open L2 here, see what Capacity makes of it,
   * go to Groups & CRNs, come back — and this was the one cohort picker that kept its own
   * opinion, so the year was silently reset on the way in and on the way out. The contract
   * is `remembered.ts`, and this page had simply never joined it.
   */
  const [remembered, setRemembered] = useRemembered(COHORT);
  const [cohortId, setCohortId] = useState(focus?.cohortId ?? remembered);
  // Whether the table shows every cohort rather than the chosen one. Back to this one on
  // every change of cohort, as it was when the table remounted with its own switch.
  const [everywhere, setEverywhere] = usePageState("cohorts:everywhere", false);
  const chooseCohort = useCallback(
    (next: string) => {
      setCohortId(next);
      setRemembered(next);
      setEverywhere(false);
    },
    // `setRemembered` is rebuilt on every render by `useRemembered`, and naming it here
    // would rebuild this callback with it — which remounts the table, since it is keyed on
    // the cohort. The write is a localStorage put with no state of its own to go stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const sent = focus?.studentIds.join(",") ?? "";
  useEffect(() => {
    if (focus?.cohortId) chooseCohort(focus.cohortId);
  }, [focus?.cohortId, sent, chooseCohort]);
  const [showDismissed, setShowDismissed] = usePageState("cohorts:show-dismissed", false);
  // Kept as a list, which is what survives being written down; read as a set.
  const [showingList, setShowingList] = usePageState<WarningSource[]>("cohorts:showing", () => [...EVERY_RECORD]);
  const showing = useMemo(() => new Set(showingList), [showingList]);
  const setShowing = useCallback(
    (next: Set<WarningSource> | ((current: Set<WarningSource>) => Set<WarningSource>)) =>
      setShowingList((current) => [...(typeof next === "function" ? next(new Set(current)) : next)]),
    [setShowingList],
  );
  const toggleShowing = useCallback((id: WarningSource) => {
    setShowing((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setShowing]);
  /*
   * Taking an arrival in, from the banner that says they are due. The same move as the
   * Students table's, with the shared sets kept — the languages are the university's.
   */
  const client = useQueryClient();
  const me = useStaffUser();
  /*
   * Who has decided to live with what, for everybody.
   *
   * A read rather than this browser's own store: the decision belongs to the department,
   * so the next coordinator to open the page meets it already made, signed and dated.
   */
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals });
  const dismissed = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const decide = useMutation({
    mutationFn: async ({ keys, dismissed: on }: { keys: string[]; dismissed: boolean }) => {
      await Promise.all(keys.map((key) => setDismissal(key, on)));
    },
    /*
     * The pill answers the press, not the round trip.
     *
     * Dismissing is how a coordinator reads down a list of eighty warnings, so it has to
     * keep up with them; the page is drawn from the answer as though it had already
     * landed, and put back as it was if it did not.
     */
    onMutate: async ({ keys, dismissed: on }) => {
      await client.cancelQueries({ queryKey: ["warning-dismissals"] });
      const held = client.getQueryData<Dismissal[]>(["warning-dismissals"]) ?? [];
      const without = held.filter((entry) => !keys.includes(entry.key));
      const at = new Date().toISOString();
      client.setQueryData<Dismissal[]>(
        ["warning-dismissals"],
        on
          ? [...without, ...keys.map((key) => ({ key, byEmail: me?.email ?? "", byName: me?.name ?? "", at }))]
          : without,
      );
      return { held };
    },
    onError: (_error, _input, context) => {
      if (context) client.setQueryData(["warning-dismissals"], context.held);
    },
    // Whoever the server says decided, and when, which is the name the page then shows.
    onSettled: () => void client.invalidateQueries({ queryKey: ["warning-dismissals"] }),
  });

  // The same query the roster makes, so React Query answers both from one fetch.
  const students = useQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents("") });
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules });
  // The portal's code tables, so a rule on DEPT_CODE can read a row that carries DEPT_DESC.
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
  /*
   * The register's own verdict, per cohort. The comparison is the server's, because it
   * holds both the groups and the registrations as ids and CRNs and needs no name to make
   * it — unlike the rules above, which have to be judged in this browser.
   *
   * Every cohort, not only the one on screen, so the picker can say which ones need
   * attention. `retry: false` because a cohort with no linked semester has no answer to
   * give, and one refusal is enough to know that.
   */
  const checks = useQueries({
    queries: cohorts.map((cohort) => ({
      queryKey: ["registration-check", cohort.id],
      queryFn: () => fetchRegistrationCheck(cohort.id),
      retry: false,
    })),
  });
  const reportsBy = useMemo(
    () =>
      new Map(
        cohorts.map((cohort, index) => [
          cohort.id,
          (checks[index]?.data ?? { mismatches: [], coverage: [], electives: [] }) as RegistrationReport,
        ]),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, checks.map((check) => check.dataUpdatedAt).join("|")],
  );
  const registrationsBy = useMemo(
    () => new Map([...reportsBy].map(([cohortId, report]) => [cohortId, report.mismatches])),
    [reportsBy],
  );
  /*
   * Which semesters to ask about the groups, taken from the checks we already have.
   *
   * The register's coverage names the semesters each cohort is taught in, so the terms
   * come free rather than from another round of catalogue fetches. One publication covers
   * every cohort on that semester, which is why this is keyed on the term and not the
   * cohort.
   */
  const termIds = useMemo(
    () => [...new Set([...reportsBy.values()].flatMap((report) => report.coverage.map((term) => term.termId)))].sort(),
    [reportsBy],
  );
  const readiness = useQueries({
    queries: termIds.map((termId) => ({
      queryKey: ["publication", termId],
      queryFn: () => fetchPublication(termId),
      retry: false,
    })),
    combine: (reads) => ({
      terms: reads.map((read, index) => ({ termId: termIds[index], publication: read.data ?? null })),
      // Whether every semester has answered. A page with half its evidence must not prune
      // dismissals: absent and gone are not the same, and only one is a reason to forget.
      settled: reads.every((read) => !read.isPending),
      failed: reads.some((read) => read.isError),
    }),
  });
  /*
   * The courses outside our groups, by student, for the Electives column.
   *
   * Every cohort's at once and not the chosen one's, for the same reason the warnings are:
   * the table can be widened to every cohort, and a row from elsewhere must carry its own.
   * A course taught in two sections is one entry, because the column names courses.
   */
  const electivesBy = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const report of reportsBy.values()) {
      // Guarded: a browser holding new code against a server mid-deploy sees no field.
      for (const elective of report.electives ?? []) {
        const held = out.get(elective.studentId) ?? [];
        if (!held.includes(elective.courseCode)) held.push(elective.courseCode);
        out.set(elective.studentId, held);
      }
    }
    for (const [studentId, codes] of out) {
      out.set(studentId, [...codes].sort((left, right) => left.localeCompare(right, undefined, { numeric: true })));
    }
    return out;
  }, [reportsBy]);
  const electivesFor = useCallback((studentId: string) => electivesBy.get(studentId) ?? [], [electivesBy]);
  /*
   * The semesters' names, when the Student Hub can be reached.
   *
   * Cosmetic and only cosmetic: a semester with no name falls back to its portal term
   * code, and the coverage line is the same sentence either way. The Hub being down must
   * not be able to hide the fact that a cohort has not been checked, which is the one
   * thing this page is now for.
   */
  const termNames = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const nameOfTerm = useCallback(
    (termId: string) => (termNames.data ?? []).find((term) => term.id === termId)?.name ?? "",
    [termNames.data],
  );
  // This browser's evidence: read once per visit. It has nothing to do with the rules.
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void Promise.all([rowsHeld(), allChanges(), latestPullAt()]).then(([rows, changes, asOf]) => {
        if (!live) return;
        const current = new Map<string, Record<string, string>>();
        const names = new Map<string, string>();
        const carried = new Set<string>();
        for (const row of rows as RosterRow[]) {
          const id = studentIdOf(row);
          if (!id) continue;
          const flat: Record<string, string> = {};
          for (const [field, value] of Object.entries(row)) {
            const text = String(value ?? "");
            flat[field] = text;
            if (text.trim()) carried.add(field);
          }
          current.set(id, flat);
          names.set(id, displayNameOf(row));
        }
        setEvidence({ current, names, changes, carried, asOf });
      });
    load();
    /*
     * Read again once a portal sync has finished. The sync runs from the header without
     * remounting this page, and this was read once on mount — so a student the registrar
     * had moved went on being claimed by the cohort they left, from a row the browser no
     * longer held, until the page was reloaded. The student's own record, which reads the
     * fresh row, said L1 while this said FY.
     */
    const stop = subscribe((run) => {
      if (!isRunning(run)) load();
    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  // Land on a cohort rather than on nothing — the remembered one when it still exists,
  // and the first otherwise, so a deleted cohort does not leave the page empty for ever.
  useEffect(() => {
    if (!cohorts.length) return;
    if (cohorts.some((candidate) => candidate.id === cohortId)) return;
    chooseCohort(cohorts[0].id);
  }, [cohorts, cohortId, chooseCohort]);

  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const [addingArrival, setAddingArrival] = useState<Arrival | null>(null);
  const addArrival = useMutation({
    mutationFn: (arrival: Arrival) => setCohort([arrival.studentId], cohortId, true),
    onSuccess: () => {
      setAddingArrival(null);
      afterPlacement(client);
    },
  });

  const options: Options = useCallback(
    (field: string) =>
      field === STATUS_FIELD
        ? STATUS_OPTIONS
        : (schema.data?.fields.find((candidate) => candidate.key.toUpperCase() === field)?.options ?? []),
    [schema.data],
  );

  /** Every cohort judged, and this one's warnings by student, dismissed ones marked. */
  const judged = useMemo(() => {
    if (!evidence || !students.data || !rules.data) return null;
    return judge(cohorts, students.data, rules.data, evidence, options);
  }, [cohorts, evidence, students.data, rules.data, options]);

  /*
   * Every cohort's sets and who sits where, for the groups that do not go with the group
   * they are linked to. The course cards' reading, which every page already shares.
   */
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, retry: false });
  // Everybody's exemptions, for the group they are exempt from every course of.
  const everyExemption = useQuery({ queryKey: ["exemptions", "every"], queryFn: fetchEveryExemption, retry: false });
  const placements = useQueries({
    queries: cohorts.map((cohort) => ({
      queryKey: ["assignments", cohort.id],
      queryFn: () => fetchAssignments(cohort.id),
      retry: false,
    })),
  });
  const placedBy = useMemo(
    () => new Map(cohorts.map((cohort, index) => [cohort.id, placements[index]?.data ?? {}] as const)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, ...placements.map((read) => read.dataUpdatedAt)],
  );

  /**
   * Every cohort's warnings from both records, folded into one list per cohort.
   *
   * One list rather than two side by side, because the table takes one — and because the
   * cohort picker's "N flagged" has to mean a student who needs attention for any reason,
   * not a student who needs attention for one of the two reasons this page happens to be
   * looking at. The source survives on each warning, so nothing is lost by folding.
   */
  const byCohort = useMemo(() => {
    const out = new Map<string, Warning[]>();
    for (const cohort of cohorts) {
      out.set(cohort.id, [
        ...(judged?.byCohort.get(cohort.id) ?? []),
        ...registrationWarnings(registrationsBy.get(cohort.id) ?? [], describeMismatch, readMismatch),
        // The courses outside the groups nobody has said yes to. Guarded like the column:
        // a browser holding new code against a server mid-deploy sees no field.
        ...electiveWarnings(reportsBy.get(cohort.id)?.electives ?? []),
        // A set this cohort has not placed them in, per semester, from the same reading the
        // readiness panel publishes — so the two can never disagree about who is short.
        ...readiness.terms.flatMap(({ termId, publication }) => {
          const mine = publication?.cohorts.find((entry) => entry.cohortId === cohort.id);
          return mine ? groupWarnings(mine.unassigned, termId, nameOfTerm(termId)) : [];
        }),
        // A group that does not go with their group in the set it is linked to.
        ...linkWarnings(
          catalogues.data?.find((held) => held.cohort.id === cohort.id)?.scopes ?? [],
          placedBy.get(cohort.id) ?? {},
        ),
        // A group they are exempt from every course of. The shared sets count too: a
        // language group is on another cohort's row and taken by this one's students.
        ...exemptGroupWarnings(
          [
            ...(catalogues.data?.find((held) => held.cohort.id === cohort.id)?.scopes ?? []),
            ...(catalogues.data ?? []).filter((held) => held.cohort.id !== cohort.id).flatMap((held) => held.scopes.filter((scope) => scope.openToAll)),
          ],
          placedBy.get(cohort.id) ?? {},
          everyExemption.data ?? [],
        ),
      ]);
    }
    return out;
  }, [cohorts, judged, registrationsBy, reportsBy, readiness.terms, nameOfTerm, catalogues.data, placedBy, everyExemption.data]);

  /*
   * Every cohort's warnings by student, not only the cohort on screen.
   *
   * The table is normally narrowed to one cohort, so this reads the same — a student
   * belongs to one cohort and is judged by that cohort's rules, so there is nothing to
   * collide. It matters when the search beside the table is widened to every cohort: a row
   * from elsewhere must carry its own warnings, or looking outside the cohort would
   * quietly report everybody else as clean.
   */
  const byStudent = useMemo(() => {
    const out = new Map<string, Warning[]>();
    for (const warning of [...byCohort.values()].flat()) {
      const held = dismissed.get(warning.key);
      const marked = held
        ? { ...warning, dismissed: true, dismissedBy: held.byName || held.byEmail, dismissedAt: held.at }
        : warning;
      out.set(warning.studentId, [...(out.get(warning.studentId) ?? []), marked]);
    }
    return out;
  }, [byCohort, dismissed]);

  /** This cohort's own, which is what every count and sentence on the page is about. */
  const mine = useMemo(() => {
    const keys = new Set((byCohort.get(cohortId) ?? []).map((warning) => warning.key));
    return [...byStudent.values()].flat().filter((warning) => keys.has(warning.key));
  }, [byStudent, byCohort, cohortId]);

  /*
   * Nothing prunes the dismissals.
   *
   * Three careful effects used to delete dismissals whose warning had gone, one per
   * family, each guarding against pruning on half-arrived evidence — because the store was
   * this browser's and had to stay small. The list is the department's now, one row per
   * decision ever made, and a row nothing matches any more is dead weight rather than a
   * fault. Pruning a shared list would be the dangerous act the guards were holding off:
   * each browser judges "gone" from its own evidence, so one of them would throw away
   * decisions made against warnings only another can see.
   */

  /*
   * What the row carries. "Placed before placement was recorded" is true of everyone
   * placed before the moment was kept, so it is said once in the summary rather than on
   * every row; a dismissed warning is shown, struck through, only when asked for.
   */
  const warningsFor = useCallback(
    (studentId: string) =>
      (byStudent.get(studentId) ?? []).filter(
        (warning) =>
          warning.kind !== "no_baseline" &&
          (showDismissed || !warning.dismissed) &&
          showing.has(sourceOf(warning)),
      ),
    [byStudent, showDismissed, showing],
  );
  const onDismissWarning = useCallback(
    (key: string, toDismiss: boolean) => decide.mutate({ keys: [key], dismissed: toDismiss }),
    [decide],
  );

  /**
   * Students flagged in a cohort, not counting dismissed warnings or the no-baseline note.
   * With a source, only that record's; without one, either.
   */
  const flaggedIn = (warnings: Warning[], source?: WarningSource) =>
    new Set(
      warnings
        .filter((warning) => warning.kind !== "no_baseline" && !dismissed.has(warning.key))
        .filter((warning) => !source || sourceOf(warning) === source)
        .map((warning) => warning.studentId),
    ).size;

  const all = mine;
  const flaggedStudents = flaggedIn(all);
  const counts: Record<WarningSource, number> = {
    record: flaggedIn(all, "record"),
    registration: flaggedIn(all, "registration"),
    timetabling: flaggedIn(all, "timetabling"),
    groups: flaggedIn(all, "groups"),
    electives: flaggedIn(all, "electives"),
  };
  const dismissedCount = all.filter((warning) => warning.dismissed).length;

  const arrivals = cohort ? (judged?.arrivals.get(cohort.id) ?? []).filter((arrival) => !dismissed.has(arrival.key)) : [];
  const silent = evidence && rules.data ? unjudgeable(rules.data.filter((rule) => rule.field !== STATUS_FIELD), evidence.carried) : [];

  if (students.isLoading || rules.isLoading || !evidence) return <ScreenLoading label="Reading what the portal said…" />;
  if (students.error || rules.error) {
    return (
      <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
        {((students.error ?? rules.error) as Error).message}
      </p>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <LabelledPicker
          label="Cohort"
          hint={everywhere ? "showing every cohort" : undefined}
          beside={
            /*
             * One cohort, or all of them — asked where "which cohort" is asked, as a
             * two-way switch with both answers in view: the cohort mark for this one, the
             * globe for every one, and the chosen side filled in. One icon that swapped
             * read as a state nobody could name without pressing it.
             */
            <div
              role="radiogroup"
              aria-label="One cohort or every cohort"
              className="inline-flex h-10 shrink-0 items-center rounded-md border border-[#b7bec8] bg-white p-0.5"
            >
              {(
                [
                  { on: false, label: "This cohort", hint: "Only the chosen cohort's students", Icon: Users },
                  { on: true, label: "Every cohort", hint: "Every cohort's students, whichever is chosen", Icon: Globe },
                ] as const
              ).map(({ on, label, hint, Icon }) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={everywhere === on}
                  aria-label={label}
                  title={hint}
                  onClick={() => setEverywhere(on)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded transition-colors ${
                    everywhere === on ? "bg-[#1f4e79] text-white" : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#344054]"
                  }`}
                >
                  <Icon size={15} aria-hidden="true" />
                </button>
              ))}
            </div>
          }
        >
          {/*
            * With every cohort showing, the picker must not go on naming one as if the
            * table were still its: it reads "Every cohort" until a cohort is chosen, and
            * choosing one is what brings the table back to a single cohort.
            */}
          <SelectMenu
            label="Cohort"
            align="start"
            value={everywhere ? "" : cohortId}
            placeholder={everywhere ? "Every cohort" : undefined}
            onChange={chooseCohort}
            options={[
              ...cohorts.map((candidate) => {
                const held = byCohort.get(candidate.id) ?? [];
                return {
                  value: candidate.id,
                  label: candidate.name,
                  year: candidate.term,
                  badge: String(candidate.memberCount),
                  badgeTone: candidate.memberCount ? ("accent" as const) : ("muted" as const),
                  /*
                   * Counted by record rather than added up. "9 flagged" said that
                   * something is wrong nine times and nothing about what — and nine
                   * records drifting from admissions, nine registrations to key in and
                   * nine hours a student cannot attend are three different afternoons.
                   * Which cohort to open is often a choice of which of them to do.
                   *
                   * The counts are of STUDENTS, per record, so they do not add up: one
                   * person flagged by two records is counted under both.
                   */
                  flags: RECORDS.map((record) => ({
                    key: record.id,
                    count: flaggedIn(held, record.id),
                    title: record.counted,
                    icon: WARNING_ICONS[record.id],
                    className: WARNING_TONES[record.id],
                  })),
                };
              }),
            ]}
          />
        </LabelledPicker>
        {/* The cohort's own settings — name, year, and what it expects — beside the cohort they act on. */}
        {cohort ? <CohortActions key={cohort.id} cohort={cohort} /> : null}
        {/* Making one, which until now could only happen as a side effect of moving students. */}
        <NewCohort onCreated={(created) => chooseCohort(created.id)} />
      </div>

      {silent.length ? (
        <p role="status" className="mt-3 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-2.5 text-sm text-[#8a6116]">
          {silent.length === 1 ? "One rule cannot be judged" : `${silent.length} rules cannot be judged`}: no pull this browser
          holds carries {[...new Set(silent.map((rule) => labelOf(rule.field)))].join(", ")}. Sync the students again with the
          current extension, which asks the portal for the codes as well as the descriptions.
        </p>
      ) : null}

      {cohort && arrivals.length ? (
        <ArrivalsBanner
          cohort={cohort}
          cohorts={cohorts}
          arrivals={arrivals}
          names={evidence.names}
          onDismiss={(key) => decide.mutate({ keys: [key], dismissed: true })}
          onAdd={(arrival) => setAddingArrival(arrival)}
          adding={addArrival.isPending}
        />
      ) : null}
      {cohort && addingArrival ? (
        <ConfirmDialog
          open
          title={`Add ${evidence.names.get(addingArrival.studentId) || addingArrival.studentId} to ${cohort.name}?`}
          description={
            addingArrival.cohortId
              ? `They leave ${cohorts.find((candidate) => candidate.id === addingArrival.cohortId)?.name ?? "their cohort"} and lose the groups they held there. The shared sets stay.`
              : "They are in no cohort now, so nothing is lost."
          }
          confirmLabel={`Add to ${cohort.name}`}
          busy={addArrival.isPending}
          onConfirm={() => addArrival.mutate(addingArrival)}
          onClose={() => setAddingArrival(null)}
        />
      ) : null}

      {/*
        * Which record to look at, directly above the table it narrows.
        *
        * Only once there is something to choose between — on a cohort with nothing wrong
        * it would be three zeroes and a question nobody asked.
        */}
      {flaggedStudents || dismissedCount ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {flaggedStudents ? <SourceFilter showing={showing} onToggle={toggleShowing} counts={counts} /> : null}
          {/*
            * The dismissed warnings, beside the toggles that choose which warnings show —
            * the same kind of control, where they used to be two links at the end of a
            * sentence nobody reads to the end of.
            */}
          {dismissedCount ? (
            <div role="group" aria-label="Dismissed warnings" className="inline-flex gap-1 rounded-md border border-[#d3d9e2] bg-white p-1">
              <button
                type="button"
                aria-pressed={showDismissed}
                onClick={() => setShowDismissed((current) => !current)}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  showDismissed ? "bg-[#1f4e79] text-white" : "text-[#667085] hover:bg-[#f6f8fb]"
                }`}
              >
                <EyeOff size={12} aria-hidden="true" />
                Dismissed
                <span className={`tabular-nums font-normal ${showDismissed ? "text-white/75" : "text-[#98a2b3]"}`}>{dismissedCount}</span>
              </button>
              {/* Exactly the ones on screen — another cohort's, and another family's, stay put. */}
              <button
                type="button"
                disabled={decide.isPending}
                title={`Bring the ${dismissedCount} dismissed warning${dismissedCount === 1 ? "" : "s"} back`}
                onClick={() => decide.mutate({ keys: all.filter((warning) => warning.dismissed).map((warning) => warning.key), dismissed: false })}
                className="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold text-[#667085] transition-colors hover:bg-[#f6f8fb] disabled:opacity-50"
              >
                <RotateCcw size={12} aria-hidden="true" />
                Bring back
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3">
        {/*
          * Keyed on the cohort: switching cohorts is switching populations, and the
          * selection, filters and scroll of the last one should not carry over.
          */}
        <StudentRoster
          key={cohortId}
          cohorts={cohorts}
          viewId=""
          preselect={cohortId === focus?.cohortId ? focus.studentIds : []}
          /*
           * The registrar's worklist, beside Copy because it is the same gesture: take
           * what this page knows and hand it to somebody who acts on it.
           */
          tools={({ selected }) => (
            <RegistrationChangesButton
              selected={selected}
              cohorts={cohorts}
              cohortId={cohortId}
              cohortName={cohort?.name ?? ""}
              nameOf={(studentId) => evidence.names.get(studentId) ?? ""}
              // The portal's own year level for the student, which is not always the
              // cohort's — and where the two differ, that is the line to look at twice.
              yearOf={(studentId) => evidence.current.get(studentId)?.YEARLEVEL_CODE ?? ""}
              /*
               * The warnings this page has already judged, per cohort — including the
               * cohorts it is not showing, which is what makes "all cohorts" possible
               * without judging anything a second time.
               */
              warningsIn={(id) => (byCohort.get(id) ?? []).filter((warning) => !dismissed.has(warning.key))}
            />
          )}
          onPreselectTaken={onFocusTaken}
          scope={{ cohortId }}
          everywhere={everywhere}
          warningsFor={warningsFor}
          electivesFor={electivesFor}
          onDismissWarning={onDismissWarning}
          defaultSort={{ key: "warnings", ascending: false }}
        />
      </div>

    </section>
  );
}

/**
 * Students who belong to this cohort by its expectations and are not in it — what a
 * "belongs to the cohort" rule finds: the newly admitted, and the one taken out by hand.
 *
 * They are not rows of the cohort's table, since they are not in the cohort, so they are
 * listed above it; each can be dismissed like a row's warning, until the fact changes.
 */
function ArrivalsBanner({
  cohort,
  cohorts,
  arrivals,
  names,
  onDismiss,
  onAdd,
  adding,
}: {
  cohort: Cohort;
  cohorts: Cohort[];
  arrivals: Arrival[];
  names: Map<string, string>;
  onDismiss: (key: string) => void;
  /** Put this student into the cohort on screen, out of whatever cohort they are in. */
  onAdd: (arrival: Arrival) => void;
  adding: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? arrivals : arrivals.slice(0, 5);
  const where = (arrival: Arrival) =>
    arrival.cohortId ? `in ${cohorts.find((candidate) => candidate.id === arrival.cohortId)?.name ?? "another cohort"}` : "in no cohort";
  return (
    <div role="status" className="mt-3 rounded-md border border-[#bcd3ea] bg-[#eef5fb] px-4 py-3 text-sm text-[#1f4e79]">
      <p className="flex items-center gap-2 font-semibold">
        <ArrowRightCircle size={16} aria-hidden="true" />
        {arrivals.length === 1 ? "One student belongs" : `${arrivals.length} students belong`} to {cohort.name} by what it expects and{" "}
        {arrivals.length === 1 ? "is" : "are"} not in it.
        <InfoTip label="What adding them does">
          Adding moves them out of the cohort they are in and drops the groups they held there; the shared sets, the
          languages, stay. Dismiss the line if they are out on purpose.
        </InfoTip>
      </p>
      <ul className="mt-1.5 space-y-0.5 pl-6">
        {shown.map((arrival) => (
          <li key={arrival.key} className="flex items-start gap-2">
            <span>
              <span className="font-semibold">{names.get(arrival.studentId) || arrival.studentId}</span>{" "}
              <span className="font-mono text-xs text-[#5b7a9a]">{arrival.studentId}</span> — {arrival.major}
              {arrival.moved
                ? `, from ${arrival.moved.from} on ${new Date(arrival.moved.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
                : ""}
              , {where(arrival)}.
            </span>
            {/*
              * The move, from the line that says it is due. Finding them in their current
              * cohort or on the Students table was the same gesture with three pages in it.
              */}
            <button
              type="button"
              disabled={adding}
              aria-label={`Add ${names.get(arrival.studentId) || arrival.studentId} to ${cohort.name}`}
              onClick={() => onAdd(arrival)}
              className="shrink-0 rounded-md border border-[#bcd3ea] bg-white px-2 py-0.5 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
            >
              Add to {cohort.name}
            </button>
            <button
              type="button"
              aria-label={`Dismiss ${names.get(arrival.studentId) || arrival.studentId}`}
              title="Dismiss until their record changes again"
              onClick={() => onDismiss(arrival.key)}
              className="rounded p-0.5 text-[#5b7a9a] hover:bg-white hover:text-[#1f4e79]"
            >
              <X size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {arrivals.length > 5 ? (
        <button type="button" onClick={() => setOpen((current) => !current)} className="mt-1.5 pl-6 text-xs font-semibold underline">
          {open ? "Show fewer" : `Show all ${arrivals.length}`}
        </button>
      ) : null}
    </div>
  );
}
