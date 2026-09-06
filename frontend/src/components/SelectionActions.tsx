import { Popover } from "radix-ui";
import { ChevronDown, FolderInput, LayoutGrid, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import type { Cohort } from "@/services/studentDatabase";

/**
 * The three shapes being tried for "what can I do with the students I have ticked".
 *
 * Temporary: one of these wins and the other two go. They are the same controls and the
 * same handlers throughout — only where they sit and when they appear differ, which is the
 * whole of the question being asked.
 */
export type SelectionVariant = "toolbar" | "floating" | "menu";

export const VARIANTS: { id: SelectionVariant; name: string; blurb: string }[] = [
  { id: "toolbar", name: "In the toolbar", blurb: "Takes the filter button's place while a selection is live." },
  { id: "floating", name: "Floating bar", blurb: "Rises over the foot of the table, and nothing changes above it." },
  { id: "menu", name: "Actions menu", blurb: "One narrow button, always there, greyed until something is ticked." },
];

export type SelectionActionsProps = {
  variant: SelectionVariant;
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

/** The Move dropdown, the Move button and the Place button: the same three everywhere. */
function Controls({ props, wide }: { props: SelectionActionsProps; wide: boolean }) {
  const { count, cohorts, moveTo, onMoveTo, onNewCohort, onMove, moving, canPlace, onPlace, newCohortValue, noCohortValue } = props;
  return (
    <>
      <div className={wide ? "w-56" : "w-full"}>
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
        className={`inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50 ${wide ? "" : "w-full justify-center"}`}
      >
        <FolderInput size={15} aria-hidden="true" /> {count ? `Move ${count}` : "Move"}
      </button>
      <button
        type="button"
        disabled={!canPlace}
        title={count && !canPlace ? PLACE_HINT : undefined}
        onClick={onPlace}
        className={`inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054] disabled:opacity-50 ${wide ? "" : "w-full justify-center"}`}
      >
        <LayoutGrid size={15} aria-hidden="true" /> Place in a block…
      </button>
    </>
  );
}

/**
 * A: in the toolbar. Rendered where the filter button sits, and only while something is
 * ticked, so the page is the same height whether or not there is a selection.
 */
export function SelectionInToolbar(props: SelectionActionsProps) {
  if (!props.count) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-semibold text-[#1f4e79]">{props.count} selected</span>
      <Controls props={props} wide />
      <button type="button" onClick={props.onClear} className="text-[#667085] underline">
        Clear
      </button>
    </div>
  );
}

/**
 * B: a bar that rises over the foot of the table. Nothing above it moves, and it is the
 * only one of the three that can be reached without looking away from the rows.
 */
export function SelectionFloating(props: SelectionActionsProps) {
  if (!props.count) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-[#c9d6e6] bg-white px-4 py-2.5 text-sm shadow-[0_12px_32px_rgba(15,32,54,0.18)]">
        <span className="font-semibold text-[#1f4e79]">{props.count} selected</span>
        <Controls props={props} wide />
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

/**
 * C: one button, always in the toolbar, that opens onto the same controls. Nothing moves
 * when a row is ticked; the price is that the actions are one press further away.
 */
export function SelectionMenu(props: SelectionActionsProps) {
  const [open, setOpen] = useState(false);
  const held = useRef(props.count);
  held.current = props.count;
  useEffect(() => {
    if (!props.count) setOpen(false);
  }, [props.count]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={!props.count}
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
        >
          {props.count ? `${props.count} selected` : "Actions"}
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-[100] w-64 rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"
        >
          <div className="flex flex-col gap-2 text-sm">
            <Controls props={props} wide={false} />
            <button
              type="button"
              onClick={() => {
                props.onClear();
                setOpen(false);
              }}
              className="w-full rounded-md px-3 py-1.5 text-[#667085] hover:bg-[#f6f8fb]"
            >
              Clear the selection
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
