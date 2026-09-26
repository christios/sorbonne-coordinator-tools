import { FolderInput, LayoutGrid, UserMinus, X } from "lucide-react";
import type { ReactNode } from "react";

export type SelectionActionsProps = {
  count: number;
  /** Open the dialog that asks which cohort. */
  onMove: () => void;
  /** False when the selection spans cohorts, since a group belongs to one. */
  canPlace: boolean;
  onPlace: () => void;
  /** Out of the groups they hold in one semester, keeping their cohort. */
  onOutOfGroups: () => void;
  /** Out of the cohort altogether, which gives up every group in every semester. */
  onOutOfCohort: () => void;
  onClear: () => void;
  /** Anything else the page offers for the selection, after the placing: "Timetables". */
  extra?: ReactNode;
};

const PLACE_HINT = "A group belongs to one cohort — select students who share one";
const GROUPS_HINT = "A group belongs to one cohort — select students who share one";

/**
 * The two things that can be done, as two buttons.
 *
 * One of them used to be a dropdown and a button, and the other a button — the same kind
 * of question asked two different ways, for no reason but the order they were written in.
 * Both open a dialog; neither decides anything from the bar itself.
 *
 * Naming the groups and having them proposed are one act — these students need somewhere
 * to sit — differing only in who chooses, and that is a distinction better drawn one level
 * down, inside the dialog that already holds the semester and the cohort.
 *
 * Removing is not that act, and it was hiding inside both of the others: the last option
 * of the cohort dropdown, and a row of the placing dialog. Two buttons of its own, drawn
 * apart and in the colour of something that cannot be undone.
 */
function Controls({ props }: { props: SelectionActionsProps }) {
  return (
    <>
      <button
        type="button"
        disabled={!props.count}
        onClick={props.onMove}
        className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
      >
        <FolderInput size={15} aria-hidden="true" /> Move to cohort…
      </button>
      <button
        type="button"
        disabled={!props.canPlace}
        title={props.count && !props.canPlace ? PLACE_HINT : undefined}
        onClick={props.onPlace}
        className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054] disabled:opacity-50"
      >
        <LayoutGrid size={15} aria-hidden="true" /> Place in groups…
      </button>
      {props.extra}

      {/*
        * Removing, as two buttons rather than as the last line of a dialog about moving.
        *
        * It was reachable only by opening "Move to cohort…", scrolling past twenty
        * cohorts and choosing "Take them out of their cohort" — an act of removal worded
        * as one of moving, which is a guess a coordinator should not have to make twice.
        *
        * Two, because they are two different sizes and one word would not say which:
        * out of a semester's groups keeps the cohort; out of the cohort gives up every
        * group in every semester. Both ask before they act.
        */}
      <span className="mx-1 h-5 w-px bg-[#e4e8ef]" aria-hidden="true" />
      <button
        type="button"
        disabled={!props.canPlace}
        title={props.count && !props.canPlace ? GROUPS_HINT : undefined}
        onClick={props.onOutOfGroups}
        className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:opacity-50"
      >
        <UserMinus size={15} aria-hidden="true" /> Out of groups…
      </button>
      <button
        type="button"
        disabled={!props.count}
        onClick={props.onOutOfCohort}
        className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:opacity-50"
      >
        <UserMinus size={15} aria-hidden="true" /> Out of cohort…
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
  return (
    <SelectionBar count={props.count} onClear={props.onClear}>
      <Controls props={props} />
    </SelectionBar>
  );
}

/**
 * The bar itself, without an opinion about what goes in it.
 *
 * Students, Cohorts and the part-time teachers all ask the same question — "some rows are
 * ticked, now what" — and it should look and sit in the same place for all of them. What
 * differs is the buttons, so that is the only thing a caller passes.
 */
export function SelectionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[#c9d6e6] bg-white px-4 py-2.5 text-sm shadow-[0_12px_32px_rgba(15,32,54,0.18)]">
        <span className="font-semibold text-[#1f4e79]">{count} selected</span>
        {children}
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear the selection"
          className="ml-1 rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#344054]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
