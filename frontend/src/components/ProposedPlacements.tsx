import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SelectMenu } from "@/components/SelectMenu";
import { type FillCandidate, clashKey } from "@/services/groupFill";
import { type Walk, walkPlacements, walkSets } from "@/services/groupWalk";
import { fetchPublication } from "@/services/publication";
import { clashesIn, unplacedIn } from "@/services/publicationView";
import { fieldHeld } from "@/services/rosterStore";
import { type Cohort, fetchAssignments, fetchCatalogue, placeStudents } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * What the platform proposes for the students a semester has not placed everywhere.
 *
 * A student who appears in a cohort with no groups, or a set added after the cohort was
 * filled, used to be a number on the readiness panel — "6 in no group" — and a person to
 * find and place by hand, set by set. This runs the same walk the placing dialog runs, over
 * everyone the semester's readiness names as missing from a set, and puts the result in
 * front of the coordinator as one batch: confirm it, untick a few, or close it. Nothing is
 * written until the confirmation, and it never follows the registrar's registrations — the
 * groups are ours to decide.
 *
 * Shown only when there is somebody to place. A cohort with everyone placed sees nothing.
 */
export function ProposedPlacements({
  cohort,
  nameOf,
  onPlaced,
}: {
  cohort: Cohort;
  nameOf: (studentId: string) => string;
  onPlaced: () => void;
}) {
  const [chosenTerm, setChosenTerm] = useState("");
  const [closed, setClosed] = useState<string>("");
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  // Every set of the cohort, whichever semester — to know which semesters have sets at all.
  const allSets = useQuery({ queryKey: ["catalogue", cohort.id, "", ""], queryFn: () => fetchCatalogue(cohort.id) });
  const termsWithSets = useMemo(() => {
    const held = new Set((allSets.data?.scopes ?? []).filter((scope) => !scope.openToAll).map((scope) => scope.termId ?? ""));
    return (terms.data ?? []).filter((term) => held.has(term.id));
  }, [terms.data, allSets.data]);
  const termId = chosenTerm || termsWithSets[0]?.id || "";

  const publication = useQuery({
    queryKey: ["publication", termId],
    queryFn: () => fetchPublication(termId),
    enabled: Boolean(termId),
    retry: false,
  });
  const missing = useMemo(() => (publication.data ? unplacedIn(publication.data, cohort.id).ids : []), [publication.data, cohort.id]);
  const wanted = missing.length > 0;

  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId, "with-shared"],
    queryFn: () => fetchCatalogue(cohort.id, termId, true),
    enabled: wanted,
  });
  const assignments = useQuery({ queryKey: ["assignments", cohort.id], queryFn: () => fetchAssignments(cohort.id), enabled: wanted });
  const programs = useQuery({
    queryKey: ["fields-held", "MAJOR_CODE_DESC"],
    queryFn: () => fieldHeld("MAJOR_CODE_DESC"),
    enabled: wanted,
    staleTime: 0,
  });

  const scopes = useMemo(() => catalogue.data?.scopes ?? [], [catalogue.data]);
  const clashSet = useMemo(() => {
    const keys = new Set<string>();
    for (const clash of publication.data ? clashesIn(publication.data, cohort.id) : []) {
      if (clash.groups.length === 2) keys.add(clashKey(clash.groups[0].id, clash.groups[1].id));
    }
    return keys;
  }, [publication.data, cohort.id]);
  const candidates = useMemo<FillCandidate[]>(
    () =>
      missing.map((studentId) => ({
        studentId,
        first: "",
        last: nameOf(studentId),
        program: programs.data?.[studentId] ?? "",
        held: { ...(assignments.data?.[studentId] ?? {}) },
      })),
    [missing, programs.data, assignments.data, nameOf],
  );
  const walk = useMemo<Walk | null>(
    () =>
      wanted && catalogue.data && assignments.data && programs.data
        ? walkSets({ scopes, candidates, clashes: clashSet, order: "id", policy: "balanced", seed: 1 })
        : null,
    [wanted, catalogue.data, assignments.data, programs.data, scopes, candidates, clashSet],
  );

  // The batch as the table shows it: one row per student, one cell per set proposed.
  const proposed = useMemo(() => {
    if (!walk) return { students: [] as string[], sets: [] as { scopeId: string; scopeCode: string }[], cell: new Map<string, string>() };
    const sets = walk.steps.filter((step) => step.plan.placements.length > 0).map((step) => ({ scopeId: step.scopeId, scopeCode: step.scopeCode }));
    const cell = new Map<string, string>();
    const students = new Set<string>();
    for (const step of walk.steps) {
      for (const placement of step.plan.placements) {
        students.add(placement.studentId);
        const group = scopes.flatMap((scope) => scope.groups).find((candidate) => candidate.id === placement.groupId);
        const major = group?.majors?.find((candidate) => candidate.id === placement.majorId);
        cell.set(`${step.scopeId}|${placement.studentId}`, `${group?.label ?? "?"}${major && (group?.majors ?? []).length > 1 ? ` · ${major.program}` : ""}`);
      }
    }
    return { students: [...students].sort((left, right) => nameOf(left).localeCompare(nameOf(right)) || left.localeCompare(right)), sets, cell };
  }, [walk, scopes, nameOf]);
  const stuck = walk ? walk.steps.flatMap((step) => step.plan.unplaced.map((entry) => ({ scopeCode: step.scopeCode, ...entry }))) : [];
  /*
   * Both lists are capped, because neither has a natural size.
   *
   * A cohort nobody has placed yet puts every student in every set on this panel: on a
   * semester whose placements had been wiped it drew nine hundred lines and pushed the
   * table it sits above off the bottom of the page. What a coordinator needs from the tail
   * is the count, and the reasons repeat.
   */
  const SHOWN = 12;
  const STUCK_SHOWN = 8;
  const kept = proposed.students.filter((studentId) => !dropped.has(studentId));

  const place = useMutation({
    /*
     * One request per set, each a write of the ticked students only. A failure halfway
     * leaves the earlier sets written, so what landed is named rather than swallowed.
     */
    mutationFn: async () => {
      let assigned = 0;
      const written: string[] = [];
      for (const step of walkPlacements(walk ?? { steps: [], skipped: [] })) {
        const byGroup: Record<string, string[]> = {};
        for (const [groupId, students] of Object.entries(step.byGroup)) {
          const mine = students.filter((studentId) => !dropped.has(studentId));
          if (mine.length) byGroup[groupId] = mine;
        }
        if (!Object.keys(byGroup).length) continue;
        const majors = Object.fromEntries(Object.entries(step.majors).filter(([studentId]) => !dropped.has(studentId)));
        const code = scopes.find((scope) => scope.id === step.scopeId)?.code ?? "the set";
        try {
          const report = await placeStudents(step.scopeId, byGroup, majors);
          assigned += report.assigned;
          written.push(code);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "That could not be completed.";
          throw new Error(written.length ? `${written.join(", ")} written. ${code} failed: ${reason}` : reason);
        }
      }
      return assigned;
    },
    onSuccess: () => {
      setConfirming(false);
      setDropped(new Set());
      onPlaced();
    },
  });

  // Closed for this batch: the same students missing from the same semester stay closed.
  const batchKey = `${termId}|${missing.join(",")}`;
  if (!termId || !wanted || closed === batchKey) return null;
  if (!walk) {
    return (
      <p role="status" className="mt-3 flex items-center gap-2 rounded-md border border-[#bcd3ea] bg-[#eef5fb] px-4 py-3 text-sm text-[#1f4e79]">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Working out where {missing.length === 1 ? "one student" : `${missing.length} students`} could go…
      </p>
    );
  }
  if (!proposed.students.length && !stuck.length) return null;

  return (
    <div role="status" className="mt-3 rounded-md border border-[#bcd3ea] bg-[#eef5fb] px-4 py-3 text-sm text-[#1f4e79]" aria-label="Proposed placements">
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <Wand2 size={16} aria-hidden="true" />
          {missing.length === 1 ? "One student is" : `${missing.length} students are`} missing from a set of {cohort.name}. Proposed, clash-free, seats per sub-row respected:
        </p>
        {termsWithSets.length > 1 ? (
          <div className="ml-auto w-44">
            <SelectMenu
              label="Semester"
              value={termId}
              onChange={(next) => {
                setChosenTerm(next);
                setDropped(new Set());
              }}
              options={termsWithSets.map((term) => ({ value: term.id, label: term.name }))}
            />
          </div>
        ) : null}
        <button
          type="button"
          aria-label="Close the proposals"
          title="Close until the semester's readiness changes"
          onClick={() => setClosed(batchKey)}
          className={`rounded p-0.5 text-[#5b7a9a] hover:bg-white hover:text-[#1f4e79] ${termsWithSets.length > 1 ? "" : "ml-auto"}`}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      {proposed.students.length ? (
        <div className="mt-2 overflow-x-auto rounded-md border border-[#bcd3ea] bg-white">
          <table className="w-full border-collapse text-sm text-[#344054]">
            <thead>
              <tr className="border-b border-[#dfe8f2] text-[11px] font-semibold uppercase tracking-wide text-[#5b7a9a]">
                <th scope="col" className="px-3 py-1.5 text-left">
                  <span className="sr-only">Include</span>
                </th>
                <th scope="col" className="px-3 py-1.5 text-left">Student</th>
                {proposed.sets.map((set) => (
                  <th key={set.scopeId} scope="col" className="px-3 py-1.5 text-left">{set.scopeCode}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(showAll ? proposed.students : proposed.students.slice(0, SHOWN)).map((studentId) => {
                const off = dropped.has(studentId);
                return (
                  <tr key={studentId} className={`border-b border-[#f2f4f7] last:border-0 ${off ? "text-[#98a2b3]" : ""}`}>
                    <td className="px-3 py-1.5">
                      <input
                        type="checkbox"
                        aria-label={`Place ${nameOf(studentId) || studentId}`}
                        checked={!off}
                        onChange={() =>
                          setDropped((held) => {
                            const next = new Set(held);
                            if (next.has(studentId)) next.delete(studentId);
                            else next.add(studentId);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-1.5">
                      <span className={off ? "line-through" : "font-medium"}>{nameOf(studentId) || studentId}</span>{" "}
                      <span className="font-mono text-xs text-[#98a2b3]">{studentId}</span>
                    </td>
                    {proposed.sets.map((set) => (
                      <td key={set.scopeId} className="px-3 py-1.5 tabular-nums">
                        {proposed.cell.get(`${set.scopeId}|${studentId}`) ?? <span className="text-[#c8d0da]">already placed</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {proposed.students.length > SHOWN ? (
            <button
              type="button"
              onClick={() => setShowAll((open) => !open)}
              className="w-full border-t border-[#dfe8f2] px-3 py-1.5 text-left text-xs font-semibold text-[#1f4e79] hover:bg-[#f6f9fc]"
            >
              {showAll ? "Show fewer" : `Show all ${proposed.students.length}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {stuck.length ? (
        <div className="mt-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-xs text-[#8a6116]">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={13} aria-hidden="true" /> Nowhere to put them, left for a person
          </p>
          <ul className="mt-0.5" aria-label="Left for a person">
            {stuck.slice(0, STUCK_SHOWN).map((entry) => (
              <li key={`${entry.scopeCode}|${entry.studentId}`}>
                {entry.scopeCode} · {nameOf(entry.studentId) || entry.studentId} — {entry.why}
              </li>
            ))}
          </ul>
          {stuck.length > STUCK_SHOWN ? (
            <p className="mt-0.5">and {stuck.length - STUCK_SHOWN} more, in {[...new Set(stuck.map((entry) => entry.scopeCode))].join(", ")}.</p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {proposed.students.length ? (
          <button
            type="button"
            disabled={!kept.length || place.isPending}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            Place {kept.length === proposed.students.length ? (kept.length === 1 ? "this student" : `all ${kept.length}`) : `${kept.length} of ${proposed.students.length}`}
          </button>
        ) : null}
        <p className="text-xs text-[#5b7a9a]">
          Untick anyone to leave out of the batch; a different group for one of them is chosen on their record afterwards. The languages are never proposed — they are placed by level, by hand.
        </p>
      </div>
      {place.error ? <p className="mt-1 text-xs text-[#a6292f]">{(place.error as Error).message}</p> : null}

      <ConfirmDialog
        open={confirming}
        title={`Place ${kept.length === 1 ? "one student" : `${kept.length} students`} as proposed?`}
        description={`They go into the groups above, in ${proposed.sets.map((set) => set.scopeCode).join(", ")}. Anyone already in a group of a set keeps it.`}
        confirmLabel="Place them"
        busy={place.isPending}
        onConfirm={() => place.mutate()}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}
