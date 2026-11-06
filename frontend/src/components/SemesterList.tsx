import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CalendarPlus, Pencil } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { NewSemesterDialog, PlanSettingsDialog } from "@/components/PlanDialogs";
import { PayCycleCell } from "@/components/PayCycleCell";
import { PortalTermLink } from "@/components/PortalTermLink";
import { SemesterShortName } from "@/components/SemesterShortName";
import { SemesterTag } from "@/components/SemesterTag";
import { TermWeeksPanel } from "@/components/TermWeeksPanel";
import { useStaffUser } from "@/components/useStaffUser";
import { fetchSemesterShortNames, fetchTermLinks, setSemesterShortName } from "@/services/portalLists";
import { createPlan, deletePlan, fetchPlan, fetchPlans, settlePlan, type PlanSettings, type PlanSummary } from "@/services/semesterPlans";
import { SemesterImport } from "@/components/SemesterImport";
import { SemesterPublish } from "@/components/SemesterPublish";
import { SemesterUpdate } from "@/components/SemesterUpdate";
import {
  TimetableTerm,
  deleteTimetableTerm,
  fetchHubTerms,
  renameTimetableTerm,
  setTimetableTermPublished,
} from "@/services/timetables";
import { fetchTermWeeks } from "@/services/termWeeks";
import { formatDayAndMonth, parseIsoDate } from "@/services/weekSchedule";

/**
 * One row of the list: a semester made here, or one uploaded to the Student Hub before that
 * was retired. Both are semesters of the app — the menus, the sets and the calendars find
 * either — and they are managed from this one list.
 */
type Row =
  | { kind: "hub"; id: string; name: string; code: string; term: TimetableTerm }
  | { kind: "own"; id: string; name: string; code: string; plan: PlanSummary };

const SECONDARY_BUTTON =
  "rounded-md border border-[#b7bec8] bg-white px-2 py-1.5 text-[13px] font-semibold text-[#344054] hover:bg-[#f8fafc]";
const DELETE_BUTTON =
  "rounded-md border border-[#e5b7b9] bg-white px-2 py-1.5 text-[13px] font-semibold text-[#a6292f] hover:bg-[#fdf3f3]";

/** "15 teaching weeks from 11 Jan 2027", or that they are still to be set. */
function weeksWords(plan: PlanSummary): string {
  if (!plan.weekOne || !plan.weeks) return "Teaching weeks not set yet";
  return `${plan.weeks} teaching week${plan.weeks === 1 ? "" : "s"} from ${formatDayAndMonth(plan.weekOne)} ${parseIsoDate(plan.weekOne).getFullYear()}`;
}

/** "Week 1 from 31 Aug 2026", for a semester whose weeks are counted but not numbered. */
function weekOneWords(weekOne: string): string {
  if (!weekOne) return "Week 1 not set yet";
  return `Week 1 from ${formatDayAndMonth(weekOne)} ${parseIsoDate(weekOne).getFullYear()}`;
}

/** A semester made here: its name, Week 1, teaching weeks, breaks and holidays, read when opened. */
function OwnSemesterSettings({ plan, onClose }: { plan: PlanSummary; onClose: () => void }) {
  const client = useQueryClient();
  const full = useQuery({ queryKey: ["plan", plan.termCode], queryFn: () => fetchPlan(plan.termCode) });
  const settle = useMutation({
    mutationFn: (settings: PlanSettings) => settlePlan(plan.termCode, settings),
    onSuccess: (fresh) => {
      client.setQueryData(["plan", plan.termCode], fresh);
      for (const key of ["plans", "timetable-terms", "term-links", "term-weeks"]) void client.invalidateQueries({ queryKey: [key] });
      onClose();
    },
  });
  if (!full.data) return null;
  return (
    <PlanSettingsDialog
      open
      plan={full.data}
      busy={settle.isPending}
      error={settle.error ? (settle.error as Error).message : ""}
      onSave={(settings) => settle.mutate(settings)}
      onClose={onClose}
    />
  );
}

/**
 * Every semester, and where each one is managed: made, named, given its weeks, deleted.
 *
 * A semester is made here, under the portal's code for it, and kept by Coordinator Tools.
 * The ones uploaded to the Student Hub before uploading was retired are listed beside them,
 * in the portal's order, with what can still be done to them on the Hub. The Semester plan
 * and the other pages pick a semester; none of them makes or changes one.
 */
