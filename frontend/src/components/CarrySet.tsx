import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarArrowUp, Check, Loader2 } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { useSemesterShown } from "@/services/semesterYears";
import { carryScope, fetchCarryPreview, type CarriedSet } from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

/**
 * A set made again in another semester: Semester 1's LANG as Semester 2's.
 *
 * Semester 2 needed its own LANG — until it had one, every Semester 2 French registration
 * read as an unapproved elective — and its 26 French exemptions had to be typed again by
 * hand. This carries the set's courses, groups and sub-rows, and — ticked, as it starts —
 * the exemptions of students still held there, counted by reason first: "LEA track" likely
 * holds next semester and "Repeater" may not, so whether to bring them is the
 * coordinator's call. Not its CRNs, which are the other semester's sections, nor
 * anybody's placement: a group in another semester is placed afresh.
 */
export function CarrySet({
  scope,
  semesters,
  onCarried,
}: {
  scope: { id: string; code: string; termId?: string };
  semesters: TimetableTerm[];
  /** Afterwards, to show the set made, in its semester. */
  onCarried: (termId: string, scopeId: string) => void;
}) {
  const shownOf = useSemesterShown();
  const [open, setOpen] = useState(false);
  const others = semesters.filter((term) => term.id !== (scope.termId ?? ""));
  const [termId, setTermId] = useState("");
  const into = others.find((term) => term.id === termId) ?? null;
  const nameOf = (term: TimetableTerm) => {
    const shown = shownOf(term);
    return [shown.label, shown.year].filter(Boolean).join(" ");
  };
  const preview = useQuery({
    queryKey: ["carry-preview", scope.id, termId],
    queryFn: () => fetchCarryPreview(scope.id, termId),
    enabled: open && Boolean(termId),
    retry: false,
  });
  const [bringExemptions, setBringExemptions] = useState(true);
  const carry = useMutation<CarriedSet, Error>({ mutationFn: () => carryScope(scope.id, termId, bringExemptions) });
  const counted = preview.data;
  const reasons = (counted?.reasons ?? [])
    .map((entry) => `${entry.count} ${entry.reason || "with no reason"}`)
    .join(", ");
  const done = carry.data;

  if (!others.length) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          carry.reset();
          setBringExemptions(true);
          setTermId(others.length === 1 ? others[0].id : "");
          setOpen(true);
        }}
        aria-label={`Carry ${scope.code} into another semester`}
        title="Make this set again in another semester"
        className="rounded-md p-1.5 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
      >
        <CalendarArrowUp size={15} aria-hidden="true" />
      </button>
      <Modal
        open={open}
        title={`Carry ${scope.code} into another semester`}
        description="Its courses, and its groups with their seats and sub-rows — and, if you choose, who doesn't take one of its courses."
        onClose={() => setOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-[#667085]">
              {done ? "Close" : "Cancel"}
            </button>
            {done && into ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCarried(into.id, done.scopeId);
                }}
                className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
              >
                Show {scope.code} in {nameOf(into)}
              </button>
            ) : (
              <button
                type="button"
                disabled={!into || carry.isPending}
                onClick={() => carry.mutate()}
                className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
              >
                {carry.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CalendarArrowUp size={15} aria-hidden="true" />}
                {into ? `Carry into ${nameOf(into)}` : "Carry"}
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          <SelectMenu
            label="Into"
            value={termId}
            onChange={setTermId}
            placeholder="Which semester…"
            options={others.map((term) => ({ value: term.id, ...shownOf(term) }))}
          />
          {into && counted ? (
            counted.exemptions ? (
              <label className="flex items-start gap-2 rounded-md border border-[#e4e8ef] px-3 py-2 text-sm text-[#344054]">
                <input
                  type="checkbox"
                  checked={bringExemptions}
                  disabled={Boolean(done)}
                  onChange={(event) => setBringExemptions(event.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-semibold">
                    Bring the {counted.exemptions} exemption{counted.exemptions === 1 ? "" : "s"} too
                  </span>
                  <span className="block text-xs text-[#667085]">
                    {reasons}. Each still holds in {nameOf(into)}? Untick to enter them afresh, or clear one later on the
                    student&apos;s record.
                  </span>
                  {counted.stayBehind ? (
                    <span className="block text-xs text-[#98a2b3]">
                      {counted.stayBehind} more stay behind: those students are in no cohort in {nameOf(into)}.
                    </span>
                  ) : null}
                </span>
              </label>
            ) : (
              <p className="text-xs text-[#667085]">Nobody is exempt from its courses, so there are no exemptions to bring.</p>
            )
          ) : null}
          <p className="text-xs text-[#667085]">
            Not its CRNs, which are the other semester&apos;s sections, nor anybody&apos;s group: students are placed
            there afresh. Give it CRNs and place its students in that semester.
          </p>
          {done ? (
            <p role="status" className="rounded-md border border-[#d7e3d4] bg-[#f3f8f1] px-3 py-2 text-sm text-[#2f5d2a]">
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Check size={14} aria-hidden="true" />
                {scope.code} made in {into ? nameOf(into) : "that semester"}
              </span>
              : {done.courses} course{done.courses === 1 ? "" : "s"}, {done.groups} group{done.groups === 1 ? "" : "s"},{" "}
              {done.exemptions} exemption{done.exemptions === 1 ? "" : "s"}.
            </p>
          ) : null}
          {carry.error ? (
            <p role="alert" className="text-sm text-[#a6292f]">
              {carry.error.message}
            </p>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
