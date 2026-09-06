import { FolderInput, Plus, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import type { Cohort } from "@/services/studentDatabase";

/**
 * Which cohort the ticked students should belong to.
 *
 * It was a dropdown and a button standing in the selection bar, beside a button that
 * opened a dialog — two ways of asking the same kind of question, and no reason for the
 * difference beyond the order they were built in. Both are buttons onto a dialog now.
 *
 * Making a cohort has come out of the list. It sat among the cohorts as one more line to
 * scroll past, so the one entry that creates something looked exactly like the twenty that
 * only move people; it is an action of its own, under a rule, where nothing is chosen by
 * accident.
 */
export function MoveToCohort({
  open,
  count,
  cohorts,
  onMove,
  onNewCohort,
  onClose,
  busy,
}: {
  open: boolean;
  count: number;
  cohorts: Cohort[];
  /** Null takes them out of whatever cohort they are in. */
  onMove: (cohortId: string | null) => void;
  onNewCohort: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [cohortId, setCohortId] = useState("");
  const OUT = "__out__";
  useEffect(() => {
    if (open) setCohortId("");
  }, [open]);

  return (
    <Modal
      open={open}
      title={`Move ${count} student${count === 1 ? "" : "s"}`}
      description="A student belongs to one cohort. Moving them out of one drops every group they hold in it, in every semester."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!cohortId || busy}
            onClick={() => onMove(cohortId === OUT ? null : cohortId)}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            <FolderInput size={15} aria-hidden="true" /> Move {count}
          </button>
        </div>
      }
    >
      <span className="block text-xs font-semibold uppercase tracking-wide text-[#667085]">Cohort</span>
      <div className="mt-1.5">
        <SelectMenu
          label="Move to cohort"
          value={cohortId}
          placeholder="Which cohort…"
          searchable={cohorts.length > 12}
          options={[
            ...cohorts.map((cohort) => ({
              value: cohort.id,
              label: cohort.name,
              year: cohort.term,
              badge: String(cohort.memberCount),
              badgeTone: cohort.memberCount ? ("accent" as const) : ("muted" as const),
            })),
            { value: OUT, label: "Take them out of their cohort" },
          ]}
          onChange={setCohortId}
        />
      </div>

      {cohortId === OUT ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-[#e5cf9f] bg-[#fdf9ee] px-4 py-2.5 text-sm text-[#8a6116]">
          <UserMinus size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          They will belong to no cohort, and every group they hold will be given up — in every semester, not only
          the one on screen.
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-[#eef1f5] pt-4">
        <span className="text-sm text-[#667085]">Not in the list?</span>
        <button
          type="button"
          onClick={onNewCohort}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
        >
          <Plus size={15} aria-hidden="true" /> New cohort
        </button>
        <span className="text-xs text-[#98a2b3]">Makes one and moves these {count} into it.</span>
      </div>
    </Modal>
  );
}
