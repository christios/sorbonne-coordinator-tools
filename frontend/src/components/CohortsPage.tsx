import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightCircle, ClipboardList, Layers, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CohortActions } from "@/components/CohortActions";
import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { LabelledPicker } from "@/components/LabelledPicker";
import { NewCohort } from "@/components/NewCohort";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentRoster } from "@/components/StudentRoster";
import {
  STATUS_FIELD,
  STATUS_OPTIONS,
  arrivalsFor,
  liveKeysOf,
  labelOf,
  registrationWarnings,
  rulesFor,
  sharedRules,
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
import { dismiss, loadDismissed, pruneDismissed, restore, restoreMany } from "@/services/dismissals";
import {
  describeMismatch,
  fetchRegistrationCheck,
  type Mismatch,
} from "@/services/portalLists";
import { allChanges } from "@/services/pullHistory";
import { describeAge, latestPullAt, rowsHeld } from "@/services/rosterStore";
import { displayNameOf, fetchSchema, studentIdOf, type RosterRow } from "@/services/scenRosters";
import { fetchDiscrepancyRules, fetchStudents, type Cohort, type Student } from "@/services/studentDatabase";

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

/** Which sources of warning the table is showing. */
type Showing = "all" | WarningSource;

/** "5 not registered · 2 in another section" — what the register's differences are. */
function describeKinds(mismatches: Mismatch[]): string {
  const said: Record<Mismatch["kind"], string> = {
    missing: "not registered in a section we placed them in",
    wrong: "registered in another section",
    extra: "registered in a section that is no group of theirs",
    unplaced: "registered in a course we have not placed them in",
    doubled: "registered in two groups of one set",
  };
  const counted = new Map<Mismatch["kind"], number>();
  for (const mismatch of mismatches) counted.set(mismatch.kind, (counted.get(mismatch.kind) ?? 0) + 1);
  return [...counted.entries()].map(([kind, count]) => `${count} ${said[kind]}`).join(" · ");
}

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
  onShow,
  counts,
}: {
  showing: Showing;
  onShow: (next: Showing) => void;
  counts: Record<Showing, number>;
}) {
  const options: { id: Showing; name: string; icon: typeof Layers; hint: string }[] = [
    { id: "all", name: "All", icon: Layers, hint: "Both records" },
    { id: "record", name: "Admissions", icon: AlertTriangle, hint: "Where the portal's record and ours have drifted apart" },
    { id: "registration", name: "Register", icon: ClipboardList, hint: "Where the registrar has them in other sections than we placed them in" },
  ];
  return (
    <div
      role="group"
      aria-label="Which warnings to show"
      title="A student flagged by both records is counted under both, so these do not add up"
      className="inline-flex rounded-md border border-[#d3d9e2] bg-white p-0.5"
    >
      {options.map(({ id, name, icon: Icon, hint }) => (
        <button
          key={id}
          type="button"
          aria-pressed={showing === id}
          title={hint}
          onClick={() => onShow(id)}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold ${
            showing === id ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085] hover:bg-[#f6f8fb]"
          }`}
        >
          <Icon size={12} aria-hidden="true" />
          {name}
          <span className="tabular-nums font-normal text-[#98a2b3]">{counts[id]}</span>
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
}: {
  cohorts: Cohort[];
  /**
   * A cohort and some of its students to land on — how Groups & CRNs hands over the
   * people a set has not placed. This is where placing happens, so this is where
   * "6 in no group" leads.
   */
  focus?: { cohortId: string; studentIds: string[] } | null;
}) {
  const [cohortId, setCohortId] = useState(focus?.cohortId ?? "");
  const [editingRules, setEditingRules] = useState(false);
  const sent = focus?.studentIds.join(",") ?? "";
  useEffect(() => {
    if (focus?.cohortId) setCohortId(focus.cohortId);
  }, [focus?.cohortId, sent]);
  const [showDismissed, setShowDismissed] = useState(false);
  const [showing, setShowing] = useState<Showing>("all");
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

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
  const registrationsBy = useMemo(
    () => new Map(cohorts.map((cohort, index) => [cohort.id, (checks[index]?.data ?? []) as Mismatch[]])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, checks.map((check) => check.dataUpdatedAt).join("|")],
  );
  // This browser's evidence: read once per visit. It has nothing to do with the rules.
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  useEffect(() => {
    let live = true;
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
    return () => {
      live = false;
    };
  }, []);

  // Land on a cohort rather than on nothing.
  useEffect(() => {
    if (cohortId) return;
    if (cohorts.length) setCohortId(cohorts[0].id);
  }, [cohorts, cohortId]);

  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;

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
        ...registrationWarnings(registrationsBy.get(cohort.id) ?? [], describeMismatch),
      ]);
    }
    return out;
  }, [cohorts, judged, registrationsBy]);

  const byStudent = useMemo(() => {
    const out = new Map<string, Warning[]>();
    for (const warning of byCohort.get(cohortId) ?? []) {
      const marked = dismissed.has(warning.key) ? { ...warning, dismissed: true } : warning;
      out.set(warning.studentId, [...(out.get(warning.studentId) ?? []), marked]);
    }
    return out;
  }, [byCohort, cohortId, dismissed]);

  /*
   * Dismissals that no longer point at anything are let go, so the store stays small.
   *
   * Against EVERY cohort's warnings and arrivals, not the cohort on screen. The table
   * shows one at a time, but the store is the coordinator's and spans all of them —
   * pruning against one cohort's keys quietly deleted every decision made about the
   * others, and every dismissed arrival with them, since arrivals are not on the table
   * at all. Only when `judged` is in, because a page with half its evidence cannot tell
   * a warning that is gone from one it cannot see yet.
   */
  const liveKeys = useMemo(() => {
    if (!judged) return null;
    return liveKeysOf(judged);
  }, [judged]);

  useEffect(() => {
    if (!liveKeys) return;
    setDismissed(pruneDismissed(liveKeys, "rule"));
  }, [liveKeys]);

  /*
   * And the register's family, pruned separately.
   *
   * Separately because the two rest on different evidence and can be incomplete at
   * different moments: the rules wait for this browser's pull history, the checks are one
   * request per cohort. `pruneDismissed` only ever removes keys of the family it is given,
   * so the two effects cannot undo each other however they interleave.
   *
   * And only once EVERY check has answered. A check is fetched per cohort with no retry,
   * so one that failed returns nothing at all — exactly the shape of a cohort with no
   * differences. Pruning on that reading would forget the coordinator's own decisions
   * because a request fell over. Absent is not gone.
   */
  const liveRegistrationKeys = useMemo(() => {
    if (checks.some((check) => check.isPending || check.isError)) return null;
    return [...registrationsBy.values()]
      .flat()
      .flatMap((mismatch) => registrationWarnings([mismatch], describeMismatch).map((warning) => warning.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationsBy, checks.map((check) => `${check.isPending}${check.isError}`).join("|")]);

  useEffect(() => {
    if (!liveRegistrationKeys) return;
    setDismissed(pruneDismissed(liveRegistrationKeys, "registration"));
  }, [liveRegistrationKeys]);

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
          (showing === "all" || sourceOf(warning) === showing),
      ),
    [byStudent, showDismissed, showing],
  );
  const onDismissWarning = useCallback(
    (key: string, toDismiss: boolean) => setDismissed(toDismiss ? dismiss(key) : restore(key)),
    [],
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

  const all = [...byStudent.values()].flat();
  const flaggedStudents = flaggedIn(all);
  const counts: Record<Showing, number> = {
    all: flaggedStudents,
    record: flaggedIn(all, "record"),
    registration: flaggedIn(all, "registration"),
  };
  const unjudged = new Set(all.filter((warning) => warning.kind === "no_baseline").map((w) => w.studentId)).size;
  const dismissedCount = all.filter((warning) => warning.dismissed).length;
  const population = students.data ? students.data.filter((student) => student.cohortId === cohortId).length : 0;

  /*
   * What the register says about this cohort — including when it has said nothing.
   *
   * A cohort whose check failed has no linked semester, or the request fell over; either
   * way it has not been checked, and "no differences" would be a lie of exactly the kind
   * this page exists to stop. So the four cases are told apart, and only one of them is
   * good news.
   */
  const mismatches = registrationsBy.get(cohortId) ?? [];
  const check = checks[cohorts.findIndex((candidate) => candidate.id === cohortId)];
  const registerSays = check?.isError
    ? "The register has not been checked here: this cohort has no linked semester, or the check could not be made."
    : check?.isPending
      ? "Still asking the register…"
      : mismatches.length
        ? `The register differs about ${counts.registration} of them — ${describeKinds(mismatches)}.`
        : "The register has every student in exactly the sections their groups give them — or nothing has been pulled for this cohort's semester yet.";
  const arrivals = cohort ? (judged?.arrivals.get(cohort.id) ?? []).filter((arrival) => !dismissed.has(arrival.key)) : [];
  const applied = cohort ? rulesFor(rules.data ?? [], cohort.id) : sharedRules(rules.data ?? []);
  const ownRules = cohort ? (rules.data ?? []).filter((rule) => rule.cohortId === cohort.id) : [];
  const silent = evidence && rules.data ? unjudgeable(rules.data.filter((rule) => rule.field !== STATUS_FIELD), evidence.carried) : [];
  const expects = cohort
    ? [
        cohort.majors.length ? `major ${cohort.majors.join(" or ")}` : "",
        cohort.terms.length ? `term ${cohort.terms.join(" or ")}` : "",
        cohort.yearLevel ? `year level ${cohort.yearLevel}` : "",
      ].filter(Boolean)
    : [];

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
        <LabelledPicker label="Cohort">
          <SelectMenu
            label="Cohort"
            value={cohortId}
            onChange={setCohortId}
            options={[
              ...cohorts.map((candidate) => {
                const flagged = flaggedIn(byCohort.get(candidate.id) ?? []);
                return {
                  value: candidate.id,
                  label: candidate.name,
                  year: candidate.term,
                  badge: String(candidate.memberCount),
                  badgeTone: candidate.memberCount ? ("accent" as const) : ("muted" as const),
                  alert: flagged ? `${flagged} flagged` : undefined,
                };
              }),
            ]}
          />
        </LabelledPicker>
        {/* The cohort's own settings — name, year, and what it expects — beside the cohort they act on. */}
        {cohort ? <CohortActions key={cohort.id} cohort={cohort} /> : null}
        {/* Making one, which until now could only happen as a side effect of moving students. */}
        <NewCohort onCreated={(created) => setCohortId(created.id)} />

        {/* This cohort's own rules; the shared ones have their button at the page's title. */}
        {cohort ? (
          <button
            type="button"
            onClick={() => setEditingRules(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <Settings2 size={15} aria-hidden="true" />
            Cohort rules
            <span className="tabular-nums text-xs font-normal text-[#98a2b3]" title="This cohort's own rules, on top of the shared ones">
              {ownRules.length}
            </span>
          </button>
        ) : null}
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        {evidence.asOf
          ? `As of this browser's last sync, ${describeAge(evidence.asOf)}. `
          : "This browser has never synced, so there is nothing to judge against. "}
        {expects.length ? (
          <>This cohort expects {expects.join(", ")}. </>
        ) : (
          "This cohort states no major, term or year level, so it is judged on status alone. "
        )}
        {flaggedStudents
          ? `${flaggedStudents} of ${population} students flagged.`
          : applied.length
            ? `Nothing to flag among ${population}.`
            : "No rules apply here — nothing counts as a discrepancy until you add one."}
        {cohort ? <> {registerSays}</> : null}
        {unjudged ? (
          <>
            {" "}
            {unjudged === population ? "All" : unjudged} {unjudged === 1 ? "was" : "were"} placed before the moment of
            placement was recorded, so change rules cannot judge them — only what is true now.
          </>
        ) : null}
        {dismissedCount ? (
          <>
            {" · "}
            <button type="button" onClick={() => setShowDismissed((current) => !current)} className="underline">
              {showDismissed ? "Hide" : "Show"} {dismissedCount} dismissed
            </button>
            {" · "}
            {/* Exactly the ones on screen — another cohort's, and another family's, stay put. */}
            <button
              type="button"
              onClick={() => setDismissed(restoreMany(all.filter((warning) => warning.dismissed).map((warning) => warning.key)))}
              className="underline"
            >
              Bring {dismissedCount} back
            </button>
          </>
        ) : null}
      </p>

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
          onDismiss={(key) => setDismissed(dismiss(key))}
        />
      ) : null}

      {/*
        * Which record to look at, directly above the table it narrows.
        *
        * Only once there is something to choose between — on a cohort with nothing wrong
        * it would be three zeroes and a question nobody asked.
        */}
      {counts.all ? (
        <div className="mt-3">
          <SourceFilter showing={showing} onShow={setShowing} counts={counts} />
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
          scope={{ cohortId }}
          warningsFor={warningsFor}
          onDismissWarning={onDismissWarning}
          defaultSort={{ key: "warnings", ascending: false }}
        />
      </div>

      {cohort ? (
        <DiscrepancyRulesEditor open={editingRules} scope={{ kind: "cohort", cohort }} onClose={() => setEditingRules(false)} />
      ) : null}
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
}: {
  cohort: Cohort;
  cohorts: Cohort[];
  arrivals: Arrival[];
  names: Map<string, string>;
  onDismiss: (key: string) => void;
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
      <p className="mt-1.5 pl-6 text-xs text-[#5b7a9a]">Find them in their current cohort, or on the Students table where a blank Cohort column is a filter of its own, and move them from there — or dismiss the line if they are out on purpose.</p>
    </div>
  );
}