export function SemesterList({
  host,
  hub = true,
  hubControls = false,
  onOpenWeek,
  onOpenPlan,
}: {
  host: string | null;
  /** Whether the Student Hub is connected, so its semesters can be listed beside these. */
  hub?: boolean;
  /**
   * What is done on the Hub itself — publishing, renaming or deleting one of its semesters,
   * and the notice about uploads. Hidden for now (6 November 2026); kept, with its tests.
   */
  hubControls?: boolean;
  /** Open this semester on the Timetable page, which is a page of its own now. */
  onOpenWeek?: (termId: string) => void;
  /** Open a semester made here on the Semester plan. */
  onOpenPlan?: (termCode: string) => void;
}) {
  const queryClient = useQueryClient();
  const isAdmin = Boolean(useStaffUser()?.isAdmin);
  // The Hub's semesters: what is done to them — publish, rename, delete — is done on the Hub.
  const terms = useQuery({ queryKey: ["hub-terms"], queryFn: fetchHubTerms, enabled: hub });
  // The semesters made here.
  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const shortNames = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false });
  // Where a Hub semester's Week 1 is, said under its name as a semester made here says its weeks.
  const weeks = useQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks, retry: false });
  const [creating, setCreating] = useState(false);
  const [settingsOf, setSettingsOf] = useState<Row | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [updating, setUpdating] = useState<TimetableTerm | null>(null);
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState<TimetableTerm | null>(null);
  const [renaming, setRenaming] = useState<TimetableTerm | null>(null);
  const [newName, setNewName] = useState("");
  // An update starts as a dialog over this list and takes the screen once it has a diff.
  const [updateStage, setUpdateStage] = useState<"pick" | "review">("pick");

  const refresh = () => {
    for (const key of ["hub-terms", "plans", "term-links", "term-weeks", "semester-short-names"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    return queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });
  };

  // In the portal's order — 262710 before 262720 — and a semester with no code last.
  const rows = useMemo<Row[]>(() => {
    const linked = links.data ?? {};
    const held: Row[] = (hub ? terms.data ?? [] : []).map((term) => ({
      kind: "hub",
      id: term.id,
      name: term.name,
      code: linked[term.id] ?? "",
      term,
    }));
    const made: Row[] = (plans.data ?? []).map((plan) => ({
      kind: "own",
      id: plan.semesterId,
      name: plan.name || plan.termCode,
      code: plan.termCode,
      plan,
    }));
    return [...held, ...made].sort(
      (left, right) =>
        Number(!left.code) - Number(!right.code) || left.code.localeCompare(right.code) || left.name.localeCompare(right.name),
    );
  }, [hub, terms.data, plans.data, links.data]);
  const taken = useMemo(() => Object.fromEntries(rows.filter((row) => row.code).map((row) => [row.code, row.name])), [rows]);

  const createMutation = useMutation({
    mutationFn: async ({ termCode, name, short }: { termCode: string; name: string; short: string }) => {
      const made = await createPlan(termCode, name);
      if (short) await setSemesterShortName(made.semesterId, short);
      return made;
    },
    onSuccess: () => {
      setCreating(false);
      void refresh();
    },
  });
  const publishMutation = useMutation({
    mutationFn: ({ term, published }: { term: TimetableTerm; published: boolean }) =>
      setTimetableTermPublished(term.id, published),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (row: Row) => (row.kind === "hub" ? deleteTimetableTerm(row.term.id) : deletePlan(row.plan.termCode)),
    onSuccess: refresh,
  });
  const renameMutation = useMutation({
    mutationFn: ({ term, name }: { term: TimetableTerm; name: string }) => renameTimetableTerm(term.id, name),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
  });

  const error = publishMutation.error?.message ?? deleteMutation.error?.message ?? null;

  if (publishing) {
    const current = (terms.data ?? []).find((term) => term.id === publishing.id) ?? publishing;
    return <SemesterPublish term={current} onBack={() => setPublishing(null)} />;
  }

  const underUpdate = updating
    ? (terms.data ?? []).find((term) => term.id === updating.id) ?? updating
    : null;

  /*
   * The list stays put while a file is being picked, and stands aside for a diff.
   *
   * It hides rather than the update being returned early, because an early return would
   * mount a second SemesterUpdate the moment the stage changed — and the first one, the
   * one holding the diff, would be thrown away in the same breath.
   */
  const reviewing = underUpdate !== null && updateStage === "review";

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

      {reviewing ? null : (
        <section className="rounded-lg border border-[#d9dee7] bg-white">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] px-6 py-4">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} className="text-[#1f4e79]" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[#171717]">Semesters</h2>
            </div>
            {/*
              * Uploading to the Hub is retired, not deleted: `SemesterImport` and
              * `SemesterUpdate` are still here with their tests. A semester is made here now.
              */}
            <button
              type="button"
              onClick={() => {
                createMutation.reset();
                setCreating(true);
              }}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"
            >
              <CalendarPlus size={15} aria-hidden="true" /> New semester
            </button>
          </header>

          {hub && hubControls ? (
            <p className="border-b border-[#e4e8ef] bg-[#fdf9ee] px-6 py-3 text-sm text-[#8a6116]">
              {/* The notice stays said; the history of why is one hover away. */}
              <strong className="font-semibold">Uploading a timetable is retired.</strong> Clash hours come from the
              portal&apos;s own timetable, swept at the end of Portal sync. The semesters uploaded to the Student Hub
              before are kept below, so nothing is lost; a new one is made with New semester.{" "}
              <InfoTip label="Why uploading was retired">
                An uploaded file was a photograph taken in week one: out of date the moment a room moved, and only
                covering the cohorts whose file somebody made — 43 courses of 141 sections, which is why three cohorts
                in four reported no clashes and meant nothing by it.
              </InfoTip>
            </p>
          ) : null}

          {terms.error ? (
            <p role="alert" className="border-b border-[#e4e8ef] px-6 py-3 text-sm text-[#a6292f]">
              The Student Hub&apos;s semesters could not be read: {(terms.error as Error).message}
            </p>
          ) : null}

          {(hub && terms.isLoading) || plans.isLoading ? (
            <p className="px-6 py-8 text-sm text-[#667085]">Loading semesters…</p>
          ) : rows.length === 0 ? (
            <p className="px-6 py-8 text-sm text-[#667085]">No semester yet. Make one with New semester.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-[#667085]">
                  <tr>
                    <th scope="col" className="py-3 pl-6 pr-3 font-semibold">Semester</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Short name</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Portal term</th>
                    {/* What a part-time claim covers, which is the semester's to decide. */}
                    <th scope="col" className="px-3 py-3 font-semibold">Pay periods</th>
                    {hubControls ? <th scope="col" className="px-3 py-3 font-semibold">Student Hub</th> : null}
                    <th scope="col" className="py-3 pl-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#e4e8ef] align-top">
                      <td className="py-4 pl-6 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <SemesterTag short={shortNames.data?.[row.id] ?? ""} />
                          <span className="whitespace-nowrap font-semibold text-[#171717]">{row.name}</span>
                          {row.kind === "own" || hubControls ? (
                          <button
                            type="button"
                            aria-label={`Rename ${row.name}`}
                            title="Rename this semester"
                            onClick={() => {
                              if (row.kind === "own") {
                                setSettingsOf(row);
                                return;
                              }
                              setNewName(row.name);
                              renameMutation.reset();
                              setRenaming(row.term);
                            }}
                            className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
                          >
                            <Pencil size={13} aria-hidden="true" />
                          </button>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#667085]">
                          {row.kind === "own" ? weeksWords(row.plan) : hubControls ? row.term.timetableFilename : weekOneWords(weeks.data?.[row.id]?.weekOne ?? "")}
                        </span>
                      </td>
                      <td className="px-3 py-4">
                        {/* What the menus call it, in front of its name: S1, S2. Ours, not the Hub's. */}
                        <SemesterShortName termId={row.id} label={`Short name of ${row.name}`} />
                      </td>
                      <td className="px-3 py-4">
                        {row.kind === "own" ? (
                          // Made under it: the plan, its sets and its timetable are kept by this code.
                          <span className="tabular-nums text-[#344054]" title="The portal term this semester was made for">
                            {row.code}
                          </span>
                        ) : (
                          <PortalTermLink termId={row.id} />
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <PayCycleCell termId={row.id} termName={row.name} />
                      </td>
                      {hubControls ? (
                        <td className="px-3 py-4">
                          {row.kind === "own" ? (
                            <span className="text-xs text-[#98a2b3]">Not on it</span>
                          ) : (
                            <div className="grid gap-1.5">
                              <button
                                type="button"
                                onClick={() => publishMutation.mutate({ term: row.term, published: !row.term.isPublished })}
                                disabled={publishMutation.isPending}
                                className={
                                  row.term.isPublished
                                    ? "w-fit rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"
                                    : "w-fit rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                                }
                              >
                                {row.term.isPublished ? "Published" : "Hidden"}
                              </button>
                              <span className="text-xs tabular-nums text-[#667085]">
                                {row.term.courseCount} courses · {row.term.sessionCount} sessions · {row.term.studentCount} students
                              </span>
                              {/* What the Hub's students are shown of it: the Hub's own action, so it sits here. */}
                              <button
                                type="button"
                                onClick={() => setPublishing(row.term)}
                                className="w-fit text-xs font-semibold text-[#1f4e79] underline"
                              >
                                Publish
                              </button>
                            </div>
                          )}
                        </td>
                      ) : null}
                      <td className="py-4 pl-2 pr-4">
                        <div className="flex justify-end gap-1.5 whitespace-nowrap">
                          {row.kind === "own" ? (
                            <button type="button" onClick={() => onOpenPlan?.(row.code)} className={SECONDARY_BUTTON}>
                              Plan
                            </button>
                          ) : null}
                          {/* The whole department's week, which no other calendar shows. */}
                          <button
                            type="button"
                            onClick={() => onOpenWeek?.(row.id)}
                            title={`See every section of ${row.name} in one week`}
                            className={SECONDARY_BUTTON}
                          >
                            Timetable
                          </button>
                          <button
                            type="button"
                            aria-label={`Settings of ${row.name}`}
                            title="Its name, teaching weeks and holidays"
                            onClick={() => setSettingsOf(row)}
                            className={SECONDARY_BUTTON}
                          >
                            Settings
                          </button>
                          {row.kind === "own" || hubControls ? (
                            <button
                              type="button"
                              onClick={() => {
                                deleteMutation.reset();
                                setPendingDelete(row);
                              }}
                              className={DELETE_BUTTON}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <NewSemesterDialog
        open={creating}
        busy={createMutation.isPending}
        error={createMutation.error ? (createMutation.error as Error).message : ""}
        taken={taken}
        onCreate={(semester) => createMutation.mutate(semester)}
        onClose={() => setCreating(false)}
      />

      {settingsOf?.kind === "own" ? <OwnSemesterSettings plan={settingsOf.plan} onClose={() => setSettingsOf(null)} /> : null}
      <Modal
        open={settingsOf?.kind === "hub"}
        title={`Teaching weeks of ${settingsOf?.name ?? ""}`}
        description="Where Week 1 is, and the weeks without classes the count skips. Every calendar counts its weeks from them."
        onClose={() => setSettingsOf(null)}
        footer={
          <div className="flex justify-end">
            <button type="button" onClick={() => setSettingsOf(null)} className={SECONDARY_BUTTON}>
              Done
            </button>
          </div>
        }
      >
        {settingsOf?.kind === "hub" ? <TermWeeksPanel canChange={isAdmin} termId={settingsOf.id} /> : null}
      </Modal>

      <SemesterImport host={host} open={importing} onClose={() => setImporting(false)} />

      {underUpdate ? (
        <SemesterUpdate
          term={underUpdate}
          onBack={() => setUpdating(null)}
          onStage={setUpdateStage}
        />
      ) : null}

      <Modal
        open={renaming !== null}
        title="Rename this semester"
        description="Students' links to it keep working."
        onClose={() => setRenaming(null)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setRenaming(null)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!newName.trim() || renameMutation.isPending}
              onClick={() => renaming && renameMutation.mutate({ term: renaming, name: newName.trim() })}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {renameMutation.isPending ? "Saving…" : "Rename"}
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-[#344054]">
          Name
          <input
            aria-label="Semester name"
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && newName.trim() && renaming) renameMutation.mutate({ term: renaming, name: newName.trim() });
            }}
            className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
        {renameMutation.error ? (
          <p role="alert" className="mt-3 text-sm text-[#a6292f]">{(renameMutation.error as Error).message}</p>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this semester?"
        description={
          pendingDelete?.kind === "hub"
            ? `${pendingDelete.name} and its ${pendingDelete.term.sessionCount} sessions will be removed from the Student Hub. Students looking it up will stop finding their timetable. This cannot be undone.`
            : pendingDelete?.kind === "own"
              ? `${pendingDelete.name} and the ${pendingDelete.plan.series} class${pendingDelete.plan.series === 1 ? "" : "es"} placed on its plan will be deleted. A semester a cohort still has sets or students in is not deleted. This cannot be undone.`
              : ""
        }
        confirmLabel="Delete semester"
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
