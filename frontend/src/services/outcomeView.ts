/**
 * How the learning outcomes' two tables are shown (11 Nov 2026): both on the page, one above
 * the other, or as two tabs — PLO alignment and competencies — one at a time. Each person's
 * choice, kept in their browser; both tables until they choose.
 */
import { useState } from "react";

export type OutcomeView = "both" | "tabs";

const KEY = "scen-syllabus-outcomes-view";

export function readOutcomeView(): OutcomeView {
  try {
    return window.localStorage.getItem(KEY) === "tabs" ? "tabs" : "both";
  } catch {
    return "both";
  }
}

export function useOutcomeView(): [OutcomeView, (view: OutcomeView) => void] {
  const [view, setView] = useState<OutcomeView>(readOutcomeView);
  const choose = (next: OutcomeView) => {
    setView(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Kept for this visit only.
    }
  };
  return [view, choose];
}
