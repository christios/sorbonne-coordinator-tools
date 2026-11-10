import { ArrowLeft, Check, Compass, MousePointerClick, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * One step of a guided tour: a part of the page lit up, a sentence or two about it, and
 * something to try there. A step with something to try moves on by itself once it is done.
 */
export type TourStep = {
  id: string;
  title: string;
  body: ReactNode;
  /** What to try, said as a task: "Drag down a few hours on any day." */
  tryIt?: ReactNode;
  /** The thing to try has been done. */
  done?: boolean;
  /** The part of the page to light up — or several, lit as one; none puts the card in the middle. */
  target?: () => Element | null | (Element | null)[];
  /** Buttons in place of Next, for the last step: keep or clear what was tried. */
  actions?: { label: string; onClick: () => void; primary?: boolean }[];
};

type Box = { left: number; top: number; width: number; height: number };

/** Room kept round the lit part, and between it and the card. */
const PAD = 6;
const GAP = 12;
/** How long "Nicely done" shows before the next step. */
const SETTLE_MS = 900;

/** The boxes that scroll or clip round an element, nearest first: kept, as the page does not rebuild them. */
const SCROLLERS = new WeakMap<Element, Element[]>();
function scrollersOf(element: Element): Element[] {
  let known = SCROLLERS.get(element);
  if (!known) {
    known = [];
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) known.push(node);
    }
    SCROLLERS.set(element, known);
  }
  return known;
}

/**
 * Where one part, or several taken together, sit on the screen — the part of them that can
 * be seen: a form scrolled inside a window shows only what the window shows.
 */
