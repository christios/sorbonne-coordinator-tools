import { useLayoutEffect, useRef } from "react";

/**
 * As tall as the room below it, and no taller.
 *
 * A height chosen in advance is wrong on every screen but the one it was chosen on: forty
 * rems stops short on a tall monitor and scrolls on a laptop, so neither shows the whole
 * list. Measured against what is actually below — the window, or whichever ancestor
 * scrolls, less whatever comes after it on the page — a pane is as long as there is room
 * for, wherever it is read, and the page itself never grows a scrollbar of its own.
 */
/** A gap under the table, so it does not sit flush against the bottom of the window. */
const BOTTOM_GAP = 16;

/** The nearest ancestor that scrolls, which is the bottom the table has to fit inside. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/**
 * Everything that comes after the table inside the page: the count line under it, the
 * padding of whatever wraps it. The table has to leave room for all of it, or the page
 * itself starts scrolling and the table's own scrollbar stops being the one that matters.
 */
function spaceBelow(element: HTMLElement, scroller: HTMLElement | null): number {
  let below = 0;
  for (let node: HTMLElement | null = element; node && node !== scroller; node = node.parentElement) {
    for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
      const box = sibling.getBoundingClientRect();
      if (box.height) below += box.height + parseFloat(getComputedStyle(sibling).marginTop || "0");
    }
    const parent = node.parentElement;
    if (parent && parent !== scroller) below += parseFloat(getComputedStyle(parent).paddingBottom || "0");
  }
  return below;
}

/**
 * Bound an element by whatever height is left below it.
 *
 * Measured rather than guessed: the toolbar above wraps at narrow widths and grows a row
 * when filters are added, and pages put a count line under the table, so any fixed
 * `100vh - something` is wrong as soon as the page is not the shape it was written for.
 * The bottom to fit inside is the scrolling container's, not the window's — inside a tool
 * with its own scrolling pane those are not the same edge.
 */
export function useFillHeight<T extends HTMLElement = HTMLElement>({ fill = false } = {}) {
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    const fit = () => {
      const top = element.getBoundingClientRect().top;
      const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
      const room = bottom - top - spaceBelow(element, scroller) - BOTTOM_GAP;
      const height = `${Math.max(240, Math.floor(room))}px`;
      /*
       * A definite height, not merely a ceiling, when something inside has to scroll.
       *
       * A box with only a `max-height` has no height for its children to measure against,
       * so a pane told to scroll inside it simply grew and was clipped instead. The table
       * wants the ceiling — it is as tall as its rows and no taller; a pair of panes wants
       * the height, so each of them can be exactly as tall as the room and scroll.
       */
      element.style.maxHeight = height;
      if (fill) element.style.height = height;
    };
    fit();
    window.addEventListener("resize", fit);
    const watcher = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    // The page grows and shrinks around the table — a banner appears, a filter wraps, a
    // count line changes — and each of those moves the room it has.
    if (watcher) {
      if (scroller) watcher.observe(scroller);
      if (element.parentElement) watcher.observe(element.parentElement);
      for (let node: HTMLElement | null = element; node && node !== scroller; node = node.parentElement) {
        for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          watcher.observe(sibling);
        }
      }
    }
    return () => {
      window.removeEventListener("resize", fit);
      watcher?.disconnect();
    };
  }, [fill]);

  return ref;
}

