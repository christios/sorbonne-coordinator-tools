import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Compass, MousePointerClick, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * One step of a guided tour: a part of the page lit up, a sentence or two about it, and
 * something to try there. A step with something to try offers Next once it is done.
 */
export type TourStep = {
  id: string;
  title: string;
  /** A line before the steps, if any: "Your click opened this box." */
  body?: ReactNode;
  /** What to do, in order: numbered on the card. */
  steps?: ReactNode[];
  /**
   * The controls this step is about: a press reaches them, and nothing else on the page — not
   * even the rest of the lit part. None: only the card works.
   */
  allow?: () => Element | null | undefined | (Element | null | undefined)[];
  /**
   * Something to try before going on: "Drag down a few hours on any day." With numbered steps,
   * which say how, it is not shown again — the card says only "Your turn".
   */
  tryIt?: ReactNode;
  /** The thing to try has been done. */
  done?: boolean;
  /** Done, go on by itself after this many milliseconds, with no Next to press. */
  autoNext?: number;
  /** What "Nicely done" says on this step: "Nicely done: opening it…". */
  doneWords?: string;
  /** Done, straight on to the next step: no "Nicely done", no Next. */
  instantNext?: boolean;
  /** The control to try, inside the lit part: an arrow bounces beside it. */
  pointAt?: () => Element | null | undefined;
  /** Where the arrow sits: over the control (the default) or to its left, pointing right. */
  pointFrom?: "above" | "left";
  /**
   * The part of the page to light up — or several, lit as one (as one each, with `apart`: a
   * group in its own array lit as one); none puts the card in the middle.
   */
  target?: () => Parts;
  /** Each of the target's parts lit on its own, the dim between them: not one box round them all. */
  apart?: boolean;
  /** Buttons in place of Next, for the last step: keep or clear what was tried. */
  actions?: { label: string; onClick: () => void; primary?: boolean }[];
};

type Part = Element | null | undefined;
/** One part of the page, or several, or groups of several. */
export type Parts = Part | (Part | Part[])[];

type Box = { left: number; top: number; width: number; height: number };

