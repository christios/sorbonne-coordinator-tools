import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, EyeOff, RotateCcw, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { DiscrepancyRulesEditor } from "@/components/DiscrepancyRulesEditor";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import {
  describeWarning,
  unplacedWarnings,
  warningsForCohort,
  warningsText,
  type Change,
  type Rule,
  type Warning,
} from "@/services/discrepancies";
import { dismiss, loadDismissed, pruneDismissed, restore } from "@/services/dismissals";
import { allChanges } from "@/services/pullHistory";
import { describeAge, latestPullAt, rowsHeld } from "@/services/rosterStore";
import { displayNameOf, studentIdOf, type RosterRow } from "@/services/scenRosters";
import { fetchDiscrepancyRules, fetchStudents, type Cohort } from "@/services/studentDatabase";

/** The picker's entry for the reverse check: students the department has nowhere for. */
export const UNPLACED = "__unplaced__";

/**
 * Where the portal and the department disagree, cohort by cohort.
 *
 * The rules are shared and live on the server. The evidence — what the portal said, and
 * what it said before — lives in this browser, because the server is never told a name.
 * So the page is only as fresh as this browser's last sync, and says so.
 */
export function CohortsPage({
  cohorts,
  onShowStudents,
}: {
  cohorts: Cohort[];
  /** Open the Students table on these ids, where moving and removing already live. */
  onShowStudents: (ids: string[]) => void;
}) {
  const [cohortId, setCohortId] = useState("");
  const [editingRules, setEditingRules] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

  const students = useQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents("") });
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules });

  // This browser's evidence: read once per visit. It has nothing to do with the rules,
  // and re-reading every roster whenever the rules refetched — which opening the editor
  // does — made "Rules" feel like a page load.
  const [evidence, setEvidence] = useState<{
    current: Map<string, RosterRow>;
    changes: Map<string, Change[]>;
    asOf: number | null;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void Promise.all([rowsHeld(), allChanges(), latestPullAt()]).then(([rows, changes, asOf]) => {
      if (!live) return;
      const current = new Map<string, RosterRow>();
      for (const row of rows) {
        const id = studentIdOf(row);
        if (id) current.set(id, row);
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

  const rows = useMemo(() => {
    if (!evidence || !students.data || !rules.data) return [];
    const current = (id: string) => {
      const row = evidence.current.get(id);
      if (!row) return undefined;
      const flat: Record<string, string> = {};
      for (const [field, value] of Object.entries(row)) flat[field] = String(value ?? "");
      return flat;
    };
    const placed = students.data.map((student) => ({
      studentId: student.studentId,
      cohortId: student.cohortId,
      cohortSince: student.cohortSince,
    }));
    const ruleList: Rule[] = rules.data;

    const warnings =
      cohortId === UNPLACED
        ? unplacedWarnings({ students: placed, rules: ruleList, current })
        : cohort
          ? warningsForCohort({ cohort, students: placed, rules: ruleList, current, changes: (id) => evidence.changes.get(id) ?? [] })
          : [];

    const byStudent = new Map<string, Warning[]>();
    for (const warning of warnings) {
      byStudent.set(warning.studentId, [...(byStudent.get(warning.studentId) ?? []), warning]);
    }

    const population =
      cohortId === UNPLACED
        ? students.data.filter((student) => !student.cohortId)
        : students.data.filter((student) => student.cohortId === cohortId);

    return population
      .map((student) => {
        const row = evidence.current.get(student.studentId);
        const all = byStudent.get(student.studentId) ?? [];
        return {
          student,
          name: row ? displayNameOf(row) : "",
          warnings: all.filter((warning) => !dismissed.has(warning.key)),
          dismissedWarnings: all.filter((warning) => dismissed.has(warning.key)),
        };
      })
      .sort((left, right) => {
        // Trouble first, then by name, then id — so the top of the list is the work.
        const byTrouble = Number(right.warnings.length > 0) - Number(left.warnings.length > 0);
        if (byTrouble) return byTrouble;
        return (left.name || left.student.studentId).localeCompare(right.name || right.student.studentId);
      });
  }, [evidence, students.data, rules.data, cohortId, cohort, dismissed]);

  // Dismissals that no longer point at anything are let go, so the store stays small.
  useEffect(() => {
    if (!rows.length) return;
    const live = rows.flatMap((row) => [...row.warnings, ...row.dismissedWarnings].map((w) => w.key));
    setDismissed(pruneDismissed(live));
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Placed before placement was recorded" is true of every student placed before the
  // moment was kept, so it is said once, in the summary, rather than once per student.
  const isFlag = (warning: Warning) => warning.kind !== "no_baseline";
  const flagged = rows.filter((row) => row.warnings.some(isFlag));
  const unjudged = rows.filter((row) => row.warnings.some((warning) => warning.kind === "no_baseline")).length;
  // A student whose only warnings are dismissed drops out of the flagged list — which is
  // the point of dismissing — but has to come back when the dismissed are asked for, or
  // there is nowhere to undo it from.
  const shown = showAll
    ? rows
    : rows.filter((row) => row.warnings.some(isFlag) || (showDismissed && row.dismissedWarnings.length));
  const dismissedCount = rows.reduce((sum, row) => sum + row.dismissedWarnings.length, 0);

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
              })),
              { value: UNPLACED, label: "Not in any cohort" },
            ]}
          />
        </LabelledPicker>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setEditingRules(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <Settings2 size={15} aria-hidden="true" />
            Rules
            <span className="tabular-nums text-xs font-normal text-[#98a2b3]">{rules.data?.length ?? 0}</span>
          </button>
          <CopyButton
            label="Copy the warnings"
            text={() =>
              warningsText(
                flagged.map((row) => ({ studentId: row.student.studentId, name: row.name, warnings: row.warnings })),
              )
            }
            className="border border-[#b7bec8] bg-white p-2 hover:bg-[#f8fafc]"
          />
        </div>
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        {evidence.asOf
          ? `As of this browser's last sync, ${describeAge(evidence.asOf)}. `
          : "This browser has never synced, so there is nothing to judge against. "}
        {cohort?.program || cohort?.yearLevel ? (
          <>
            This cohort expects{" "}
            {[cohort.program, cohort.yearLevel].filter(Boolean).join(", ")}.{" "}
          </>
        ) : cohortId !== UNPLACED ? (
          "This cohort states no program or year, so it is judged on status alone. "
        ) : null}
        {flagged.length
          ? `${flagged.length} of ${rows.length} ${cohortId === UNPLACED ? "unplaced students" : "students"} flagged.`
          : rules.data?.length
            ? `Nothing to flag among ${rows.length}.`
            : "No rules yet — nothing counts as a discrepancy until you add one."}
        {unjudged ? (
          <>
            {" "}
            {unjudged === rows.length ? "All" : unjudged} {unjudged === 1 ? "was" : "were"} placed before the moment of
            placement was recorded, so change rules cannot judge {unjudged === 1 ? "them" : "them"} — only what is true now.
          </>
        ) : null}
        {rows.length > flagged.length ? (
          <>
            {" "}
            <button type="button" onClick={() => setShowAll((current) => !current)} className="underline">
              {showAll ? "Show only flagged" : "Show everyone"}
            </button>
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

      {shown.length === 0 ? (
        <p className="mt-6 rounded-md border border-dashed border-[#cbd5e1] px-4 py-8 text-center text-sm text-[#667085]">
          {rows.length === 0
            ? cohortId === UNPLACED
              ? "Every student we hold is in a cohort."
              : "Nobody is in this cohort yet."
            : "Nothing flagged. Everything the portal says matches what this cohort expects."}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[#eef1f5] rounded-md border border-[#d9dee7] bg-white">
          {shown.map((row) => (
            <li key={row.student.studentId} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
              <div className="w-56 shrink-0">
                <button
                  type="button"
                  onClick={() => onShowStudents([row.student.studentId])}
                  title="Open in the Students table, where moving and removing live"
                  className="text-left text-sm font-semibold text-[#1f4e79] hover:underline"
                >
                  {row.name || <span className="text-[#98a2b3]">name not pulled yet</span>}
                </button>
                <p className="text-xs tabular-nums text-[#667085]">{row.student.studentId}</p>
              </div>
              <ul className="min-w-0 flex-1 space-y-1">
                {row.warnings.filter(isFlag).map((warning) => (
                  <li key={warning.key} className="flex items-start gap-2 text-sm text-[#344054]">
                    <AlertTriangle
                      size={14}
                      className={`mt-0.5 shrink-0 ${warning.kind === "no_baseline" || warning.kind === "unplaced" ? "text-[#98a2b3]" : "text-[#b54708]"}`}
                      aria-hidden="true"
                    />
                    <span className="flex-1">
                      {describeWarning(warning)}
                      {warning.at ? (
                        <span className="text-[#98a2b3]"> · {describeAge(warning.at)}</span>
                      ) : null}
                    </span>
                    {warning.kind !== "no_baseline" ? (
                      <button
                        type="button"
                        aria-label={`Dismiss: ${describeWarning(warning)}`}
                        title="Dismiss until this student's record changes again"
                        onClick={() => setDismissed(dismiss(warning.key))}
                        className="rounded p-0.5 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#344054]"
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
                {showDismissed
                  ? row.dismissedWarnings.map((warning) => (
                      <li key={warning.key} className="flex items-start gap-2 text-sm text-[#98a2b3]">
                        <EyeOff size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        <span className="flex-1 line-through">{describeWarning(warning)}</span>
                        <button
                          type="button"
                          aria-label={`Restore: ${describeWarning(warning)}`}
                          onClick={() => setDismissed(restore(warning.key))}
                          className="rounded p-0.5 hover:bg-[#f2f7fb] hover:text-[#344054]"
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                        </button>
                      </li>
                    ))
                  : null}
                {!row.warnings.some(isFlag) && !(showDismissed && row.dismissedWarnings.length) ? (
                  <li className="text-sm text-[#98a2b3]">Nothing to flag.</li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <DiscrepancyRulesEditor open={editingRules} onClose={() => setEditingRules(false)} />
    </section>
  );
}
