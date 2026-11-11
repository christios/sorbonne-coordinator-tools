/**
 * What a scrolling pane has out of sight, for ScrollPane to show it: whether there is more
 * above, below or to either side, and where the visible area sits inside the pane's border,
 * scroll bars, sticky heading, foot and column.
 */
import { useEffect, useState, type RefObject } from "react";

export type Cues = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Where the visible area starts and ends, from the pane's outer edges, in px. */
  insetTop: number;
  insetBottom: number;
  insetLeft: number;
  insetRight: number;
};

export const NO_CUES: Cues = { up: false, down: false, left: false, right: false, insetTop: 0, insetBottom: 0, insetLeft: 0, insetRight: 0 };

export type PaneMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
  offsetHeight: number;
  offsetWidth: number;
  clientTop: number;
  clientLeft: number;
  head: number;
  foot: number;
  stickyColumn: number;
};

export function scrollCues(metrics: PaneMetrics): Cues {
  const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = metrics;
  return {
    up: scrollTop > 1,
    down: scrollTop + clientHeight < scrollHeight - 1,
    left: scrollLeft > 1,
    right: scrollLeft + clientWidth < scrollWidth - 1,
    insetTop: metrics.clientTop + metrics.head,
    insetBottom: metrics.offsetHeight - metrics.clientTop - clientHeight + metrics.foot,
    insetLeft: metrics.clientLeft + metrics.stickyColumn,
    insetRight: metrics.offsetWidth - metrics.clientLeft - clientWidth,
  };
}

function measure(pane: HTMLElement): PaneMetrics {
  const size = (selector: string, side: "offsetHeight" | "offsetWidth") => pane.querySelector<HTMLElement>(selector)?.[side] ?? 0;
  return {
    scrollTop: pane.scrollTop,
    scrollHeight: pane.scrollHeight,
    clientHeight: pane.clientHeight,
    scrollLeft: pane.scrollLeft,
    scrollWidth: pane.scrollWidth,
    clientWidth: pane.clientWidth,
    offsetHeight: pane.offsetHeight,
    offsetWidth: pane.offsetWidth,
    clientTop: pane.clientTop,
    clientLeft: pane.clientLeft,
    head: size("[data-pane-head]", "offsetHeight"),
    foot: size("[data-pane-foot]", "offsetHeight"),
    stickyColumn: size("[data-pane-sticky-col]", "offsetWidth"),
  };
}

export function useScrollCues(ref: RefObject<HTMLElement | null>): Cues {
  const [cues, setCues] = useState<Cues>(NO_CUES);
  useEffect(() => {
    const pane = ref.current;
    if (!pane) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = scrollCues(measure(pane));
        setCues((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
      });
    };
    update();
    pane.addEventListener("scroll", update, { passive: true });
    // The pane resizes with the window; what it holds grows as outcomes are added or typed.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(pane);
    if (pane.firstElementChild) observer?.observe(pane.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      pane.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref]);
  return cues;
}
