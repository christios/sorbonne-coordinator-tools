import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * How long a page holds on to where you left it: ten minutes since you last used it.
 *
 * A coordinator steps from the Cohorts table to a student's record, to Groups & CRNs, and
 * back; every page used to come back at its defaults — the filters gone, the search empty,
 * the sort undone. Ten minutes covers a detour; a page left for the afternoon starts fresh,
 * which is what somebody coming back to it much later expects.
 */
export const PAGE_STATE_TTL = 10 * 60_000;

const PREFIX = "scen-page:";

type Kept<T> = { value: T; at: number };

/** What a page kept under this name, if it was used within the last ten minutes. */
export function readPageState<T>(key: string, now = Date.now()): T | undefined {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const kept = JSON.parse(raw) as Kept<T>;
    if (typeof kept?.at !== "number" || now - kept.at > PAGE_STATE_TTL) {
      window.localStorage.removeItem(PREFIX + key);
      return undefined;
    }
    return kept.value;
  } catch {
    // Private browsing, storage turned off, or something unreadable: start fresh.
    return undefined;
  }
}

/** Keep a page's value, and restart its ten minutes. */
export function writePageState<T>(key: string, value: T, now = Date.now()): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ value, at: now } satisfies Kept<T>));
  } catch {
    // A browser that will not let us write forgets, exactly as the page did before.
  }
}

/**
 * `useState` that a page gets back if you return within ten minutes.
 *
 * The ten minutes run from the last time the page was used: each change restarts them, and
 * so does leaving the page, so a table filtered an hour ago and looked at a minute ago is
 * still filtered. Values must survive JSON — keep a Set as an array.
 */
export function usePageState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const start = () => {
    const kept = readPageState<T>(key);
    if (kept !== undefined) return kept;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  };
  const [value, setValue] = useState<T>(start);
  const latest = useRef(value);
  latest.current = value;

  // A page that swaps what it is showing — another cohort, another list — swaps its state.
  const shown = useRef(key);
  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    setValue(start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) =>
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        writePageState(key, resolved);
        return resolved;
      }),
    [key],
  );

  // Leaving the page is the last use: the ten minutes start from here.
  useEffect(() => () => writePageState(key, latest.current), [key]);

  return [value, set];
}
