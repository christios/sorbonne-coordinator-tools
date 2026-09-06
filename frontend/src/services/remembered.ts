/**
 * The small choices a page should still be holding when you come back to it.
 *
 * A coordinator works a year at a time: they open L1 on Groups & CRNs, look at what
 * Capacity makes of it, go to the Group schema to add a set, and come back. Every one of
 * those pages had its own cohort picker starting at the first cohort in the list, so the
 * year had to be chosen again at every step, and again after every reload — the answer to
 * "which year am I working on" was thrown away more often than it was asked for.
 *
 * So the cohort is remembered once and shared by the pages that ask for one: choosing L2
 * anywhere means L2 everywhere, which is the truth of what is being worked on rather than
 * three unrelated opinions about it. The semester is the schema page's own, because that
 * is the only page that asks.
 *
 * This browser and nowhere else — a preference, not a fact about the department, and the
 * two coordinators do not have to agree on it. A browser that will not let us write is a
 * browser that forgets, which is exactly how it behaved before.
 */

const PREFIX = "scen-remembered:";

/** The cohort every cohort picker starts on. */
export const COHORT = "cohort";
/** The semester the Group schema page opens. */
export const SCHEMA_TERM = "schema-term";

export function recall(key: string): string {
  try {
    return window.localStorage.getItem(PREFIX + key) ?? "";
  } catch {
    // Private browsing, or storage turned off: start where the page would have started.
    return "";
  }
}

export function remember(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(PREFIX + key, value);
    else window.localStorage.removeItem(PREFIX + key);
  } catch {
    // A choice that cannot be remembered must never break the page.
  }
}
