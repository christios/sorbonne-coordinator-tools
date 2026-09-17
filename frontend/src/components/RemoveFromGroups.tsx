import { AlertTriangle, Loader2, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { describeRemoval, type SemesterHeld } from "@/services/groupRemoval";

/**
 * Taking a selection out of the groups they hold in one semester, keeping their cohort.
 *
 * This used to be reachable only as a row of "Place in groups…": choose a semester, choose
 * a set, then "Take them out of this set" — once per set, and each time a decision about
 * placing worded as one about removing. The act is its own act and it has its own button.
 *
 * The semester is not a picker of every semester the department has ever run. It is
 * whichever ones the chosen students are actually in, read off the rows already on screen:
 * one of them and it is simply named, several and it is a short list with what each would
 * cost. Either way the semester is on the page before the press, so nothing is a guess.
 */
export function RemoveFromGroups({
  open,
  count,
  cohortName,
  semesters,
  busy,
  onRemove,
  onClose,
}: {
  open: boolean;
  count: number;
  cohortName: string;
  /** Every semester the chosen hold a group in, worst first. */
  semesters: SemesterHeld[];
  busy: boolean;
  onRemove: (termId: string) => void;
  onClose: () => void;
}) {
  // One semester is the answer rather than a question; several is a choice worth making.
  const only = semesters.length === 1 ? semesters[0].termId : "";
  const [termId, setTermId] = useState(only);
  useEffect(() => {
    if (open) setTermId(only);
  }, [open, only]);

  const chosen = semesters.find((term) => term.termId === termId) ?? null;
  const said = describeRemoval(chosen);

  return (
    <Modal
      open={open}
      title={`Take ${count} student${count === 1 ? "" : "s"} out of their groups`}
      description={`${cohortName} · they stay in the cohort. One semester at a time, because a student repeating a semester is still in the next one.`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen || busy}
            onClick={() => chosen && onRemove(chosen.termId)}
            className="inline-flex items-center gap-2 rounded-md bg-[#a6292f] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <UserMinus size={15} aria-hidden="true" />}
            {chosen ? `Take them out of ${chosen.groups.length} group${chosen.groups.length === 1 ? "" : "s"}` : "Take them out"}
          </button>
        </div>
      }
    >
      {semesters.length === 0 ? (
        <p className="rounded-md border border-[#d9dee7] bg-[#f8fafc] px-4 py-3 text-sm text-[#667085]">
          {count === 1 ? "This student holds" : "These students hold"} no group in any semester, so there is nothing
          to take {count === 1 ? "them" : "them"} out of.
        </p>
      ) : (
        <div className="space-y-4">
          {semesters.length > 1 ? (
            <SelectMenu
              label="Semester"
              value={termId}
              placeholder="Which semester…"
              options={semesters.map((term) => ({
                value: term.termId,
                label: term.termName,
                badge: `${term.placements} placement${term.placements === 1 ? "" : "s"}`,
                badgeTone: "accent" as const,
              }))}
              onChange={setTermId}
            />
          ) : (
            <p className="text-sm text-[#344054]">
              <span className="font-semibold">{semesters[0].termName}</span>
              <span className="text-[#98a2b3]"> · the only semester they hold a group in</span>
            </p>
          )}

          {said ? (
            <p className="flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fdf9ee] px-4 py-2.5 text-sm leading-6 text-[#8a6116]">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{said}</span>
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
