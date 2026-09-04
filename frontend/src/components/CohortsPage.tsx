import { useQuery } from "@tanstack/react-query";
import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { unplacedWarnings, warningsForCohort, type Change, type Rule, type Warning } from "@/services/discrepancies";
import { dismiss, loadDismissed, pruneDismissed, restore } from "@/services/dismissals";
import { allChanges } from "@/services/pullHistory";
import { describeAge, latestPullAt, rowsHeld } from "@/services/rosterStore";
import { studentIdOf, type RosterRow } from "@/services/scenRosters";
import { fetchDiscrepancyRules, fetchStudents, type Cohort } from "@/services/studentDatabase";

/** The picker's entry for the reverse check: students the department has nowhere for. */
export const UNPLACED = "__unplaced__";

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

  // This browser's evidence: read once per visit. It has nothing to do with the rules.
  const [evidence, setEvidence] = useState<{
    current: Map<string, Record<string, string>>;
    changes: Map<string, Change[]>;
    asOf: number | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([rowsHeld(), allChanges(), latestPullAt()]).then(([rows, changes, asOf]) => {
      if (!live) return;
      const current = new Map<string, Record<string, string>>();
      for (const row of rows as RosterRow[]) {
        const id = studentIdOf(row);
        if (!id) continue;
        const flat: Record<string, string> = {};
        for (const [field, value] of Object.entries(row)) flat[field] = String(value ?? "");
        current.set(id, flat);
      }
      setEvidence({ current, changes, asOf });
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

  /** Every warning the rules produce, by student, dismissed ones marked. */
  const byStudent = useMemo(() => {
    const out = new Map<string, Warning[]>();
    if (!evidence || !students.data || !rules.data) return out;
    const placed = students.data.map((student) => ({
      studentId: student.studentId,
      cohortId: student.cohortId,
      cohortSince: student.cohortSince,
    }));
    const ruleList: Rule[] = rules.data;
    const current = (id: string) => evidence.current.get(id);
    const warnings =
      cohortId === UNPLACED
        ? unplacedWarnings({ students: placed, rules: ruleList, current })
        : cohort
          ? warningsForCohort({ cohort, students: placed, rules: ruleList, current, changes: (id) => evidence.changes.get(id) ?? [] })
          : [];
    for (const warning of warnings) {
      const marked = dismissed.has(warning.key) ? { ...warning, dismissed: true } : warning;
      out.set(warning.studentId, [...(out.get(warning.studentId) ?? []), marked]);
    }
    return out;
  }, [evidence, students.data, rules.data, cohortId, cohort, dismissed]);

  // Dismissals that no longer point at anything are let go, so the store stays small.
  useEffect(() => {
    if (!byStudent.size) return;
    setDismissed(pruneDismissed([...byStudent.values()].flat().map((warning) => warning.key)));
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

  const all = [...byStudent.values()].flat();
  const flaggedStudents = new Set(
    all.filter((warning) => warning.kind !== "no_baseline" && !warning.dismissed).map((warning) => warning.studentId),
  ).size;
  const unjudged = new Set(all.filter((warning) => warning.kind === "no_baseline").map((w) => w.studentId)).size;
  const dismissedCount = all.filter((warning) => warning.dismissed).length;
  const unplacedCount = students.data ? students.data.filter((student) => !student.cohortId).length : 0;
  const population = students.data
    ? students.data.filter((student) => (cohortId === UNPLACED ? !student.cohortId : student.cohortId === cohortId)).length
    : 0;

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
              ...cohorts.map((candidate) => ({
                value: candidate.id,
                label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                badge: String(candidate.memberCount),
                badgeTone: candidate.memberCount ? ("accent" as const) : ("muted" as const),
              })),
              {
                value: UNPLACED,
                label: "Not in any cohort",
                badge: String(unplacedCount),
                badgeTone: unplacedCount ? ("accent" as const) : ("muted" as const),
              },
            ]}
          />
        </LabelledPicker>

        <button
          type="button"
          onClick={() => setEditingRules(true)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Settings2 size={15} aria-hidden="true" />
          Rules
          <span className="tabular-nums text-xs font-normal text-[#98a2b3]">{rules.data?.length ?? 0}</span>
        </button>
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        {evidence.asOf
          ? `As of this browser's last sync, ${describeAge(evidence.asOf)}. `
          : "This browser has never synced, so there is nothing to judge against. "}
        {cohort?.program || cohort?.yearLevel ? (
          <>This cohort expects {[cohort.program, cohort.yearLevel].filter(Boolean).join(", ")}. </>
        ) : cohortId !== UNPLACED ? (
          "This cohort states no program or year, so it is judged on status alone. "
        ) : null}
        {flaggedStudents
          ? `${flaggedStudents} of ${population} ${cohortId === UNPLACED ? "unplaced students" : "students"} flagged.`
          : rules.data?.length
            ? `Nothing to flag among ${population}.`
            : "No rules yet — nothing counts as a discrepancy until you add one."}
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

      <DiscrepancyRulesEditor open={editingRules} onClose={() => setEditingRules(false)} />
    </section>
  );
}
