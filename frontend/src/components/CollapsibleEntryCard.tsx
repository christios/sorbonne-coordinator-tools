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
  children,
}: Props) {
  return <article id={id} className="rounded-lg border border-[#d9dee7] bg-[#fdfdfd] p-4">
    <div className="relative flex items-start justify-between gap-3">
      <button type="button" aria-label={toggleLabel} aria-expanded={expanded} onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2 text-left">
        <ChevronDown size={17} className={`mt-0.5 shrink-0 text-[#667085] transition-transform ${expanded ? "rotate-180" : ""}`} />
        {leading}
        <span className="min-w-0"><span className="block text-sm font-semibold text-[#344054]">{title}</span><span className="mt-0.5 block text-sm text-[#667085]">{summary}</span></span>
      </button>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      {overlay}
    </div>
    {expanded ? <div className="mt-4">{children}</div> : null}
  </article>;
}
