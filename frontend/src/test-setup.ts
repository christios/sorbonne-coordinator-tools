/**
 * What jsdom does not provide.
 *
 * The rosters and their history live in IndexedDB — a browser gives an origin five
 * megabytes of localStorage and a term of students needs more than that — and jsdom has
 * no IndexedDB at all. fake-indexeddb is the real implementation over an in-memory
 * backend, so the store is exercised rather than mocked.
 */
import "fake-indexeddb/auto";
