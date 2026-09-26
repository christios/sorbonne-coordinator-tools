/**
 * What jsdom does not provide.
 *
 * The rosters and their history live in IndexedDB — a browser gives an origin five
 * megabytes of localStorage and a term of students needs more than that — and jsdom has
 * no IndexedDB at all. fake-indexeddb is the real implementation over an in-memory
 * backend, so the store is exercised rather than mocked.
 */
import "fake-indexeddb/auto";

/*
 * jsdom lays nothing out, so it implements no `scrollIntoView` either. Components that
 * walk a list and pull the row into view — the roster's arrow keys, the editors' anchors —
 * would otherwise throw inside an event listener, where the throw does not fail the test
 * and only shows up as an uncaught exception that later, real errors could hide behind.
 * Configurable, so a test file that wants to assert on the scrolling can redefine it, and
 * skipped where there is no DOM at all — the worker's tests run under node.
 */
if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: () => {},
    writable: true,
    configurable: true,
  });
}

/*
 * What a page keeps for ten minutes is kept in localStorage, so one test's filters would
 * otherwise greet the next. Each test starts as a coordinator arriving fresh.
 */
import { beforeEach } from "vitest";

beforeEach(() => {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("scen-page:")) window.localStorage.removeItem(key);
    }
  } catch {
    // No storage in this environment: nothing to clear.
  }
});
