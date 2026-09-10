import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Dices, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import {
  type FillCandidate,
  type FillOrder,
  type FillPlan,
  type FillPolicy,
  clashKey,
  placementsByGroup,
  planFill,
} from "@/services/groupFill";
import type { GroupClash } from "@/services/publication";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import {
  type CatalogueScope,
  type Cohort,
  type PlacementReport,
  fetchAssignments,
  fetchStudents,
  groupIsRetired,
  placeStudents,
} from "@/services/studentDatabase";

const ORDERS: { value: FillOrder; label: string }[] = [
  { value: "id", label: "Student ID" },
  { value: "first", label: "First name" },
  { value: "last", label: "Last name" },
  { value: "random", label: "Random draw" },
];

const WHO: { value: "everyone" | "chosen"; label: string }[] = [
  { value: "everyone", label: "Everyone not yet in this set" },
  { value: "chosen", label: "Only the students I choose" },
];

const POLICIES: { value: FillPolicy; label: string }[] = [
  { value: "balanced", label: "Balanced — each to the least-full group" },
  { value: "packed", label: "Packed — fill each group to capacity, then the next" },
];

export type FillReport = PlacementReport & { scopeCode: string; unplaced: number };

/**
 * Filling one block: everyone in the cohort not yet in it, dealt into its groups.
 *
 * The plan is made and shown here before anything is written — who goes where, what each
 * group's size becomes, who is left out and why — exactly the way a workbook upload is
 * reviewed. The planning runs in this tab because the order (by name) and a group's
 * preferred programme need what only this tab holds; the server receives id -> group.
 *
 * Clashes come from the publication report, which the server works out from the Student
 * Hub's session times. Without that report a fill could put a student in two rooms at
 * once, so the button waits for it rather than guessing.
 */
