import { ChevronDown } from "lucide-react";
import { ReactNode } from "react";

type Props = {
  id: string;
  expanded: boolean;
  onToggle: () => void;
  toggleLabel: string;
  title: string;
  summary: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  overlay?: ReactNode;
  /** Briefly marked, when the card has just been opened from elsewhere. */
  highlighted?: boolean;
  /** Beside the title, to its right (a schedule card's Session | Graded activity switch). */
  titleAside?: ReactNode;
  children: ReactNode;
};

/** Shared compact/expanded card used for repeatable entries in builder tools. */
export function CollapsibleEntryCard({
  id,
  expanded,
  onToggle,
  toggleLabel,
  title,
  summary,
  leading,
  actions,
  overlay,
  highlighted = false,
  titleAside,
  children,
}: Props) {
  return <article id={id} className={`scroll-mt-4 rounded-lg border p-4 transition-[background-color,border-color,box-shadow] duration-700 ${highlighted ? "border-[#f0c36d] bg-[#fffaeb] shadow-[0_0_0_3px_rgba(247,144,9,0.25)]" : "border-[#d9dee7] bg-[#fdfdfd]"}`}>
    <div className="relative flex items-start justify-between gap-3">
      <button type="button" aria-label={toggleLabel} aria-expanded={expanded} onClick={onToggle} className={`flex min-w-0 items-start gap-2 text-left ${titleAside ? "" : "flex-1"}`}>
        <ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${expanded ? "rotate-180" : ""}`} />
        {leading}
        <span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">{title}</span><span className="mt-0.5 block text-sm text-[#667085]">{summary}</span></span>
      </button>
      {titleAside ? (
        <>
          <div className="-mt-0.5 shrink-0">{titleAside}</div>
          {/* The rest of the line still opens and closes the card, as the whole line did. */}
          <div aria-hidden="true" onClick={onToggle} className="min-w-0 flex-1 cursor-pointer self-stretch" />
        </>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      {overlay}
    </div>
    {expanded ? <div className="mt-4">{children}</div> : null}
  </article>;
}
