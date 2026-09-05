import { useQuery } from "@tanstack/react-query";
import { ArrowRightCircle, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CohortActions } from "@/components/CohortActions";
import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentRoster } from "@/components/StudentRoster";
import {
  STATUS_FIELD,
  STATUS_OPTIONS,
  arrivalsFor,
  labelOf,
  rulesFor,
  sharedRules,
  unjudgeable,
  unplacedWarnings,
  warningsForCohort,
  type Arrival,
  type Change,
  type Options,
  type Rule,
  type Warning,
} from "@/services/discrepancies";
import { dismiss, isRegistrationKey, loadDismissed, pruneDismissed, restore } from "@/services/dismissals";
import { allChanges } from "@/services/pullHistory";
import { describeAge, latestPullAt, rowsHeld } from "@/services/rosterStore";
import { displayNameOf, fetchSchema, studentIdOf, type RosterRow } from "@/services/scenRosters";
import { fetchDiscrepancyRules, fetchStudents, type Cohort, type Student } from "@/services/studentDatabase";

/** The picker's entry for the reverse check: students the department has nowhere for. */
export const UNPLACED = "__unplaced__";

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
): { byCohort: Map<string, Warning[]>; unplaced: Warning[]; arrivals: Map<string, Arrival[]> } {
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
  return { byCohort, unplaced: unplacedWarnings({ students: placed, rules: sharedRules(rules), current, options }), arrivals };
}

/**
 * Where the portal and the department disagree, cohort by cohort.
 *
 * The same table as the Students page — columns, filters, search, copy presets, moving —
 * narrowed to one cohort and given a Warnings column. The rules are shared and live on
 * the server; the evidence is this browser's, because the server is never told a name.
 * So the page is only as fresh as this browser's last sync, and says so.
 */
export function CohortsPage({ cohorts }: { cohorts: Cohort[] }) {
  const [cohortId, setCohortId] = useState("");
  const [editingRules, setEditingRules] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

  // The same query the roster makes, so React Query answers both from one fetch.
  const students = useQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents("") });
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules });
  // The portal's code tables, so a rule on DEPT_CODE can read a row that carries DEPT_DESC.
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, staleTime: 60_000 });
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

  const byStudent = useMemo(() => {
    const out = new Map<string, Warning[]>();
    if (!judged) return out;
    const own = cohortId === UNPLACED ? judged.unplaced : (judged.byCohort.get(cohortId) ?? []);
    for (const warning of own) {
      const marked = dismissed.has(warning.key) ? { ...warning, dismissed: true } : warning;
      out.set(warning.studentId, [...(out.get(warning.studentId) ?? []), marked]);
    }
    return out;
  }, [judged, cohortId, dismissed]);

  // Dismissals that no longer point at anything are let go, so the store stays small.
  useEffect(() => {
    if (!byStudent.size) return;
    // Only this page's own: the registration dismissals belong to Course Registration.
    setDismissed(pruneDismissed([...byStudent.values()].flat().map((warning) => warning.key), (key) => !isRegistrationKey(key)));
  }, [byStudent.size]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * What the row carries. "Placed before placement was recorded" is true of everyone
   * placed before the moment was kept, so it is said once in the summary rather than on
   * every row; a dismissed warning is shown, struck through, only when asked for.
   */
  const warningsFor = useCallback(
    (studentId: string) =>
      (byStudent.get(studentId) ?? []).filter(
        (warning) => warning.kind !== "no_baseline" && (showDismissed || !warning.dismissed),
      ),
    [byStudent, showDismissed],
  );
  const onDismissWarning = useCallback(
    (key: string, toDismiss: boolean) => setDismissed(toDismiss ? dismiss(key) : restore(key)),
    [],
  );

  /** Students flagged in a cohort, not counting dismissed warnings or the no-baseline note. */
  const flaggedIn = (warnings: Warning[]) =>
    new Set(warnings.filter((warning) => warning.kind !== "no_baseline" && !dismissed.has(warning.key)).map((warning) => warning.studentId)).size;

  const all = [...byStudent.values()].flat();
  const flaggedStudents = flaggedIn(all);
  const unjudged = new Set(all.filter((warning) => warning.kind === "no_baseline").map((w) => w.studentId)).size;
  const dismissedCount = all.filter((warning) => warning.dismissed).length;
  const unplacedCount = students.data ? students.data.filter((student) => !student.cohortId).length : 0;
  const population = students.data
    ? students.data.filter((student) => (cohortId === UNPLACED ? !student.cohortId : student.cohortId === cohortId)).length
    : 0;
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
                const flagged = flaggedIn(judged?.byCohort.get(candidate.id) ?? []);
                return {
                  value: candidate.id,
                  label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                  badge: String(candidate.memberCount),
                  badgeTone: candidate.memberCount ? ("accent" as const) : ("muted" as const),
                  alert: flagged ? `${flagged} flagged` : undefined,
                };
              }),
              {
                value: UNPLACED,
                label: "Not in any cohort",
                badge: String(unplacedCount),
                badgeTone: unplacedCount ? ("accent" as const) : ("muted" as const),
                alert: judged?.unplaced.length ? `${flaggedIn(judged.unplaced)} flagged` : undefined,
              },
            ]}
          />
        </LabelledPicker>
        {/* The cohort's own settings — name, year, and what it expects — beside the cohort they act on. */}
        {cohort ? <CohortActions key={cohort.id} cohort={cohort} /> : null}

        {/* This cohort's own rules; the shared ones have their button at the page's title. */}
        {cohort ? (
          <button
            type="button"
            onClick={() => setEditingRules(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <Settings2 size={15} aria-hidden="true" />
            Rules for this cohort
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
        ) : cohortId !== UNPLACED ? (
          "This cohort states no major, term or year level, so it is judged on status alone. "
        ) : null}
        {flaggedStudents
          ? `${flaggedStudents} of ${population} ${cohortId === UNPLACED ? "unplaced students" : "students"} flagged.`
          : applied.length
            ? `Nothing to flag among ${population}.`
            : "No rules apply here — nothing counts as a discrepancy until you add one."}
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

      <div className="mt-3">
        {/*
          * Keyed on the cohort: switching cohorts is switching populations, and the
          * selection, filters and scroll of the last one should not carry over.
          */}
        <StudentRoster
          key={cohortId}
          cohorts={cohorts}
          viewId=""
          scope={{ cohortId: cohortId === UNPLACED ? null : cohortId }}
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
      <p className="mt-1.5 pl-6 text-xs text-[#5b7a9a]">Find them under “Not in any cohort” or their current cohort, and move them from the Students table — or dismiss the line if they are out on purpose.</p>
    </div>
  );
}
