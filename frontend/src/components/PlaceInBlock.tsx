import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { type FillCandidate, clashKey } from "@/services/groupFill";
import { type Walk, walkPlacements, walkSets } from "@/services/groupWalk";
import { fetchPublication } from "@/services/publication";
import { clashesIn } from "@/services/publicationView";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import {
  type Cohort,
  type PlacementReport,
  assignStudents,
  fetchAssignments,
  fetchCatalogue,
  groupIsRetired,
  placeStudents,
} from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/** Taking a student out of a block is a real choice, so it is an option and not a blank. */
const OUT = "__out__";

/**
 * Putting a selection of students into one group of one block.
 *
 * Until this existed a workbook was the only way anybody reached a group, which made
 * "this student moved to TD 4" a spreadsheet edit and a re-upload. A block belongs to a
 * cohort and a semester, so both are chosen here rather than guessed: the same code "TD"
 * means different groups in different semesters, and picking the wrong one silently gives
 * a student the other semester's timetable.
 */
export function PlaceInBlock({
  open,
  cohort,
  studentIds,
  opens,
  onClose,
  onPlaced,
}: {
  open: boolean;
  /**
   * The cohort every selected student belongs to.
   *
   * A cohort's own set takes only its own members. A set marked open to every cohort — the
   * languages — takes anybody, which is why they are offered here even though they live on
   * somebody else's row.
   */
  cohort: Cohort;
  studentIds: string[];
  /**
   * Which half the dialog lands on. The roster's bar names groups; a record's "Place in
   * every set" is asking for the other one, and landing on the wrong half would make the
   * button a lie about what it opens.
   */
  opens?: "by hand" | "proposed";
  onClose: () => void;
  /** `removed` when the group was "take them out", so the report can say so. */
  onPlaced: (report: PlacementReport & { removed: boolean }) => void;
}) {
  const [termId, setTermId] = useState("");
  /*
   * Two ways to answer one question, not two buttons on the toolbar.
   *
   * "Place in a group" and "Propose the groups" are the same act — a student arrives and
   * needs somewhere to sit in every set — differing only in who chooses. A third button
   * beside the other two would spend that decision one level too high, and the semester,
   * the cohort and the students are the same either way.
   */
  const [mode, setMode] = useState<"by hand" | "proposed">(opens ?? "by hand");
  /*
   * One row per set, because a student arriving mid-term needs a TD and a CM and a
   * language, and three passes through a dialog that forgets everything each time is how
   * one of them goes missing. The server already takes one set at a time and already says
   * whom it turned away, so this is N of the call it has always made.
   */
  const [rows, setRows] = useState<{ scopeId: string; groupId: string }[]>([{ scopeId: "", groupId: "" }]);
  const setRow = (index: number, patch: Partial<{ scopeId: string; groupId: string }>) =>
    setRows((held) => held.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  /*
   * With the sets open to every cohort, under a key of their own.
   *
   * Languages live on one cohort's row and are used by all of them, so asking only for
   * this cohort's own sets meant a language group could never be chosen here — the set
   * simply was not in the list. The key carries "with-shared" because WorkbookTools and
   * AddFromPortal read the same cohort and semester WITHOUT them: one key for two shapes
   * lets whichever landed first answer for both, and the languages would come and go
   * depending on what else had been open.
   */
  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId, "with-shared"],
    queryFn: () => fetchCatalogue(cohort.id, termId, true),
    enabled: open && Boolean(termId),
  });

  // Memoised because the walk depends on it: `?? []` is a fresh array every render, and
  // re-planning every keystroke is work nobody asked for.
  const scopes = useMemo(() => catalogue.data?.scopes ?? [], [catalogue.data]);
  const scopeOf = (id: string) => scopes.find((candidate) => candidate.id === id) ?? null;

  // A semester chosen in another screen means nothing here, so every row is dropped when
  // the semester changes rather than pointing at the old one's sets.
  useEffect(() => setRows([{ scopeId: "", groupId: "" }]), [termId]);

  /*
   * Everything the walk needs, and nothing unless it is being used.
   *
   * The clash report is the one that matters: without it the walk could seat somebody in
   * two rooms at once, so a proposal waits for it exactly as a fill does rather than
   * guessing. Names and majors live in this tab and nowhere on the server, which is why
   * the plan is made here at all.
   */
  const proposing = open && mode === "proposed" && Boolean(termId);
  const assignments = useQuery({
    queryKey: ["assignments", cohort.id],
    queryFn: () => fetchAssignments(cohort.id),
    enabled: proposing,
  });
  const publication = useQuery({
    queryKey: ["publication", termId],
    queryFn: () => fetchPublication(termId),
    enabled: proposing,
    retry: false,
  });
  const held = useQuery({
    queryKey: ["fields-held", "walk"],
    queryFn: async () => ({
      names: await namesHeld(),
      first: await fieldHeld("FIRST_NAME"),
      last: await fieldHeld("LAST_NAME"),
      program: await fieldHeld("MAJOR_CODE_DESC"),
    }),
    enabled: proposing,
    staleTime: 0,
  });

  const clashSet = useMemo(() => {
    const keys = new Set<string>();
    for (const clash of publication.data ? clashesIn(publication.data, cohort.id) : []) {
      if (clash.groups.length === 2) keys.add(clashKey(clash.groups[0].id, clash.groups[1].id));
    }
    return keys;
  }, [publication.data, cohort.id]);

  const candidates = useMemo<FillCandidate[]>(
    () =>
      studentIds.map((studentId) => ({
        studentId,
        first: held.data?.first[studentId] ?? "",
        last: held.data?.last[studentId] ?? "",
        program: held.data?.program[studentId] ?? "",
        // Every group they already hold, the sets this walk is not planning included —
        // those still say when the student is busy.
        held: { ...(assignments.data?.[studentId] ?? {}) },
      })),
    [studentIds, held.data, assignments.data],
  );

  const proposal = useMemo<Walk | null>(
    () =>
      proposing && catalogue.data && assignments.data && held.data && publication.data
        ? walkSets({ scopes, candidates, clashes: clashSet, order: "id", policy: "balanced", seed: 1 })
        : null,
    [proposing, catalogue.data, assignments.data, held.data, publication.data, scopes, candidates, clashSet],
  );

  const propose = useMutation({
    /*
     * One request per set, and each one is a write. A failure halfway leaves the earlier
     * sets already written, so what landed is named rather than swallowed — the obvious
     * retry would otherwise place them twice over.
     */
    mutationFn: async () => {
      let assigned = 0;
      const written: string[] = [];
      for (const step of walkPlacements(proposal ?? { steps: [], skipped: [] })) {
        const code = scopeOf(step.scopeId)?.code ?? "the set";
        try {
          const report = await placeStudents(step.scopeId, step.byGroup);
          assigned += report.assigned;
          written.push(code);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "That could not be completed.";
          throw new Error(written.length ? `${written.join(", ")} written. ${code} failed: ${reason}` : reason);
        }
      }
      return { assigned, skipped: [], removed: false };
    },
    onSuccess: (report) => onPlaced(report),
  });

  const chosen = rows.filter((row) => row.scopeId && row.groupId);

  const place = useMutation({
    /*
     * One request per set, in the order they were chosen, and each one is a write. A
     * failure halfway leaves the earlier sets already written, so what landed is named
     * rather than swallowed — otherwise the obvious retry places them twice over.
     */
    mutationFn: async () => {
      let assigned = 0;
      const skipped = new Set<string>();
      const written: string[] = [];
      for (const row of chosen) {
        const code = scopeOf(row.scopeId)?.code ?? "the set";
        try {
          const report = await assignStudents(row.scopeId, studentIds, row.groupId === OUT ? null : row.groupId);
          assigned += report.assigned;
          report.skipped.forEach((id) => skipped.add(id));
          written.push(code);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "That could not be completed.";
          throw new Error(written.length ? `${written.join(", ")} written. ${code} failed: ${reason}` : reason);
        }
      }
      return { assigned, skipped: [...skipped], removed: chosen.every((row) => row.groupId === OUT) };
    },
    onSuccess: (report) => onPlaced(report),
  });

  const ready = chosen.length === rows.length && chosen.length > 0 && studentIds.length > 0;
  const proposed = (proposal?.steps ?? []).reduce((count, step) => count + step.plan.placements.length, 0);
  const waiting = proposing && (catalogue.isLoading || assignments.isLoading || held.isLoading || publication.isLoading);
  const nameOf = (id: string) => held.data?.names[id] ?? id;

  return (
    <Modal
      open={open}
      title={
        mode === "by hand"
          ? `Place ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} in a group`
          : `Propose groups for ${studentIds.length} student${studentIds.length === 1 ? "" : "s"}`
      }
      description={
        mode === "by hand"
          ? `${cohort.name} · a student holds one group per set, so this replaces whatever they hold now.`
          : `${cohort.name} · one group in every set of the semester, and nothing already held is moved.`
      }
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          {mode === "by hand" ? (
            <button
              type="button"
              disabled={!ready || place.isPending}
              onClick={() => place.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {place.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              {chosen.length && chosen.every((row) => row.groupId === OUT) ? "Take them out" : `Place ${studentIds.length}`}
            </button>
          ) : (
            <button
              type="button"
              disabled={!proposed || propose.isPending}
              onClick={() => propose.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {propose.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
              Place {proposed} in {(proposal?.steps ?? []).filter((step) => step.plan.placements.length).length} set
              {(proposal?.steps ?? []).filter((step) => step.plan.placements.length).length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <SelectMenu
          label="Groups"
          value={mode}
          options={[
            { value: "by hand", label: "I'll name the groups" },
            { value: "proposed", label: "Propose them" },
          ]}
          onChange={(value) => setMode(value as "by hand" | "proposed")}
        />

        <SelectMenu
          label="Semester"
          value={termId}
          placeholder="Which semester…"
          options={(terms.data ?? []).map((term) => ({ value: term.id, label: term.name }))}
          onChange={setTermId}
        />

        {mode === "proposed" ? (
          <Proposed
            walk={proposal}
            termChosen={Boolean(termId)}
            waiting={waiting}
            blind={proposing && !publication.isLoading && !publication.data}
            nameOf={nameOf}
            labelOf={(scopeId: string, groupId: string) =>
              scopeOf(scopeId)?.groups.find((group) => group.id === groupId)?.label ?? groupId
            }
          />
        ) : null}

        {mode === "proposed" ? null : rows.map((row, index) => {
          const scope = scopeOf(row.scopeId);
          // A set already spoken for by another row is not offered again: two rows on one
          // set would be two writes to the same place, and the second would win silently.
          const taken = new Set(rows.filter((_, at) => at !== index).map((other) => other.scopeId));
          // Numbered only once there is something to number: one set is "Block", not "Block 1".
          const nth = rows.length > 1 ? ` ${index + 1}` : "";
          return (
            <div key={index} className="space-y-4 border-t border-[#eef1f5] pt-4 first:border-0 first:pt-0">
              <SelectMenu
                label={`Block${nth}`}
                value={row.scopeId}
                placeholder={termId ? "Which set…" : "Choose a semester first"}
                options={scopes
                  .filter((candidate) => !taken.has(candidate.id))
                  .map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name ? `${candidate.code} · ${candidate.name}` : candidate.code,
                    badge: `${candidate.groups.length} group${candidate.groups.length === 1 ? "" : "s"}`,
                  }))}
                onChange={(value) => setRow(index, { scopeId: value, groupId: "" })}
                disabled={!termId || catalogue.isLoading}
              />

              <SelectMenu
                label={`Group${nth}`}
                value={row.groupId}
                placeholder={row.scopeId ? "Which group…" : "Choose a set first"}
                options={[
                  // A group whose every section is retired teaches nobody; offering it is
                  // how somebody gets placed into a set that has stopped running.
                  ...(scope?.groups ?? []).filter((group) => !groupIsRetired(group)).map((group) => ({
                    value: group.id,
                    label: `Group ${group.label}`,
                    // An empty group says nothing rather than a bare "0", which reads as a label.
                    badge: group.capacity
                      ? `${group.assigned}/${group.capacity}`
                      : group.assigned
                        ? `${group.assigned} placed`
                        : undefined,
                    badgeTone: group.capacity && group.assigned >= group.capacity ? ("muted" as const) : undefined,
                  })),
                  ...(row.scopeId ? [{ value: OUT, label: "Take them out of this set" }] : []),
                ]}
                onChange={(value) => setRow(index, { groupId: value })}
                disabled={!row.scopeId}
              />

              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((held) => held.filter((_, at) => at !== index))}
                  className="text-sm font-semibold text-[#a6292f] hover:underline"
                >
                  Remove this set
                </button>
              ) : null}
            </div>
          );
        })}

        {mode === "by hand" && termId && rows.length < scopes.length ? (
          <button
            type="button"
            onClick={() => setRows((held) => [...held, { scopeId: "", groupId: "" }])}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            <Plus size={15} aria-hidden="true" /> Another set
          </button>
        ) : null}

        {mode === "by hand" && termId && !catalogue.isLoading && scopes.length === 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {cohort.name} has no sets in this semester yet. Define them on Group schema, or
              upload the group workbook, before placing anybody.
            </span>
          </p>
        ) : null}

        {place.error || propose.error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {((place.error ?? propose.error) as Error).message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * What the walk would do, set by set, before any of it is written.
 *
 * Reviewed rather than trusted, the same way a workbook upload is. Three things it has to
 * say out loud because they are true and would otherwise be discovered afterwards: a set
 * where every group is full is a partial answer and not an error; capacity is a convention
 * this browser applies, so a fill running elsewhere at the same moment can still overfill;
 * and the write is one request per set, so a failure halfway leaves the earlier sets done.
 */
function Proposed({
  walk,
  termChosen,
  waiting,
  blind,
  nameOf,
  labelOf,
}: {
  walk: Walk | null;
  termChosen: boolean;
  waiting: boolean;
  blind: boolean;
  nameOf: (studentId: string) => string;
  labelOf: (scopeId: string, groupId: string) => string;
}) {
  if (!termChosen) return <Note>Choose a semester: the same code means different groups in different ones.</Note>;
  if (blind) {
    return (
      <Note>
        The timetable&apos;s word on clashes is not in — the registrar&apos;s sweep and the Student Hub were both
        silent. Proposing waits for it rather than risk two rooms at once.
      </Note>
    );
  }
  if (waiting || !walk) return <p className="text-sm text-[#667085]">Reading the sets and what everyone holds…</p>;

  const placing = walk.steps.filter((step) => step.plan.placements.length > 0);
  const stuck = walk.steps.filter((step) => step.plan.unplaced.length > 0);
  if (!placing.length && !stuck.length && !walk.skipped.length) {
    return <Note>This semester has no sets to place anybody in yet.</Note>;
  }

  return (
    <div className="space-y-3">
      {placing.map((step) => (
        <div key={step.scopeId}>
          <p className="text-sm font-semibold text-[#344054]">
            {step.scopeCode}
            {step.scopeName && step.scopeName !== step.scopeCode ? (
              <span className="ml-1.5 font-normal text-[#98a2b3]">{step.scopeName}</span>
            ) : null}
          </p>
          <ul className="mt-0.5 space-y-0.5 text-sm" aria-label={`Proposed for ${step.scopeCode}`}>
            {step.plan.placements.map((placement) => (
              <li key={placement.studentId} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[#171717]">{nameOf(placement.studentId)}</span>
                <span className="text-[#667085]">
                  → Group {labelOf(step.scopeId, placement.groupId)}
                  {placement.why === "preferred" ? " · preferred" : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {stuck.length ? (
        <div className="rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
            Nowhere to put them in {stuck.length} set{stuck.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1" aria-label="Sets with nowhere to put them">
            {stuck.map((step) =>
              step.plan.unplaced.map((entry) => (
                <li key={`${step.scopeId}-${entry.studentId}`}>
                  {step.scopeCode} · {nameOf(entry.studentId)} — {entry.why}
                </li>
              )),
            )}
          </ul>
          <p className="mt-1 text-xs">The other sets are still placed; this one is left for a person.</p>
        </div>
      ) : null}

      {walk.skipped.length ? (
        <ul className="space-y-0.5 text-xs text-[#98a2b3]" aria-label="Sets left alone">
          {walk.skipped.map((skip) => (
            <li key={skip.scopeId}>
              <Wand2 size={11} className="mr-1 inline" aria-hidden="true" />
              {skip.scopeCode} — {skip.why}
            </li>
          ))}
        </ul>
      ) : null}

      {placing.length ? (
        <p className="text-xs text-[#98a2b3]">
          One request per set, so a failure halfway leaves the earlier ones written. Capacity is counted in this
          browser, so a fill running elsewhere at this moment could still overfill a group.
        </p>
      ) : null}
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
