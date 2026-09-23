/**
 * Whether what is on the pages is old enough that nobody should be working from it.
 *
 * The age has always been in the header, in small grey type beside the sync button, and
 * a coordinator who did not look at it had no way of knowing that the registrations they
 * were reading were yesterday afternoon's. The registrar moves sections, staff and
 * registrations during the working day; a page read at four o'clock from a pull taken the
 * previous afternoon answers yesterday's question in today's words.
 *
 * How old is too old is the department's to say, so it is a check like the others rather
 * than a number in the code — and it can be switched off, which during a portal outage is
 * the only honest setting.
 */

/** What the check starts at, and what is used until the server has answered. */
export const STALE_AFTER = 8;

export type SyncAge = {
  /** When the oldest list was last synced, or null when one has never been. */
  syncedAt: number | null;
  now?: number;
  hours?: number;
};

/**
 * A sync nobody has ever done is not reported here.
 *
 * It is not staleness — there is nothing to be stale — and the pages say it better
 * themselves: an empty register reads as empty, and a coordinator setting the department
 * up for the first time does not need a warning in front of every page telling them they
 * have not started yet.
 */
export function isStale({ syncedAt, now = Date.now(), hours = STALE_AFTER }: SyncAge): boolean {
  if (!syncedAt || hours <= 0) return false;
  return now - syncedAt >= hours * 3_600_000;
}

/** "9 hours", for the sentence that says how old the pages are. */
export function ageInWords(syncedAt: number, now = Date.now()): string {
  const hours = Math.floor(Math.max(0, now - syncedAt) / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