export function FillBlock({
  open,
  cohort,
  scope,
  clashes,
  onClose,
  onFilled,
}: {
  open: boolean;
  cohort: Cohort;
  scope: CatalogueScope;
  /** The cohort's clashing pairs, or null while the timetable's word is not in. */
  clashes: GroupClash[] | null;
  onClose: () => void;
  onFilled: (report: FillReport) => void;
}) {
  const [order, setOrder] = useState<FillOrder>("id");
  const [policy, setPolicy] = useState<FillPolicy>("balanced");
  const [seed, setSeed] = useState(() => Date.now());
  /*
   * Everyone, or the ones somebody names.
   *
   * "Everyone not yet in this set" is what this always did and stays the default, because
   * it is the right answer at the start of a semester. It is the wrong one every time
   * after: a student arrives in week three and a fill either moves nobody, or is run and
   * its plan read line by line to check it moved only them. Naming them is the whole
   * feature; the plan, the clash rule and the capacities are unchanged.
   */
  const [who, setWho] = useState<"everyone" | "chosen">("everyone");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pick = (studentId: string) =>
    setPicked((held) => {
      const next = new Set(held);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });

  const students = useQuery({ queryKey: ["students", ""], queryFn: () => fetchStudents(""), enabled: open });
  const assignments = useQuery({
    queryKey: ["assignments", cohort.id],
    queryFn: () => fetchAssignments(cohort.id),
    enabled: open,
  });
  const held = useQuery({
    queryKey: ["fields-held", "fill"],
    queryFn: async () => ({
      names: await namesHeld(),
      first: await fieldHeld("FIRST_NAME"),
      last: await fieldHeld("LAST_NAME"),
      program: await fieldHeld("MAJOR_CODE_DESC"),
    }),
    enabled: open,
    staleTime: 0,
  });

  /**
   * Everyone this fill could seat: in the cohort, and not already in a group of this set.
   *
   * "In the cohort" means the student's own record says so, and nothing else.
   *
   * This briefly also admitted anyone appearing in `fetchAssignments(cohort.id)`, on the
   * reasoning that holding a group filed under a cohort is a second way of belonging to it.
   * That reasoning is wrong, and the way it is wrong is worth keeping written down: an
   * assignment is filed under the cohort that owns the SET, not the cohort of the student.
   * A set open to every cohort — the languages — lives on one cohort's row and takes
   * everybody, so every language student in the department is filed under whichever cohort
   * happens to hold that set. On the real data that turned Foundation Year's lecture fill
   * from one candidate into seventy-eight.
   */
  const everyone = useMemo<FillCandidate[]>(() => {
    if (!students.data || !assignments.data || !held.data) return [];
    return students.data
      .filter((student) => student.cohortId === cohort.id && !assignments.data[student.studentId]?.[scope.id])
      .map((student) => {
        const others = { ...(assignments.data[student.studentId] ?? {}) };
        delete others[scope.id];
        return {
          studentId: student.studentId,
          first: held.data.first[student.studentId] ?? "",
          last: held.data.last[student.studentId] ?? "",
          program: held.data.program[student.studentId] ?? "",
          held: others,
        };
      });
  }, [students.data, assignments.data, held.data, cohort.id, scope.id]);

  const candidates = useMemo(
    () => (who === "everyone" ? everyone : everyone.filter((candidate) => picked.has(candidate.studentId))),
    [who, everyone, picked],
  );

  const clashSet = useMemo(() => {
    const keys = new Set<string>();
    for (const clash of clashes ?? []) {
      if (clash.groups.length === 2) keys.add(clashKey(clash.groups[0].id, clash.groups[1].id));
    }
    return keys;
  }, [clashes]);

  /*
   * The groups a fill may seat somebody in.
   *
   * A group whose every section is retired teaches nobody, and the checkbox that retires
   * a section already promises as much. Leaving them in was how the overflow from a full
   * group landed in a set that had stopped running.
   */
  const openGroups = useMemo(() => scope.groups.filter((group) => !groupIsRetired(group)), [scope.groups]);

  const plan = useMemo<FillPlan>(
    () =>
      planFill({
        groups: openGroups.map((group) => ({
          id: group.id,
          label: group.label,
          capacity: group.capacity,
          program: group.program,
          assigned: group.assigned,
          parentGroupId: group.parentGroupId,
        })),
        candidates,
        clashes: clashSet,
        order,
        policy,
        seed,
        parentScopeId: scope.kind === "nested" ? scope.parentScopeId : "",
      }),
    [scope, openGroups, candidates, clashSet, order, policy, seed],
  );

  const fill = useMutation({
    mutationFn: () => placeStudents(scope.id, placementsByGroup(plan)),
    onSuccess: (report) => onFilled({ ...report, scopeCode: scope.code, unplaced: plan.unplaced.length }),
  });

  const loading = students.isLoading || assignments.isLoading || held.isLoading;
  const namesMissing = candidates.length > 0 && candidates.every((candidate) => !held.data?.names[candidate.studentId]);
  const ready = clashes !== null && !loading && plan.placements.length > 0;
  const nameOf = (id: string) => held.data?.names[id] ?? id;
  const labelOf = new Map(openGroups.map((group) => [group.id, group.label]));

  return (
    <Modal
      open={open}
      title={`Fill ${scope.code}`}
      description={`${cohort.name} · nobody already in a ${scope.code} group moves.`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || fill.isPending}
            onClick={() => fill.mutate()}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {fill.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            Place {plan.placements.length}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectMenu
            label="Who"
            value={who}
            options={WHO}
            onChange={(value) => setWho(value as "everyone" | "chosen")}
          />
          <SelectMenu label="Order" value={order} options={ORDERS} onChange={(value) => setOrder(value as FillOrder)} />
          <SelectMenu label="Fill" value={policy} options={POLICIES} onChange={(value) => setPolicy(value as FillPolicy)} />
        </div>

        {who === "chosen" && !loading && everyone.length > 0 ? (
          <fieldset className="rounded-md border border-[#e4e8ee] px-3 py-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
              {picked.size} of {everyone.length} chosen
            </legend>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto" aria-label="Who to place">
              {everyone.map((candidate) => (
                <li key={candidate.studentId}>
                  <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
                    <input type="checkbox" checked={picked.has(candidate.studentId)} onChange={() => pick(candidate.studentId)} />
                    <span className="text-[#171717]">{nameOf(candidate.studentId)}</span>
                    <span className="text-xs text-[#98a2b3]">{candidate.studentId}</span>
                    {candidate.program ? <span className="text-xs text-[#98a2b3]">{candidate.program}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}
        {order === "random" ? (
          <button
            type="button"
            onClick={() => setSeed(Date.now())}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79]"
          >
            <Dices size={15} aria-hidden="true" /> Draw again
          </button>
        ) : null}
        {scope.kind === "nested" ? (
          <Note>
            This set nests inside another: each student goes to a group inside the parent group they already hold, and
            anyone not yet placed in the parent set waits.
          </Note>
        ) : null}
        {policy === "packed" && scope.groups.every((group) => !group.capacity) ? (
          <Note>No group in this set has a capacity, so packed puts everyone in the first group.</Note>
        ) : null}

        {clashes === null ? (
          <Note>
            The timetable's word on clashes is not in — the Student Hub could not be reached, or is still
            being read. Filling waits for it rather than risk two rooms at once.
          </Note>
        ) : null}
        {namesMissing ? (
          <Note>
            This browser holds no names for these students, so ordering by name falls back to their ids.
            Sync a portal filter on the Students page first if the order matters.
          </Note>
        ) : null}

        {loading ? (
          <p className="text-sm text-[#667085]">Reading who is in the cohort…</p>
        ) : everyone.length === 0 ? (
          <p className="text-sm text-[#667085]">Everyone in {cohort.name} already sits in a {scope.code} group.</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-[#667085]">Nobody chosen yet, so there is nobody to place.</p>
        ) : (
          <>
            <table className="w-full text-left text-sm" aria-label="Group sizes after the fill">
              <thead className="text-xs uppercase tracking-wide text-[#667085]">
                <tr>
                  <th className="py-1.5 font-semibold">Group</th>
                  <th className="py-1.5 text-right font-semibold">Now</th>
                  <th className="py-1.5 text-right font-semibold">After</th>
                  <th className="py-1.5 text-right font-semibold">Capacity</th>
                  <th className="py-1.5 font-semibold">Prefers</th>
                </tr>
              </thead>
              <tbody>
                {plan.sizes.map((size) => (
                  <tr key={size.groupId} className="border-t border-[#eef1f5] tabular-nums">
                    <td className="py-1.5 font-semibold text-[#171717]">{size.label}</td>
                    <td className="py-1.5 text-right">{size.before}</td>
                    <td className="py-1.5 text-right font-semibold">{size.after}</td>
                    <td className="py-1.5 text-right text-[#667085]">{size.capacity || "—"}</td>
                    <td className="py-1.5 text-[#667085]">
                      {scope.groups.find((group) => group.id === size.groupId)?.program || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div>
              <p className="text-sm font-semibold text-[#344054]">
                {plan.placements.length} student{plan.placements.length === 1 ? "" : "s"} would be placed
              </p>
              <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-sm" aria-label="Who goes where">
                {plan.placements.map((placement) => {
                  const program = held.data?.program[placement.studentId];
                  return (
                    <li key={placement.studentId} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[#171717]">{nameOf(placement.studentId)}</span>
                      <span className="text-xs text-[#98a2b3]">{placement.studentId}</span>
                      {program ? <span className="text-xs text-[#98a2b3]">{program}</span> : null}
                      <span className="text-[#667085]">
                        → {labelOf.get(placement.groupId)}
                        {placement.why === "preferred" ? " · preferred" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {plan.unplaced.length ? (
              <div className="rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
                  {plan.unplaced.length} would stay unplaced
                </p>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto" aria-label="Who stays unplaced">
                  {plan.unplaced.map((entry) => (
                    <li key={entry.studentId}>
                      {nameOf(entry.studentId)} <span className="text-xs">{entry.studentId}</span> · {entry.why}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}

        {fill.error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {(fill.error as Error).message}
          </p>
        ) : null}
      </div>
    </Modal>
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
