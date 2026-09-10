/**
 * Warnings a coordinator has decided to live with.
 *
 * "Yes, I know, they are staying in the group anyway." A dismissal points at a warning's
 * key, which changes on its own when the underlying fact does — so a dismissed warning
 * comes back when the record changes again, with no expiry to keep track of.
 *
 * Kept in this browser, like the evidence the warnings rest on: two coordinators may see
 * different warnings, so a shared dismissal would hide a warning one of them never saw.
 */

const KEY = "scen-discrepancy-dismissed:v1";

export function loadDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const held = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(held) ? held.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function save(keys: Set<string>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...keys]));
  } catch {
    // A preference that cannot be remembered must never break the page.
  }
}

export function dismiss(key: string): Set<string> {
  const keys = loadDismissed();
  keys.add(key);
  save(keys);
  return keys;
}

export function restore(key: string): Set<string> {
  const keys = loadDismissed();
  keys.delete(key);
  save(keys);
  return keys;
}

/** Bring several back at once, and leave every other dismissal alone. */
export function restoreMany(keys: Iterable<string>): Set<string> {
  const held = loadDismissed();
  for (const key of keys) held.delete(key);
  save(held);
  return held;
}

/** Forget every dismissal, of every family. */
export function clearDismissed(): Set<string> {
  save(new Set());
  return new Set();
}

/**
 * Which kind of warning a key belongs to.
 *
 * One store, several pages, and a page can only speak for the warnings it shows. The
 * family is read positively off the key: a page prunes its OWN family and cannot touch
 * anything else, however many families come later.
 *
 * This used to be asked the other way round — the Cohorts page passed "mine is anything
 * that is not a registration key" — which made every family nobody had taught it about
 * its own to delete. It was correct only for as long as there were exactly two.
 */
export type WarningFamily = "registration" | "rule";

export function familyOf(key: string): WarningFamily {
  return key.startsWith("registration|") ? "registration" : "rule";
}

/**
 * Drop dismissals of one family whose warning no longer exists, so the store stays small.
 *
 * `live` must be every live key of that family, across every cohort — not only the cohort
 * on screen. Pruning against one cohort's warnings deletes the dismissals made against all
 * the others, which is a silent loss of the coordinator's own decisions. And a page whose
 * evidence is incomplete — a check that failed, a pull still arriving — must not prune at
 * all: absent and gone are not the same, and only one of them is a reason to forget.
 */
export function pruneDismissed(live: Iterable<string>, family: WarningFamily): Set<string> {
  const alive = new Set(live);
  const keys = new Set([...loadDismissed()].filter((key) => familyOf(key) !== family || alive.has(key)));
  save(keys);
  return keys;
}
