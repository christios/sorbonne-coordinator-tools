import type { MouseEvent } from "react";

/**
 * A press on the dimmed backdrop itself closes the dialog; a press anywhere in it does not.
 *
 * The dialog used to stop every press inside it from going further instead, so the press
 * never reached the page — and a calendar, a menu or a bubble open inside the dialog, which
 * folds away on a press elsewhere only once that press has gone all the way through, stayed
 * open whatever was clicked (24 Nov 2026). A dialog opened over another one is safe the same
 * way: the press lands inside the top one, never on the backdrop below.
 */
export function closeOnBackdrop(onClose: () => void) {
  return (event: MouseEvent) => {
    if (event.target === event.currentTarget) onClose();
  };
}
