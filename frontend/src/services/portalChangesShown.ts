/**
 * Whether the calendars draw what the registrar changed: the classes it took out, hollow on
 * their old days, and the Added mark on the classes it put in.
 *
 * One switch for every calendar, so flipping it on a teacher's week is how the Semester
 * Timetable reads too, and the small calendar on a record agrees with its full-size view.
 * On unless somebody has switched it off. Kept in this browser and nowhere else: it is how
 * one person likes to read a week, which is nobody else's business.
 */

import { useSyncExternalStore } from "react";

const KEY = "scen-portal-changes-shown:v1";
const listeners = new Set<() => void>();
/** What was last flipped on this page, for a browser that cannot keep it. */
let flipped: boolean | null = null;

function read(): boolean {
  if (flipped !== null) return flipped;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    // A browser with storage turned off still shows them; it just does not remember.
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab flipping it flips it here too.
  const fromElsewhere = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    flipped = null;
    listener();
  };
  window.addEventListener("storage", fromElsewhere);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", fromElsewhere);
  };
}

export function setPortalChangesShown(shown: boolean): void {
  flipped = shown;
  try {
    window.localStorage.setItem(KEY, shown ? "on" : "off");
  } catch {
    // Not remembered; the calendars on this page still follow it until it is reloaded.
  }
  for (const listener of listeners) listener();
}

/** Whether the calendars draw the registrar's changes, and the switch that says so. */
export function usePortalChangesShown(): [boolean, (shown: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, () => true), setPortalChangesShown];
}