/** A thin bar filling up while "Nicely done" shows, on a step that goes on by itself. */
function Countdown({ ms }: { ms: number }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setFull(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0 left-0 h-0.5 rounded-full bg-[#2e7d55]/50"
      style={{ width: full ? "100%" : "0%", transition: `width ${ms}ms linear` }}
    />
  );
}

/** Room kept round the lit part, and between it and the card. */
const PAD = 6;
const GAP = 12;


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
function boxOf(found: Parts): Box | null {
  const seen = (Array.isArray(found) ? found.flat() : [found])
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
const sameBoxes = (left: Box[], right: Box[]) => left.length === right.length && left.every((box, index) => sameBox(box, right[index]));

/** The parts lit, each a box: one round them all, or, `apart`, one for each part or group. */
function litBoxes(found: Parts, apart: boolean): Box[] {
  const boxes = apart && Array.isArray(found) ? found.map((entry) => boxOf(entry)) : [boxOf(found)];
  return boxes.filter((box): box is Box => box !== null);
}

/** One box round several. */
function unite(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  const right = Math.max(...boxes.map((box) => box.left + box.width));
  const bottom = Math.max(...boxes.map((box) => box.top + box.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** A box as an SVG rectangle's place, grown by `out` on every side. */
const rectOf = (box: Box, out = 0) => ({ x: box.left - out, y: box.top - out, width: box.width + out * 2, height: box.height + out * 2 });

const padded = (box: Box): Box => ({ left: box.left - PAD, top: box.top - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 });

/** What is left of one box once another is taken out of it: none to four boxes, side by side. */
function minus(from: Box, out: Box): Box[] {
  const [right, bottom] = [from.left + from.width, from.top + from.height];
  const [outRight, outBottom] = [out.left + out.width, out.top + out.height];
  if (out.left >= right || outRight <= from.left || out.top >= bottom || outBottom <= from.top) return [from];
  const left: Box[] = [];
  if (out.top > from.top) left.push({ left: from.left, top: from.top, width: from.width, height: out.top - from.top });
  if (outBottom < bottom) left.push({ left: from.left, top: outBottom, width: from.width, height: bottom - outBottom });
  const top = Math.max(from.top, out.top);
  const height = Math.min(bottom, outBottom) - top;
  if (out.left > from.left) left.push({ left: from.left, top, width: out.left - from.left, height });
  if (outRight < right) left.push({ left: outRight, top, width: right - outRight, height });
  return left;
}

/**
 * The dim as boxes side by side: the screen, less each lit box. A blur behind a cut-out outline
 * blurs the cut-outs too in some browsers; boxes that only cover what is dimmed do not.
 */
function dimBoxes(lit: Box[], screen: Box): Box[] {
  // On whole pixels, each lit box grown to the pixel: boxes meeting between pixels leave a hairline.
  const whole = (box: Box): Box => {
    const [left, top] = [Math.floor(box.left), Math.floor(box.top)];
    return { left, top, width: Math.ceil(box.left + box.width) - left, height: Math.ceil(box.top + box.height) - top };
  };
  let pieces = [whole(screen)];
  for (const box of lit.map((each) => whole(padded(each)))) pieces = pieces.flatMap((piece) => minus(piece, box));
  return pieces;
}

/**
 * What a press may always reach during a tour: the card, and a menu opened from a control the
 * step allows. Not any dialog: the form may itself sit in one, close button and all.
 */
const STILL_REACHED = '[data-tour-card], [role="listbox"]';

/**
 * A guided tour over a page: the part a step is about lit up, everything else dimmed, and a
 * card beside it, saying what to do in numbered steps. Only the controls a step is about
 * work, so it can ask to try the very thing it shows and watch for it being done; a press
 * anywhere else does nothing but shake the card, which says the tour is where to look. The
 * card asks to be read: a coloured band, and each step arrives with a glow round it.
 *
 * Drawn over everything but menus and bubbles, and kept in step with the page as it moves:
 * a pop-over opening, the window scrolling. Scrolling is never stopped.
 */
export function FormTour({
  steps,
  at,
  onStep,
  onClose,
  endWords,
  hint = false,
}: {
  steps: TourStep[];
  at: number;
  onStep: (next: number) => void;
  /** Ended: the last step's Finish, or the X (or Escape) once the reader is sure. */
  onClose: () => void;
  /** What ending the tour early means, said in the "are you sure" before it ends. */
  endWords?: string;
  /**
   * A single card, not a tour: the suggestion to take one, or how to take it again. No step
   * count, and its × (or Escape) closes it at once.
   */
  hint?: boolean;
}) {
  const step = steps[at];
  const [box, setBox] = useState<Box | null>(null);
  // The parts lit, each its own box (one, unless the step lights them apart).
  const [holes, setHoles] = useState<Box[]>([]);
  // The rings' masks, by a name of this tour's own.
  const ringId = `tour-ring-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // The window's size, for the dim to cover it all: told again when it changes.
  const [screen, setScreen] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resized = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  // Where the arrow points: the control the step asks to try.
  const [arrow, setArrow] = useState<Box | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // The X pressed: are you sure?
  const [asking, setAsking] = useState(false);
  const last = at === steps.length - 1;
  // The card glides from step to step, but not on its first showing: it appears where it goes.
  const [gliding, setGliding] = useState(false);
  // Presses on the dimmed page, counted to shake the card each time; and whether to say why.
  const [nudges, setNudges] = useState(0);
  const [saying, setSaying] = useState(false);

  // Where the lit part is, and the control the arrow points at, every frame while the tour is on:
  // they move as the page does. Read from the step as it is now, not as it was when it began.
  const target = step?.target;
  const targetNow = useRef(target);
  targetNow.current = target;
  const apartNow = useRef(Boolean(step?.apart));
  apartNow.current = Boolean(step?.apart);
  const pointNow = useRef(step?.pointAt);
  pointNow.current = step?.pointAt;
  useEffect(() => {
    let stopped = false;
    const later = (then: () => void) =>
      typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(then) : window.setTimeout(then, 16);
    const follow = () => {
      if (stopped) return;
      const lit = litBoxes(targetNow.current?.() ?? null, apartNow.current);
      setHoles((current) => (sameBoxes(current, lit) ? current : lit));
      const next = unite(lit);
      setBox((current) => (sameBox(current, next) ? current : next));
      const pointed = boxOf(pointNow.current?.() ?? null);
      setArrow((current) => (sameBox(current, pointed) ? current : pointed));
      later(follow);
    };
    follow();
    return () => {
      stopped = true;
    };
  }, []);

  /*
   * A press on anything the step is not about reaches nothing: caught before the page sees it,
   * it shakes the card. Judged by what is pressed, not where, so a click from the keyboard
   * (Enter, Space on the control in focus) is held to the same.
   */
  const allowNow = useRef(step?.allow);
  allowNow.current = step?.allow;
  const askingNow = useRef(asking);
  askingNow.current = asking;
  useEffect(() => {
    const outside = (event: MouseEvent) => {
      // Asking whether to end the tour: its question is to be answered.
      if (askingNow.current) return;
      const pressed = event.target as Element | null;
      if (pressed?.closest?.(STILL_REACHED)) return;
      const allowed = allowNow.current?.() ?? [];
      if ((Array.isArray(allowed) ? allowed : [allowed]).some((element) => element && pressed && element.contains(pressed))) return;
      event.preventDefault();
      event.stopPropagation();
      // A pointer's press, or a mouse's where there is no pointer event before it.
      if (event.type === "pointerdown" || event.type === "mousedown") {
        setNudges((count) => count + 1);
        setSaying(true);
      }
    };
    // Not the let-go: a stroke started in the lit part may end outside it, and must still end.
    const kinds = ["pointerdown", "mousedown", "click"] as const;
    for (const kind of kinds) window.addEventListener(kind, outside, true);
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, outside, true);
    };
  }, []);
  useEffect(() => {
    if (!saying) return;
    const timer = window.setTimeout(() => setSaying(false), 3500);
    return () => window.clearTimeout(timer);
  }, [saying, nudges]);

  const stepId = step?.id;
  // A part lit up is brought into view if it is not — on a new step, and when the part changes
  // within one (a pop-over opening a moment after the step starts).
  const shown = useRef<Element[]>([]);
  useEffect(() => {
    let stopped = false;
    const later = (then: () => void) =>
      typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(then) : window.setTimeout(then, 16);
    const look = () => {
      if (stopped) return;
      const found = targetNow.current?.() ?? null;
      const parts = (Array.isArray(found) ? found.flat() : [found]).filter((element): element is Element => Boolean(element));
      const added = parts.filter((part) => !shown.current.includes(part));
      if (parts.length && shown.current.length && added.length) {
        // A part come within the step — a box opened: brought into view itself, by as little as
        // it takes, the rest kept where it is as far as it can be.
        shown.current = parts;
        added[added.length - 1].scrollIntoView?.({ block: "nearest" });
      } else if (parts.length && added.length) {
        shown.current = parts;
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
      } else if (parts.length !== shown.current.length) {
        // A part gone (a box closed): nothing to bring into view.
        shown.current = parts;
      }
      later(look);
    };
    shown.current = [];
    look();
    return () => {
      stopped = true;
    };
  }, [stepId]);

  // Done: "Nicely done", and Next — the reader goes on when they have seen it. A step that
  // goes on by itself does so after its moment, a bar filling meanwhile.
  const done = Boolean(step?.tryIt && step.done);
  const autoNext = done && !last ? step?.autoNext : undefined;
  const instant = done && !last && Boolean(step?.instantNext);
  useEffect(() => {
    if (instant) onStep(at + 1);
  }, [instant, at, onStep]);
  useEffect(() => {
    if (!autoNext) return;
    const timer = window.setTimeout(() => onStep(at + 1), autoNext);
    return () => window.clearTimeout(timer);
  }, [autoNext, at, onStep]);

  // Escape asks to end the tour, as the X does, and answers "no" when asked: only the tour, caught
  // before the window round the form sees it.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // A pop-over of the page's own, open over it, closes first.
      const popover = (event.target as Element | null)?.closest?.('[role="dialog"]:not([aria-modal="true"])');
      if (!asking && popover && !card.current?.contains(popover)) return;
      event.stopPropagation();
      event.preventDefault();
      if (hint) onClose();
      else setAsking((now) => !now);
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [asking, hint, onClose]);

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
  useEffect(() => {
    if (!place || gliding) return;
    const timer = window.setTimeout(() => setGliding(true), 50);
    return () => window.clearTimeout(timer);
  }, [place, gliding]);

  if (!step) return null;
  return createPortal(
    <>
      {/*
       * The dim, dark and blurred, round the lit parts; and a ring round each lit part.
       * Presses on the dim are caught above, not by it.
       */}
      {dimBoxes(holes, { left: -40, top: -40, width: screen.width + 80, height: screen.height + 80 }).map((piece, index) => (
        <div
          key={index}
          aria-hidden="true"
          data-tour-dim
          className="pointer-events-none fixed z-[95]"
          style={{ ...piece, backgroundColor: "rgba(16, 24, 40, 0.72)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
        />
      ))}
      {/*
       * A ring round the lit parts, as one shape: each part's ring is hidden where it runs inside
       * another lit part, so no line crosses a box lying over the calendar.
       */}
      <svg aria-hidden="true" className="pointer-events-none fixed inset-0 z-[95] h-full w-full">
        <defs>
          {holes.map((_, index) => (
            <mask key={index} id={`${ringId}-${index}`} maskUnits="userSpaceOnUse" x={-50} y={-50} width={screen.width + 100} height={screen.height + 100}>
              <rect x={-50} y={-50} width={screen.width + 100} height={screen.height + 100} fill="white" />
              {holes.map((other, at) => (at === index ? null : <rect key={at} {...rectOf(padded(other))} fill="black" />))}
            </mask>
          ))}
        </defs>
        {holes.map((hole, index) => {
          const ring = padded(hole);
          return (
            <g key={index} data-tour-lit mask={`url(#${ringId}-${index})`} fill="none">
              <rect {...rectOf(ring, 5)} rx={8} stroke="rgba(91, 143, 196, 0.35)" strokeWidth={6} />
              <rect {...rectOf(ring, 1)} rx={4} stroke="#5b8fc4" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      {arrow
        ? (() => {
            // Here: a bouncing arrow at the control to try — to its left if the step says so and
            // there is room, else over it, else under it.
            const from = step.pointFrom === "left" && arrow.left > 40 ? "left" : arrow.top > 44 ? "above" : "below";
            const place =
              from === "left"
                ? { left: arrow.left - 36, top: arrow.top + arrow.height / 2 - 14 }
                : from === "above"
                  ? { left: arrow.left + arrow.width / 2 - 14, top: arrow.top - 34 }
                  : { left: arrow.left + arrow.width / 2 - 14, top: arrow.top + arrow.height + 6 };
            const Icon = from === "left" ? ArrowRight : from === "above" ? ArrowDown : ArrowUp;
            return (
              <span aria-hidden="true" data-tour-arrow={from} className="pointer-events-none fixed z-[104]" style={place}>
                <span className={`grid h-7 w-7 place-items-center rounded-full bg-[#1f4e79] text-white shadow-lg ring-2 ring-white tour-arrow-${from}`}>
                  <Icon size={15} strokeWidth={2.5} />
                </span>
              </span>
            );
          })()
        : null}
      <div
        ref={card}
        data-tour-card
        role="dialog"
        aria-modal="false"
        aria-label={`Guided tour: ${step.title}`}
        className={`pointer-events-auto fixed z-[105] w-[min(22rem,calc(100vw-1.5rem))] ${gliding ? "motion-safe:transition-[left,top] motion-safe:duration-300" : ""}`}
        style={place ?? { left: -9999, top: 0 }}
        // Inside a window that closes on a press outside it, the card counts as inside.
        onMouseDown={(event) => event.stopPropagation()}
      >
        {/* Each step arrives: the card rises in, a glow spreading round it. */}
        <div key={step.id} className="tour-card-in">
          <div key={nudges} className={`relative rounded-xl border-2 border-[#1f4e79] bg-white shadow-2xl ${nudges ? "tour-card-shake" : ""}`}>
            <span aria-hidden="true" key={`glow-${step.id}`} className="tour-card-glow pointer-events-none absolute -inset-0.5 rounded-xl" />
            <div className="flex items-center gap-2 rounded-t-[10px] bg-[#1f4e79] px-3.5 py-2 text-white">
              <Compass size={15} aria-hidden="true" />
              <span className="text-xs font-semibold">Guided tour</span>
              {hint ? (
                <span className="mr-auto" />
              ) : (
                <>
                  <span className="ml-1 flex items-center gap-1" aria-hidden="true">
                    {steps.map((each, index) => (
                      <span
                        key={each.id}
                        className={`h-1.5 rounded-full motion-safe:transition-all ${index === at ? "w-4 bg-white" : index < at ? "w-1.5 bg-white/70" : "w-1.5 bg-white/30"}`}
                      />
                    ))}
                  </span>
                  <span className="mr-auto text-[11px] font-semibold tabular-nums text-white/80">
                    {at + 1} of {steps.length}
                  </span>
                </>
              )}
              <button
                type="button"
                aria-label={hint ? "Close" : "End the tour"}
                onClick={() => (hint ? onClose() : setAsking(true))}
                className="-mr-1 rounded p-1 text-white/80 hover:bg-white/15 hover:text-white"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="px-4 pb-4 pt-3">
              <div aria-live="polite">
                <p className="text-base font-semibold text-[#171717]">{step.title}</p>
                {step.body ? <div className="mt-1 text-[13px] leading-5 text-[#475467]">{step.body}</div> : null}
                {step.steps?.length ? (
                  <ol className="mt-2 grid gap-1.5 text-[13px] leading-5 text-[#344054]">
                    {step.steps.map((said, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#1f4e79] text-[10px] font-semibold text-white"
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="sr-only">{index + 1}. </span>
                          {said}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                {/* What to try: the numbered steps say it, when there are any; the box says it otherwise. Done, it says so. */}
                {step.tryIt ? (
                  done && !instant ? (
                    <p className="relative mt-3 flex items-center gap-1.5 overflow-hidden rounded-md bg-[#e7f4ec] px-2.5 py-2 text-[13px] font-semibold text-[#2e7d55]">
                      <Check size={15} aria-hidden="true" /> {step.doneWords ?? "Nicely done"}
                      {autoNext ? <Countdown key={at} ms={autoNext} /> : null}
                    </p>
                  ) : step.steps?.length ? null : (
                    <p className="mt-3 flex items-start gap-2 rounded-md border border-[#9cc0e4] bg-[#eef4fa] px-2.5 py-2 text-[13px] font-semibold text-[#1f4e79]">
                      <MousePointerClick size={15} className="mt-0.5 shrink-0 motion-safe:animate-pulse" aria-hidden="true" />
                      <span>
                        <span className="font-normal text-[#5b7a99]">Try it: </span>
                        {step.tryIt}
                      </span>
                    </p>
                  )
                ) : null}
                {saying ? (
                  <p role="status" className="mt-2 rounded-md bg-[#fdf6e3] px-2.5 py-1.5 text-xs text-[#7a5d00]">
                    {step.allow || step.tryIt
                      ? "During the tour, only what this step asks for works. Follow the steps on the card, or end the tour with ×."
                      : "Nothing on the page is to be clicked at this step: read the card, then go on with its button."}
                  </p>
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
                  ) : autoNext ? null : step.tryIt && !done ? (
                    // Nothing to skip: a step with something to try offers Next once it is tried.
                    step.steps?.length ? (
                      // The numbered steps say what; this only says it is to be done before going on.
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4e79]">
                        <MousePointerClick size={13} className="motion-safe:animate-pulse" aria-hidden="true" /> Your turn
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#98a2b3]">Try it to go on</span>
                    )
                  ) : (
                    <button type="button" onClick={() => onStep(at + 1)} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white">
                      Next
                    </button>
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={asking}
        title="End the guided tour?"
        description={endWords ?? "You can take it again from Guided tour."}
        confirmLabel="End the tour"
        cancelLabel="Keep going"
        onConfirm={() => {
          setAsking(false);
          onClose();
        }}
        onClose={() => setAsking(false)}
      />
    </>,
    document.body,
  );
}

const TAKEN = "coordinator-tools:preferences-tour";

/** Whether the tour has been taken to its end in this browser; a browser that keeps nothing has not. */
export function tourTaken(): boolean {
  try {
    return window.localStorage.getItem(TAKEN) === "taken";
  } catch {
    return false;
  }
}

export function rememberTourTaken(): void {
  try {
    window.localStorage.setItem(TAKEN, "taken");
  } catch {
    // Not kept: the tour is asked for again next time, which is all that is lost.
  }
}
