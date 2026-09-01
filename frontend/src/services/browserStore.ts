/**
 * Where the big things this browser holds actually live.
 *
 * The rosters and their history are kept here and nowhere else, because the server is
 * never told a student's name. That made the size of the drawer they sit in a real
 * constraint rather than an implementation detail: localStorage gives an origin about
 * five megabytes, a term is nearly three thousand students, and a coordinator has a dozen
 * views besides. It did not fit, and because a refused write throws, the names silently
 * failed to save while the sync reported success.
 *
 * IndexedDB is the same browser, the same origin, the same privacy — nothing is sent
 * anywhere — with a quota measured in hundreds of megabytes rather than five. It also
 * stores objects rather than text, so a roster no longer has to be turned into a
 * two-megabyte string and parsed back on every read.
 *
 * Everything here is a promise, which is the price: the browser will not answer for its
 * own disk synchronously. Small things — which view was last synced, the column layout —
 * stay in localStorage, where being instant matters more than being large.
 */

const DB_NAME = "scen-coordinator";
const DB_VERSION = 1;
const STORE = "kv";

let opening: Promise<IDBDatabase | null> | null = null;

/** The database, or null when this browser will not give us one. */
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    // Private browsing, an old browser, or a policy that blocks storage: fall back
    // rather than fail. The caller cannot tell the difference and should not have to.
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

/** localStorage, for a browser that will not open a database. */
const fallback = {
  read<T>(key: string): T | null {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  write(key: string, value: unknown): boolean {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  drop(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do: what cannot be removed could not have been written.
    }
  },
};

export async function read<T>(key: string): Promise<T | null> {
  const database = await db();
  if (!database) return fallback.read<T>(key);
  return new Promise((resolve) => {
    try {
      const request = database.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** True if it went in. False means the quota refused it, or storage is unavailable. */
export async function write(key: string, value: unknown): Promise<boolean> {
  const database = await db();
  if (!database) return fallback.write(key, value);
  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(value, key);
      // The put can succeed and the transaction still fail on commit, which is where a
      // quota refusal surfaces — so the answer is the transaction's, not the request's.
      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => resolve(false);
      transaction.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function drop(key: string): Promise<void> {
  const database = await db();
  if (!database) return fallback.drop(key);
  await new Promise<void>((resolve) => {
    try {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Only for tests: forget the open database so the next call opens a fresh one. */
export function resetForTests(): void {
  opening = null;
}
