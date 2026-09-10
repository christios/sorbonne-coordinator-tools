import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** A gap under the box, so it does not sit flush against the bottom of the window. */
const BOTTOM_GAP = 16;

/** The nearest ancestor that scrolls, which is the bottom the box has to fit inside. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * Everything that comes after the box inside the page: the count line under it, and the
 * padding and borders of everything it sits inside. The box has to leave room for all of
 * it, or the page keeps a sliver of scroll of its own — and a sliver is worse than a page
 * full, because the wheel then has somewhere to go and nowhere to show it.
 */
function spaceBelow(element: HTMLElement, scroller: HTMLElement | null): number {
  let below = 0;
  for (let node: HTMLElement | null = element; node && node !== scroller; node = node.parentElement) {
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const box = sibling.getBoundingClientRect();
      if (box.height) below += box.height + parseFloat(getComputedStyle(sibling).marginTop || "0");
    }
    // The padding of a box it sits inside is room it does not have either.
    if (node !== element) below += parseFloat(getComputedStyle(node).paddingBottom || "0");
  }
  return below;
}

/**
 * As tall as the room below it, and no taller.
 *
 * A height chosen in advance is wrong on every screen but the one it was chosen on: forty
 * rems stops short on a tall monitor and scrolls on a laptop, so neither shows the whole
 * list. Measured against what is actually below — the window, or whichever ancestor
 * scrolls, less whatever comes after it on the page — a pane is as long as there is room
 * for, wherever it is read, and the page itself never grows a scrollbar of its own.
 *
 * The element arrives through a callback ref rather than a plain one, because it is not
 * always there when the component first mounts: a page that says "choose a semester"
 * before it can draw its panes attaches them a render or two later, and an effect that
 * had already run and found nothing never ran again. The panes then kept their natural
 * height, overflowed the window, and — being told not to chain their scrolling outward —
 * swallowed the wheel instead of moving at all.
 *
 * `fill` sets a height and not merely a ceiling. A box with only a `max-height` gives its
 * children nothing to measure against, so a pane told to scroll inside one grows and is
 * clipped. The table wants the ceiling — it is as tall as its rows and no taller; a pair
 * of panes wants the height, so each is exactly as tall as the room and scrolls.
 */
export function useFillHeight<T extends HTMLElement = HTMLElement>({ fill = false } = {}): {
  ref: (element: T | null) => void;
  /** The element itself, for anything that has to measure it. */
  box: React.RefObject<T | null>;
} {
  const box = useRef<T | null>(null);
  const [node, setNode] = useState<T | null>(null);
  const ref = useCallback((element: T | null) => {
    box.current = element;
    setNode(element);
  }, []);

  useLayoutEffect(() => {
    if (!node) return;
    const scroller = scrollerOf(node);
    const fit = () => {
      /*
       * Measured down the scrolled content, not across the window.
       *
       * Viewport coordinates only describe a box while it is in view, and this box decides
       * how tall the page is: get the height wrong once, the page overflows, somebody
       * scrolls, and the next measurement puts the box's top below the window's bottom and
       * reads the room as a negative number. Its offset within the thing that scrolls does
       * not move when that thing is scrolled, so that is what it is measured from.
       */
      const rect = node.getBoundingClientRect();
      const within = scroller
        ? rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop
        : rect.top + window.scrollY;
      const visible = scroller ? scroller.clientHeight : window.innerHeight;
      const room = visible - within - spaceBelow(node, scroller) - BOTTOM_GAP;
      const height = `${Math.max(240, Math.floor(room))}px`;
      node.style.maxHeight = height;
      if (fill) node.style.height = height;
    };
    fit();
    window.addEventListener("resize", fit);
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    // The page grows and shrinks around the box — a banner appears, a filter wraps, a
    // count line changes — and each of those moves the room it has.
    if (watcher) {
      if (scroller) watcher.observe(scroller);
      if (node.parentElement) watcher.observe(node.parentElement);
      for (let element: HTMLElement | null = node; element && element !== scroller; element = element.parentElement) {
        for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          watcher.observe(sibling);
        }
      }
    }
    return () => {
      window.removeEventListener("resize", fit);
      watcher?.disconnect();
    };
  }, [node, fill]);

  return { ref, box };
}
