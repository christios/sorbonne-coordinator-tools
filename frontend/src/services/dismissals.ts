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

/**
 * Drop dismissals whose warning no longer exists, so the store does not grow for ever.
 *
 * One store, more than one page. A page can only speak for the warnings it shows, so it
 * says which keys are its own with `mine`; everybody else's are left alone. Without that,
 * the Cohorts page would throw away every registration dismissal the moment it pruned,
 * because none of those warnings are on it.
 */
export function pruneDismissed(live: Iterable<string>, mine: (key: string) => boolean = () => true): Set<string> {
  const alive = new Set(live);
  const keys = new Set([...loadDismissed()].filter((key) => alive.has(key) || !mine(key)));
  save(keys);
  return keys;
}

/** The keys of registration differences, which live on the Course Registration page. */
export const isRegistrationKey = (key: string) => key.startsWith("registration|");
