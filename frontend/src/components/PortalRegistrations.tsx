import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { LabelledPicker } from "@/components/LabelledPicker";
import { ListGrid } from "@/components/ListGrid";
import { PortalFilterBar } from "@/components/PortalFilterBar";
import { SelectMenu } from "@/components/SelectMenu";
import { StudentRoster } from "@/components/StudentRoster";
import { registrationWarnings, type Warning } from "@/services/discrepancies";
import { dismiss, isRegistrationKey, loadDismissed, pruneDismissed, restore } from "@/services/dismissals";
import {
  describeMismatch,
  fetchPortalFilters,
  fetchRegistrationCheck,
  type Mismatch,
  type PortalFilter,
} from "@/services/portalLists";
import { describeAge, latestPullAt } from "@/services/rosterStore";
import type { PortalRoster, RosterRow } from "@/services/scenRosters";
import type { GridColumn } from "@/services/studentColumns";
import type { Cohort } from "@/services/studentDatabase";

const FILTER_KEY = "scen-portal-filter:registrations";

const field = (row: RosterRow, key: string) => String(row[key] ?? "");
const COLUMNS: GridColumn<RosterRow>[] = [
  { id: "SPRIDEN_ID", displayName: "ID", type: "text", accessor: (row) => field(row, "SPRIDEN_ID"), required: true, defaultWidth: 110 },
  { id: "FULL_NAME", displayName: "Student", type: "text", accessor: (row) => field(row, "FULL_NAME"), required: true, defaultWidth: 220 },
  { id: "YEARLEVEL_CODE", displayName: "Year", type: "option", accessor: (row) => field(row, "YEARLEVEL_CODE"), defaultWidth: 80 },
  { id: "MAJOR_CODE", displayName: "Major", type: "option", accessor: (row) => field(row, "MAJOR_CODE"), defaultWidth: 90 },
  { id: "DEPT_CODE", displayName: "Dept.", type: "option", accessor: (row) => field(row, "DEPT_CODE"), defaultWidth: 90 },
  { id: "LEVEL_CODE", displayName: "Level", type: "option", accessor: (row) => field(row, "LEVEL_CODE"), defaultWidth: 80 },
  { id: "COLLEGE_CODE", displayName: "College", type: "option", accessor: (row) => field(row, "COLLEGE_CODE"), defaultWidth: 90 },
  { id: "COURSE_CRN", displayName: "CRN", type: "text", accessor: (row) => field(row, "COURSE_CRN"), defaultWidth: 90 },
  { id: "COURSE_CODE", displayName: "Course", type: "option", accessor: (row) => field(row, "COURSE_CODE"), defaultWidth: 130 },
  { id: "COURSE_TITLE", displayName: "Title", type: "text", accessor: (row) => field(row, "COURSE_TITLE"), defaultWidth: 240 },
  { id: "TEACHER_NAME", displayName: "Teacher", type: "option", accessor: (row) => field(row, "TEACHER_NAME"), defaultWidth: 200 },
  { id: "TERM_CODE", displayName: "Term", type: "option", accessor: (row) => field(row, "TERM_CODE"), defaultWidth: 90 },
];
const SHOWN = ["SPRIDEN_ID", "FULL_NAME", "YEARLEVEL_CODE", "MAJOR_CODE", "COURSE_CRN", "COURSE_CODE", "COURSE_TITLE", "TEACHER_NAME"];

const idOf = (row: RosterRow) => `${field(row, "SPRIDEN_ID")}|${field(row, "COURSE_CRN")}`;
const labelOf = (row: RosterRow) => `${field(row, "FULL_NAME") || field(row, "SPRIDEN_ID")} in ${field(row, "COURSE_CRN")}`;

/** How many of a cohort's students the registrar has differently, dismissals aside. */
const flaggedIn = (mismatches: Mismatch[], dismissed: Set<string>) =>
  new Set(
    registrationWarnings(mismatches, describeMismatch)
      .filter((warning) => !dismissed.has(warning.key))
      .map((warning) => warning.studentId),
  ).size;

/** "5 not registered · 2 in another section" — what the differences are, in a phrase. */
function describeKinds(mismatches: Mismatch[]): string {
  const said: Record<Mismatch["kind"], string> = {
    missing: "not registered in a section we placed them in",
    wrong: "registered in another section",
    extra: "registered in a section that is no group of theirs",
    unplaced: "registered in a course we have not placed them in",
  };
  const counted = new Map<Mismatch["kind"], number>();
  for (const mismatch of mismatches) counted.set(mismatch.kind, (counted.get(mismatch.kind) ?? 0) + 1);
  return [...counted.entries()].map(([kind, count]) => `${count} ${said[kind]}`).join(" · ");
}

/**
 * Whether the registrar registered a cohort in what we teach it.
 *
 * The Cohorts page asks whether admissions still agrees with us about who a student is.
 * This one asks the other half: given that they are ours, are they registered in the
 * sections we put them in — every one of them, and nothing else. Same shape, so the
 * answer reads the same way: pick a cohort, and the students whose registrations differ
 * carry a line saying how, which can be dismissed once it has been dealt with.
 *
 * The comparison is the server's, because it holds both the groups and the registrations
 * as ids and CRNs. The pull that feeds it is here too: the portal's Student Courses list,
 * whose names never leave this tab.
 */
