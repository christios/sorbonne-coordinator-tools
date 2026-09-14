/**
 * Escape in a search box drops focus and keeps the text.
 *
 * A search box is where the keyboard is when a coordinator wants the table back — the
 * arrow keys, the shortcuts — and Escape is the key that says so. Left to itself the
 * browser empties a search field on Escape, which throws away the narrowing they just
 * typed; and a dialog listening for Escape would close over their heads. So this runs
 * first, on the way down, takes the focus off the box and lets nothing else see the key.
 * A second Escape, with nothing focused, reaches whatever was listening.
 */
export function blurSearchOnEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false;
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || active.type !== "search") return false;
  event.preventDefault();
  event.stopPropagation();
  active.blur();
  return true;
}

/** Install once, at the root. Returns the uninstall. */
export function installSearchEscape(target: Document = document): () => void {
  const listener = (event: KeyboardEvent) => void blurSearchOnEscape(event);
  target.addEventListener("keydown", listener, true);
  return () => target.removeEventListener("keydown", listener, true);
}
