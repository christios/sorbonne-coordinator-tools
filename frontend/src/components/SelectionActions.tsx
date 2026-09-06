import { FolderInput, LayoutGrid, X } from "lucide-react";

import { SelectMenu } from "@/components/SelectMenu";
import type { Cohort } from "@/services/studentDatabase";

export type SelectionActionsProps = {
  count: number;
  cohorts: Cohort[];
  /** The cohort the Move button would move them to; "" until one is picked. */
  moveTo: string;
  onMoveTo: (value: string) => void;
  onNewCohort: () => void;
  onMove: () => void;
  moving: boolean;
  /** False when the selection spans cohorts, since a block belongs to one. */
  canPlace: boolean;
  onPlace: () => void;
  onClear: () => void;
  /** What every variant calls the two special entries of the Move dropdown. */
  newCohortValue: string;
  noCohortValue: string;
};

const PLACE_HINT = "Blocks belong to one cohort — select students who share one";

/** The Move dropdown, the Move button and the Place button. */
function Controls({ props }: { props: SelectionActionsProps }) {
  const { count, cohorts, moveTo, onMoveTo, onNewCohort, onMove, moving, canPlace, onPlace, newCohortValue, noCohortValue } = props;
  return (
    <>
      <div className="w-56">
        <SelectMenu
          label="Move to cohort"
          value={moveTo}
          placeholder="Move to cohort…"
          searchable={cohorts.length > 12}
          options={[
            ...cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name })),
            { value: newCohortValue, label: "New cohort…" },
            { value: noCohortValue, label: "Take out of their cohort" },
          ]}
          onChange={(value) => (value === newCohortValue ? onNewCohort() : onMoveTo(value))}
          disabled={!count}
        />
      </div>
      <button
        type="button"
        disabled={!count || !moveTo || moving}
        onClick={onMove}
        className={`inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50`}
      >
        <FolderInput size={15} aria-hidden="true" /> {count ? `Move ${count}` : "Move"}
      </button>
      <button
        type="button"
        disabled={!canPlace}
        title={count && !canPlace ? PLACE_HINT : undefined}
        onClick={onPlace}
        className={`inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054] disabled:opacity-50`}
      >
        <LayoutGrid size={15} aria-hidden="true" /> Place in a block…
      </button>
    </>
  );
}

/**
 * What can be done with the students that are ticked, over the foot of the table.
 *
 * It replaces a band that sat above every roster whether or not anything was selected,
 * greyed out, saying "None selected" — a row of the page spent on the answer "nothing".
 * This costs nothing until there is something to do, and when it comes it comes without
 * moving a single row: the table underneath is exactly where the eye left it, which
 * matters most at the moment of clicking, when the pointer is over a checkbox.
 *
 * Fixed to the window rather than the table, so a selection made at the top of three
 * thousand rows is still actionable at the bottom of them.
 */
export function SelectionFloating(props: SelectionActionsProps) {
  if (!props.count) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[#c9d6e6] bg-white px-4 py-2.5 text-sm shadow-[0_12px_32px_rgba(15,32,54,0.18)]">
        <span className="font-semibold text-[#1f4e79]">{props.count} selected</span>
        <Controls props={props} />
        <button
          type="button"
          onClick={props.onClear}
          aria-label="Clear the selection"
          className="ml-1 rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#344054]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