export function PortalRegistrations({ cohorts }: { cohorts: Cohort[] }) {
  const [cohortId, setCohortId] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());
  const [showDismissed, setShowDismissed] = useState(false);
  const [filterId, setFilterId] = useState(() => {
    try {
      return window.localStorage.getItem(FILTER_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [last, setLast] = useState<PortalRoster | null>(null);
  const filters = useQuery({ queryKey: ["portal-filters", "registrations"], queryFn: () => fetchPortalFilters("registrations") });
  const asOf = useQuery({ queryKey: ["latest-pull-at"], queryFn: latestPullAt });
  const chosen: PortalFilter | null = (filters.data ?? []).find((candidate) => candidate.id === filterId) ?? null;

  // Every cohort checked, so the picker can say which ones need attention — the same
  // reading the Cohorts picker gives. A cohort with no linked semester simply has none.
  const checks = useQueries({
    queries: cohorts.map((cohort) => ({
      queryKey: ["registration-check", cohort.id],
      queryFn: () => fetchRegistrationCheck(cohort.id),
      retry: false,
    })),
  });
  const byCohort = useMemo(
    () => new Map(cohorts.map((cohort, index) => [cohort.id, (checks[index]?.data ?? []) as Mismatch[]])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cohorts, checks.map((check) => check.dataUpdatedAt).join("|")],
  );

  useEffect(() => {
    if (!cohortId && cohorts.length) setCohortId(cohorts[0].id);
  }, [cohorts, cohortId]);

  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  const mismatches = useMemo(() => byCohort.get(cohortId) ?? [], [byCohort, cohortId]);

  const byStudent = useMemo(() => {
    const out = new Map<string, Warning[]>();
    for (const warning of registrationWarnings(mismatches, describeMismatch)) {
      const marked = dismissed.has(warning.key) ? { ...warning, dismissed: true } : warning;
      out.set(warning.studentId, [...(out.get(warning.studentId) ?? []), marked]);
    }
    return out;
  }, [mismatches, dismissed]);

  // Dismissals that no longer point at anything are let go — only ours; the Cohorts page
  // answers for its own.
  useEffect(() => {
    if (!byStudent.size) return;
    setDismissed(pruneDismissed([...byStudent.values()].flat().map((warning) => warning.key), isRegistrationKey));
  }, [byStudent.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const warningsFor = useCallback(
    (studentId: string) => (byStudent.get(studentId) ?? []).filter((warning) => showDismissed || !warning.dismissed),
    [byStudent, showDismissed],
  );
  const onDismissWarning = useCallback(
    (key: string, toDismiss: boolean) => setDismissed(toDismiss ? dismiss(key) : restore(key)),
    [],
  );

  const flagged = flaggedIn(mismatches, dismissed);
  const dismissedCount = [...byStudent.values()].flat().filter((warning) => warning.dismissed).length;
  const rows = last?.rows ?? [];

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-xl text-sm text-[#667085]">
          Every section they were placed in, and nothing else. The comparison is made on ids and CRNs; the
          names a pull carries stay in this tab.
          {chosen
            ? ` ${chosen.held} student${chosen.held === 1 ? "" : "s"} held for ${chosen.name}${chosen.lastSyncedAt ? "" : ", never synced"}.`
            : ""}
        </p>
        <PortalFilterBar
          kind="registrations"
          filterId={filterId}
          onChoose={(id) => {
            setFilterId(id);
            setLast(null);
            try {
              window.localStorage.setItem(FILTER_KEY, id);
            } catch {
              // fine
            }
          }}
          onPulled={(roster) => setLast(roster)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <LabelledPicker label="Cohort">
          <SelectMenu
            label="Cohort"
            value={cohortId}
            onChange={setCohortId}
            options={cohorts.map((candidate) => {
              const count = flaggedIn(byCohort.get(candidate.id) ?? [], dismissed);
              return {
                value: candidate.id,
                label: candidate.term ? `${candidate.name} — ${candidate.term}` : candidate.name,
                badge: String(candidate.memberCount),
                badgeTone: candidate.memberCount ? ("accent" as const) : ("muted" as const),
                alert: count ? `${count} flagged` : undefined,
              };
            })}
          />
        </LabelledPicker>
      </div>

      <p className="mt-3 text-xs text-[#98a2b3]">
        {asOf.data ? `Registrations as this browser last pulled them, ${describeAge(asOf.data)}. ` : ""}
        {mismatches.length ? (
          <>
            {flagged} of {cohort?.memberCount ?? 0} students differ — {describeKinds(mismatches)}.
          </>
        ) : cohort ? (
          "Every student is registered in exactly the sections their groups give them — or nothing has been pulled for this cohort's semester yet."
        ) : (
          "Choose a cohort."
        )}
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
        {/* Keyed on the cohort, so one cohort's selection and filters do not carry to the next. */}
        <StudentRoster
          key={cohortId}
          cohorts={cohorts}
          viewId=""
          scope={{ cohortId }}
          warningsFor={warningsFor}
          onDismissWarning={onDismissWarning}
          defaultSort={{ key: "warnings", ascending: false }}
        />
      </div>

      {rows.length ? (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-[#344054]">The last pull</h3>
          <p className="mb-2 mt-0.5 text-xs text-[#98a2b3]">
            What the portal returned just now, row per student and CRN. Shown from the pull itself and kept nowhere.
          </p>
          <ListGrid
            columns={COLUMNS}
            rows={rows}
            idOf={idOf}
            labelOf={labelOf}
            layoutKey="scen-columns:registrations:v1"
            presetKey="scen-copy-presets:registrations:v1"
            shown={SHOWN}
            initialSort={{ key: "FULL_NAME", ascending: true }}
            searchLabel="Search this pull"
            noun="registrations"
            empty="Nothing in this pull."
          />
        </div>
      ) : null}
    </section>
  );
}
