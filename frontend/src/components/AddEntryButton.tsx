import { Plus } from "lucide-react";

type Props = {
  onClick: () => void;
  label: string;
  ariaLabel?: string;
};

/**
 * The add control for a list of entries.
 *
 * It always renders below the entries: a professor adding the tenth session should
 * not have to scroll back to the top of the list to reach it.
 */
export function AddEntryButton({ onClick, label, ariaLabel }: Props) {
  return (
    <div className="mt-3 flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
      >
        <Plus size={16} /> {label}
      </button>
    </div>
  );
}
