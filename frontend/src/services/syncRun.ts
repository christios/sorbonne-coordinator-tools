/**
 * Syncing everything, once, and surviving the page while it happens.
 *
 * A whole sync is four lists and several minutes of the registrar portal being slow. A
 * coordinator who starts one and then goes to look at another page — or reloads, or is
 * reloaded by a deploy — should not come back to find nothing happened and no record
 * that anything was tried.
 *
 * So the run is written down before it starts and after every step: which lists are to
 * be synced, which are done, which failed and why. Changing pages does not touch it,
 * because the driver lives above the pages. A reload ends the pull that was in flight —
 * nothing in a browser can hold a request across that — and the run picks that list up
 * again from the top when the page comes back, which is safe because a sync is asking
 * the same question again and writing the same answer.
 *
 * One tab does the work. A run carries the id of the tab driving it and a heartbeat, and
 * another tab only takes over once that heartbeat has gone quiet, so two open tabs do
 * not pull the portal twice over.
 */

import { syncTarget, type SyncKind, type SyncTarget } from "@/services/portalSync";

const KEY = "scen-sync-run:v1";
/** After this long without a heartbeat, the tab that was driving is taken to be gone. */
const ABANDONED_MS = 90_000;
const BEAT_MS = 15_000;

export type StepState = "waiting" | "running" | "done" | "failed";

export type SyncStep = {
  /** Stable within a run: the kind and the id of the view or portal filter. */
  key: string;
  kind: SyncKind;
  id: string;
  name: string;
  state: StepState;
  /** When the portal was asked, so a slow list can be told from a stuck one. */
  startedAt?: number;
  /** What the sync reported, once it has: how many rows the portal returned. */
  seen?: number;
  /** Said out loud, because a pull that is quietly incomplete is the worst kind. */
  warning?: string;
  error?: string;
};

export type SyncRun = {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  /** The tab driving it, and when it last said so. */
  owner: string;
  beatAt: number;
  steps: SyncStep[];
};

const TAB = `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let listeners: ((run: SyncRun | null) => void)[] = [];
let driving = false;

function read(): SyncRun | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SyncRun) : null;
  } catch {
    return null;
  }
}

function write(run: SyncRun | null): void {
  try {
    if (run) window.localStorage.setItem(KEY, JSON.stringify(run));
    else window.localStorage.removeItem(KEY);
  } catch {
    // A run that cannot be written down still runs; it just cannot be resumed.
  }
  for (const listener of listeners) listener(run);
}

export function getRun(): SyncRun | null {
  return read();
}

export function subscribe(listener: (run: SyncRun | null) => void): () => void {
  listeners = [...listeners, listener];
  // Another tab writing the run is news here too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener(read());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
    window.removeEventListener("storage", onStorage);
  };
}

export const isRunning = (run: SyncRun | null): run is SyncRun => Boolean(run && run.finishedAt === null);

/** A run nobody is driving any more: this tab may pick it up. */
export function isAbandoned(run: SyncRun | null, now = Date.now()): boolean {
  return isRunning(run) && run.owner !== TAB && now - run.beatAt > ABANDONED_MS;
}

export function stepsFor(targets: SyncTarget[]): SyncStep[] {
  return targets.map((target) => ({
    key: `${target.kind}:${target.id}`,
    kind: target.kind,
    id: target.id,
    name: target.name,
    state: "waiting" as StepState,
  }));
}

/** Begin a run, replacing any that has finished. Does nothing while one is going. */
export function startRun(targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<void> {
  const held = read();
  if (isRunning(held) && !isAbandoned(held)) return Promise.resolve();
  const run: SyncRun = {
    id: `run-${Date.now()}`,
    startedAt: Date.now(),
    finishedAt: null,
    owner: TAB,
    beatAt: Date.now(),
    steps: stepsFor(targets),
  };
  write(run);
  return drive(targets, onStep);
}

/**
 * Carry on a run this tab left unfinished, or one whose tab has gone quiet.
 *
 * The list that was in flight when the page went is set back to waiting: its pull did not
 * finish, so it must be asked again.
 */
export function resumeRun(targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<void> {
  // Already driving: there is nothing to resume, and setting the list in flight back to
  // waiting would only lose what it is doing.
  if (driving) return Promise.resolve();
  const held = read();
  if (!isRunning(held)) return Promise.resolve();
  if (held.owner !== TAB && !isAbandoned(held)) return Promise.resolve();
  const run: SyncRun = {
    ...held,
    owner: TAB,
    beatAt: Date.now(),
    steps: held.steps.map((step) => (step.state === "running" ? { ...step, state: "waiting" } : step)),
  };
  write(run);
  return drive(targets, onStep);
}

/** Forget a finished run, so the button goes back to saying nothing happened. */
export function clearRun(): void {
  const held = read();
  if (isRunning(held)) return;
  write(null);
}

function patch(key: string, change: Partial<SyncStep>): SyncStep | null {
  const held = read();
  if (!held) return null;
  let touched: SyncStep | null = null;
  const steps = held.steps.map((step) => {
    if (step.key !== key) return step;
    touched = { ...step, ...change };
    return touched;
  });
  write({ ...held, beatAt: Date.now(), steps });
  return touched;
}

/** A step has settled: it is already written down, and now anyone listening is told. */
function settle(step: SyncStep | null, onStep?: (step: SyncStep) => void): void {
  if (step) onStep?.(step);
}

/**
 * The driver: one list at a time, in the order given.
 *
 * One at a time because the portal answers a whole term in a single slow request, and
 * because the order is the order the pages depend on each other in — the students first,
 * then the courses everything else is checked against.
 *
 * A list that fails does not stop the rest. Its reason is kept on its step, and the run
 * ends saying what did not work rather than stopping at the first thing that did not.
 */
async function drive(targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<void> {
  if (driving) return;
  driving = true;
  // While a pull is running there is nothing to write down, so the heartbeat says the
  // tab is still here on its own.
  const beat = window.setInterval(() => {
    const held = read();
    if (held && held.owner === TAB && held.finishedAt === null) write({ ...held, beatAt: Date.now() });
  }, BEAT_MS);
  try {
    for (;;) {
      const held = read();
      if (!held || held.finishedAt !== null || held.owner !== TAB) return;
      const next = held.steps.find((step) => step.state === "waiting");
      if (!next) break;
      const target = targets.find((candidate) => `${candidate.kind}:${candidate.id}` === next.key);
      if (!target) {
        // The view or portal filter was deleted between the run starting and getting here.
        // Written down first and told afterwards: what the run says must never depend on
        // anyone listening, and `f?.(g())` does not call g at all when f is not there.
        settle(patch(next.key, { state: "failed", error: "This list no longer exists." }), onStep);
        continue;
      }
      patch(next.key, { state: "running", startedAt: Date.now() });
      try {
        const outcome = await syncTarget(target);
        settle(patch(next.key, { state: "done", seen: outcome.report.seen, warning: outcome.warning }), onStep);
      } catch (error) {
        settle(patch(next.key, { state: "failed", error: (error as Error).message }), onStep);
      }
    }
    const done = read();
    if (done && done.owner === TAB) write({ ...done, finishedAt: Date.now(), beatAt: Date.now() });
  } finally {
    window.clearInterval(beat);
    driving = false;
  }
}
