import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, type HTMLAttributes } from "react";

import { useScrollCues } from "@/components/useScrollCues";

/**
 * A pane that scrolls on its own inside a fixed page, and shows it (11 Nov 2026: "not very
 * clear that you can scroll each matrix"). Its scroll bars stay drawn instead of appearing only
 * while scrolling, and an edge with more behind it fades — lightly (Christian: the fade is
 * enough, no labels). Columns out of sight to either side also get an arrow that scrolls to
 * them. Nothing shows when everything fits.
 *
 * Inside the pane, mark the sticky heading `data-pane-head`, the sticky foot `data-pane-foot`
 * and a column that stays put when scrolling sideways `data-pane-sticky-col`, so the fades sit
 * at the edges of what actually scrolls.
 */
const SCROLLBARS =
  "[&::-webkit-scrollbar]:h-2.5 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-[#eef1f5] [&::-webkit-scrollbar-thumb]:bg-[#98a2b3] [&::-webkit-scrollbar-thumb:hover]:bg-[#667085] [&::-webkit-scrollbar-track]:bg-[#eef1f5] [&::-webkit-scrollbar-corner]:bg-[#eef1f5]";

type Props = HTMLAttributes<HTMLDivElement> & {
  /** The wrapper's classes: its size in the page. */
  outerClassName?: string;
};

export function ScrollPane({ outerClassName = "", className = "", children, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cues = useScrollCues(ref);
  const scrollSideways = (by: -1 | 1) => ref.current?.scrollBy({ left: by * ref.current.clientWidth * 0.6, behavior: "smooth" });
  const arrow = "pointer-events-auto absolute top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-[#b7bec8] bg-white text-[#1f4e79] shadow-[0_2px_6px_rgba(16,24,40,0.2)] hover:bg-[#f2f7fb]";

  return (
    <div className={`relative flex min-w-0 flex-col ${outerClassName}`}>
      {/* Isolated, so the sticky heading and column inside stay under the fades drawn over it. */}
      <div ref={ref} className={`isolate min-h-0 ${SCROLLBARS} ${className}`} {...props}>
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        {cues.up ? (
          <div className="absolute h-2.5 bg-gradient-to-b from-[rgba(16,24,40,0.09)] to-transparent" style={{ top: cues.insetTop, left: 0, right: cues.insetRight }} />
        ) : null}
        {cues.down ? (
          <>
            <div className="absolute h-7 bg-gradient-to-t from-white/75 to-transparent" style={{ bottom: cues.insetBottom, left: 0, right: cues.insetRight }} />
            <div className="absolute h-2.5 bg-gradient-to-t from-[rgba(16,24,40,0.08)] to-transparent" style={{ bottom: cues.insetBottom, left: 0, right: cues.insetRight }} />
          </>
        ) : null}
        {cues.left ? (
          <>
            <div className="absolute w-2.5 bg-gradient-to-r from-[rgba(16,24,40,0.09)] to-transparent" style={{ left: cues.insetLeft, top: cues.insetTop, bottom: cues.insetBottom }} />
            <button type="button" aria-label="Scroll to the columns on the left" onClick={() => scrollSideways(-1)} className={arrow} style={{ left: cues.insetLeft + 4 }}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {cues.right ? (
          <>
            <div className="absolute w-7 bg-gradient-to-l from-white/75 to-transparent" style={{ right: cues.insetRight, top: cues.insetTop, bottom: cues.insetBottom }} />
            <button type="button" aria-label="Scroll to the columns on the right" onClick={() => scrollSideways(1)} className={arrow} style={{ right: cues.insetRight + 4 }}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