function boxOf(found: Element | null | (Element | null)[]): Box | null {
  const seen = (Array.isArray(found) ? found : [found])
    .filter((element): element is Element => Boolean(element))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      let { left, top, right, bottom } = rect;
      for (const scroller of scrollersOf(element)) {
        const frame = scroller.getBoundingClientRect();
        left = Math.max(left, frame.left);
        top = Math.max(top, frame.top);
        right = Math.min(right, frame.right);
        bottom = Math.min(bottom, frame.bottom);
      }
      return { left, top, right, bottom };
    })
    .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
  if (!seen.length) return null;
  const left = Math.min(...seen.map((rect) => rect.left));
  const top = Math.min(...seen.map((rect) => rect.top));
  const right = Math.max(...seen.map((rect) => rect.right));
  const bottom = Math.max(...seen.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

const sameBox = (left: Box | null, right: Box | null) =>
  left === right ||
  (left !== null && right !== null && left.left === right.left && left.top === right.top && left.width === right.width && left.height === right.height);

/**
 * A guided tour over a page: the part a step is about lit up, everything else dimmed, and a
 * small card beside it. The page stays usable — the dim does not catch the pointer — so a
 * step can ask to try the very thing it shows, and watch for it being done.
 *
 * Drawn over everything but menus and bubbles, and kept in step with the page as it moves:
 * a pop-over opening, the window scrolling.
 */
export function FormTour({
  steps,
  at,
  onStep,
  onClose,
}: {
  steps: TourStep[];
  at: number;
  onStep: (next: number) => void;
  /** Asked to end: the X, Escape, or the last step's Finish. */
  onClose: () => void;
}) {
  const step = steps[at];
  const [box, setBox] = useState<Box | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const last = at === steps.length - 1;

  // Where the lit part is, every frame while the tour is on: it moves as the page does.
  const target = step?.target;
  useEffect(() => {
    let stopped = false;
    const later = (then: () => void) =>
      typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(then) : window.setTimeout(then, 16);
    const follow = () => {
      if (stopped) return;
      const next = boxOf(target?.() ?? null);
      setBox((current) => (sameBox(current, next) ? current : next));
      later(follow);
    };
    follow();
    return () => {
      stopped = true;
    };
  }, [target]);

  // A new step brings its part into view, if it is not.
  const stepId = step?.id;
  useEffect(() => {
    const found = target?.() ?? null;
    const parts = (Array.isArray(found) ? found : [found]).filter((element): element is Element => Boolean(element));
    if (!parts.length) return;
    // Brought into view whole if it fits, else from its top: all of it, not what shows now.
    const rects = parts.map((element) => element.getBoundingClientRect());
    const top = Math.min(...rects.map((rect) => rect.top));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    const frame = scrollersOf(parts[0])[0]?.getBoundingClientRect();
    const roomTop = Math.max(0, frame?.top ?? 0);
    const roomBottom = Math.min(window.innerHeight, frame?.bottom ?? window.innerHeight);
    if (top < roomTop || bottom > roomBottom) {
      parts[0].scrollIntoView?.({ block: bottom - top > roomBottom - roomTop ? "start" : "center", behavior: "smooth" });
    }
    // Only when the step changes, not every time the page redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId]);

  // Done: a beat to see it was, then on to the next.
  const done = Boolean(step?.tryIt && step.done);
  useEffect(() => {
    if (!done || last) return;
    const timer = window.setTimeout(() => onStep(at + 1), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [done, at, last, onStep]);

  // Escape ends the tour, and only the tour: caught before the window round the form sees it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A pop-over of the page's own, open over it, closes first.
      const popover = (event.target as Element | null)?.closest?.('[role="dialog"]:not([aria-modal="true"])');
      if (popover && !card.current?.contains(popover)) return;
      event.stopPropagation();
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);

  // The card beside the lit part: under it, else over it, else beside it, else in a corner.
  useLayoutEffect(() => {
    const held = card.current;
    if (!held) return;
    const width = held.offsetWidth;
    const height = held.offsetHeight;
    const roomX = window.innerWidth;
    const roomY = window.innerHeight;
    const clampX = (left: number) => Math.max(GAP, Math.min(left, roomX - width - GAP));
    const clampY = (top: number) => Math.max(GAP, Math.min(top, roomY - height - GAP));
    let next: { left: number; top: number };
    if (!box) next = { left: (roomX - width) / 2, top: (roomY - height) / 2 };
    else if (box.top + box.height + PAD + GAP + height <= roomY - GAP) next = { left: clampX(box.left), top: box.top + box.height + PAD + GAP };
    else if (box.top - PAD - GAP - height >= GAP) next = { left: clampX(box.left), top: box.top - PAD - GAP - height };
    else if (box.left + box.width + PAD + GAP + width <= roomX - GAP) next = { left: box.left + box.width + PAD + GAP, top: clampY(box.top) };
    else if (box.left - PAD - GAP - width >= GAP) next = { left: box.left - PAD - GAP - width, top: clampY(box.top) };
    else next = { left: roomX - width - GAP, top: roomY - height - GAP };
    setPlace((current) => (current && current.left === next.left && current.top === next.top ? current : next));
  }, [box, at, done]);

  if (!step) return null;
  return createPortal(
    <>
      {/* The dim, with the lit part cut out of it; it lets the pointer through to the page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-[95] rounded-lg ring-2 ring-[#5b8fc4] motion-safe:transition-all motion-safe:duration-300"
        style={
          box
            ? {
                left: box.left - PAD,
                top: box.top - PAD,
                width: box.width + PAD * 2,
                height: box.height + PAD * 2,
                boxShadow: "0 0 0 9999px rgba(16, 24, 40, 0.42), 0 0 0 6px rgba(91, 143, 196, 0.25)",
              }
            : { left: "50%", top: "50%", width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(16, 24, 40, 0.42)" }
        }
      />
      <div
        ref={card}
        role="dialog"
        aria-modal="false"
        aria-label={`Guided tour: ${step.title}`}
        className="pointer-events-auto fixed z-[105] w-[min(20rem,calc(100vw-1.5rem))] rounded-xl border border-[#d9dee7] bg-white p-4 shadow-xl motion-safe:transition-[left,top] motion-safe:duration-300"
        style={place ?? { left: -9999, top: 0 }}
        // Inside a window that closes on a press outside it, the card counts as inside.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <Compass size={14} className="text-[#1f4e79]" aria-hidden="true" />
          <span className="flex items-center gap-1" aria-hidden="true">
            {steps.map((each, index) => (
              <span
                key={each.id}
                className={`h-1.5 rounded-full motion-safe:transition-all ${index === at ? "w-4 bg-[#1f4e79]" : index < at ? "w-1.5 bg-[#7fa6cc]" : "w-1.5 bg-[#d9dee7]"}`}
              />
            ))}
          </span>
          <span className="text-[11px] font-semibold tabular-nums text-[#98a2b3]">
            {at + 1} of {steps.length}
          </span>
          <button
            type="button"
            aria-label="End the tour"
            onClick={onClose}
            className="-mr-1 ml-auto rounded p-1 text-[#98a2b3] hover:bg-[#f2f4f7] hover:text-[#344054]"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div aria-live="polite">
          <p className="mt-2 text-sm font-semibold text-[#171717]">{step.title}</p>
          <div className="mt-1 text-[13px] leading-5 text-[#475467]">{step.body}</div>
          {step.tryIt ? (
            done ? (
              <p className="mt-3 flex items-center gap-1.5 rounded-md bg-[#e7f4ec] px-2.5 py-1.5 text-xs font-semibold text-[#2e7d55]">
                <Check size={14} aria-hidden="true" /> Nicely done
              </p>
            ) : (
              <p className="mt-3 flex items-start gap-1.5 rounded-md bg-[#eef4fa] px-2.5 py-1.5 text-xs font-semibold text-[#1f4e79]">
                <MousePointerClick size={14} className="mt-px shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
                <span>
                  <span className="font-normal text-[#5b7a99]">Try it: </span>
                  {step.tryIt}
                </span>
              </p>
            )
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-2">
          {at > 0 ? (
            <button
              type="button"
              onClick={() => onStep(at - 1)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-[#667085] hover:bg-[#f2f4f7] hover:text-[#344054]"
            >
              <ArrowLeft size={13} aria-hidden="true" /> Back
            </button>
          ) : null}
          <span className="ml-auto flex items-center gap-2">
            {step.actions?.length ? (
              step.actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.onClick}
                  className={
                    action.primary
                      ? "rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white"
                      : "rounded-md border border-[#d0d5dd] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
                  }
                >
                  {action.label}
                </button>
              ))
            ) : last ? (
              <button type="button" onClick={onClose} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white">
                Finish
              </button>
            ) : step.tryIt && !done ? (
              <button
                type="button"
                onClick={() => onStep(at + 1)}
                className="rounded-md border border-[#d0d5dd] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
              >
                Skip
              </button>
            ) : (
              <button type="button" onClick={() => onStep(at + 1)} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white">
                Next
              </button>
            )}
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}

const SEEN = "coordinator-tools:preferences-tour";

/** Whether this browser has been offered the tour already; a browser that keeps nothing has not. */
export function tourOffered(): boolean {
  try {
    return window.localStorage.getItem(SEEN) === "offered";
  } catch {
    return false;
  }
}

export function rememberTourOffered(): void {
  try {
    window.localStorage.setItem(SEEN, "offered");
  } catch {
    // Not kept: it is offered again next time, which is all that is lost.
  }
}

/** The offer, the first time the form is opened in a browser: take the tour, or not now. */
export function TourInvite({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#cfe0f1] bg-[#f4f8fc] px-3.5 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-[#1f4e79] shadow-sm">
        <Compass size={16} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm">
        <span className="block font-semibold text-[#171717]">New to this form?</span>
        <span className="block text-[13px] text-[#475467]">
          A one-minute tour shows each part, and lets you try it as you go. Nothing is kept unless you save.
        </span>
      </span>
      <span className="flex items-center gap-2">
        <button type="button" onClick={onDismiss} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-[#667085] hover:bg-white">
          Not now
        </button>
        <button type="button" onClick={onStart} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white">
          Take the tour
        </button>
      </span>
    </div>
  );
}
