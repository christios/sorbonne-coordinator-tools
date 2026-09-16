/**
 * Where a coordinator was on each page, so that coming back to it comes back to it.
 *
 * A page is not always one screen. Semesters is a list until you open a week; the week is
 * what the afternoon is spent in front of. Stepping to Students and back used to put you
 * in front of the list again, with nothing to say you had ever been anywhere — and the
 * address, which carries the page, went no deeper than the page.
 *
 * So the address carries what is open within a page as well, and this remembers the last
 * one per page. Between them: a reload or a link opens exactly what it names, and moving
 * about the application returns you to what you were doing on each page rather than to
 * each page's front door.
 *
 * Kept in this browser and nowhere else. It is where one person had got to, which is worth
 * nothing to anybody else and is not the server's business.
 */

const KEY = "sorbonne.lastPlace";
/**
 * Old enough that it is no longer where you were, but somewhere you once went.
 *
 * Coming back the next morning to yesterday's half-finished screen is not helpful — the
 * page's own front door is the better answer by then, and the address still opens the
 * screen itself if that is what was wanted.
 */
const KEEP_FOR = 12 * 60 * 60 * 1000;

type Places = Record<string, { detail: string; at: number }>;

function read(): Places {
  try {
    const held = window.localStorage.getItem(KEY);
    return held ? (JSON.parse(held) as Places) : {};
  } catch {
    // A browser with storage turned off still works; it just does not remember.
    return {};
  }
}

/** What was open on this page when it was last left, if it was recent enough to mean anything. */
export function placeOf(page: string): string {
  const held = read()[page];
  if (!held || Date.now() - held.at > KEEP_FOR) return "";
  return held.detail;
}

/** Say what is open on a page now. An empty detail forgets it rather than remembering nothing. */
export function rememberPlace(page: string, detail: string): void {
  try {
    const places = read();
    if (detail) places[page] = { detail, at: Date.now() };
    else delete places[page];
    window.localStorage.setItem(KEY, JSON.stringify(places));
  } catch {
    // Same as read(): remembering is a convenience, never a requirement.
  }
}
