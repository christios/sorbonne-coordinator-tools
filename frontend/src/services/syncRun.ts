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
 * again when the page comes back, which is safe because a sync is asking the same
 * question again and writing the same answer. The timetable does better: it keeps what
 * it has after every section, and carries on from the section it had got to.
 *
 * One tab does the work, and the browser says which. The tab driving a run holds a lock
 * the browser takes away the moment that page goes — reloaded, closed, crashed — so the
 * next page waiting on it takes over at once rather than guessing from a heartbeat, and
 * two open tabs never pull the portal twice over. The heartbeat is still written, for a
 * browser without locks.
 */

import type { SweepMemo, SweepSoFar } from "@/services/facilitySync";
import { syncTarget, type SyncKind, type SyncTarget } from "@/services/portalSync";
import { PortalError, portalPace } from "@/services/scenRosters";

const KEY = "scen-sync-run:v1";
/** What each timetable step of the run has gathered so far, by step. */
const SWEEPS = "scen-sync-sweeps:v1";
/** Held by whichever page is driving the run; the browser lets go of it when that page goes. */
const LOCK = "scen-sync-run";
/** After this long without a heartbeat, the tab that was driving is taken to be gone. */
const ABANDONED_MS = 90_000;
const BEAT_MS = 15_000;
/**
 * How long a list a reload cut off waits before it is asked again.
 *
 * The request it had sent is still with the portal: nothing in a page can recall it, and
 * the extension goes on waiting for the answer after the page has gone. Asked again at
 * once, the portal would be doing the heaviest thing it does twice over — so the list
 * waits out the minute a whole list takes to come back.
 */
const REASK_LIST_AFTER_MS = 60_000;

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
  /**
   * Not to be asked before this: set on a step a reload caught in flight, while the
   * portal finishes answering the request the reload cut off.
   */
  notBefore?: number;
  /** What the sync reported, once it has: how many rows the portal returned. */
  seen?: number;
  /**
   * How many there are to get through, for a step that is several requests.
   *
   * Only the timetable sets it — one call per section — and its absence is what tells the
   * panel that `seen` is a final count rather than a running one.
   */
  of?: number;
  /** Said out loud, because a pull that is quietly incomplete is the worst kind. */
  warning?: string;
  error?: string;
  /**
   * Why it failed, as the portal names it — "not_signed_in" and the like.
   *
   * The sentence in `error` is written for a person and differs per list, so six lists
   * failing for one reason produce six different sentences and nothing downstream can
   * tell that apart from six different problems. Empty when the failure was not one the
   * portal named. Widened alongside `error` deliberately: `scen-sync-run:v1` is read
   * across tabs, and one compatibility event is better than two.
   */
  errorCode?: string;
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

function lockManager(): LockManager | null {
  try {
    return typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null;
  } catch {
    return null;
  }
}

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

/**
 * Whether some page is driving this run right now.
 *
 * Asked of the browser where it can answer: the lock is held exactly as long as the page
 * holding it is alive. Without locks, the heartbeat is the best there is.
 */
async function beingDriven(run: SyncRun): Promise<boolean> {
  if (driving) return true;
  const manager = lockManager();
  if (!manager) return !isAbandoned(run);
  const state = await manager.query();
  return (state.held ?? []).some((lock) => lock.name === LOCK);
}

/** Begin a run, replacing any that has finished. Does nothing while one is going. */
export async function startRun(targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<void> {
  const held = read();
  if (isRunning(held) && (await beingDriven(held))) return;
  const run: SyncRun = {
    id: `run-${Date.now()}`,
    startedAt: Date.now(),
    finishedAt: null,
    owner: TAB,
    beatAt: Date.now(),
    steps: stepsFor(targets),
  };
  forgetSweeps();
  write(run);
  await carryOn(run.id, targets, onStep);
}

/**
 * A step a reload caught in flight, set back to waiting — and told when it may go again.
 *
 * A list waits out the request the reload cut off (see REASK_LIST_AFTER_MS). A timetable
 * step lost at most the one section it was asking about, and a second covers that.
 */
function setBack(step: SyncStep, now: number): SyncStep {
  if (step.state !== "running") return step;
  const notBefore = step.kind === "timetable" ? now + portalPace.apart : (step.startedAt ?? 0) + REASK_LIST_AFTER_MS;
  return { ...step, state: "waiting", notBefore };
}

/**
 * Take the run over and drive it, once no other page is.
 *
 * Waits its turn for the lock, so a page that opens while another is driving sits behind
 * it and takes over the moment that page goes — and, when that page finishes instead,
 * finds nothing left to do.
 */
async function carryOn(runId: string, targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<boolean> {
  const take = async (): Promise<boolean> => {
    const held = read();
    if (!isRunning(held) || held.id !== runId || driving) return false;
    driving = true;
    const now = Date.now();
    write({ ...held, owner: TAB, beatAt: now, steps: held.steps.map((step) => setBack(step, now)) });
    await drive(runId, targets, onStep);
    return true;
  };
  const manager = lockManager();
  return manager ? manager.request(LOCK, () => take()) : take();
}

/**
 * Carry on a run this tab left unfinished, or one whose tab has gone quiet.
 *
 * The list that was in flight when the page went is set back to waiting: its pull did not
 * finish, so it must be asked again.
 */
export async function resumeRun(targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<boolean> {
  /*
   * Answers whether it actually took the run over.
   *
   * Three of the four ways out of here are refusals, and they used to be indistinguishable
   * from taking it on — every one returned the same resolved promise. The driver above
   * marks a run as attempted before calling, so a refusal burned the one attempt it had:
   * reload once inside the ninety seconds another tab is still allowed, and this tab never
   * picked the run up again, however long the other one had been dead.
   */
  // Already driving: there is nothing to resume, and setting the list in flight back to
  // waiting would only lose what it is doing.
  if (driving) return false;
  const held = read();
  if (!isRunning(held)) return false;
  // Without locks, a heartbeat that is still going is the only sign another tab is alive.
  // With them, this waits in line for that tab instead.
  if (!lockManager() && held.owner !== TAB && !isAbandoned(held)) return false;
  return carryOn(held.id, targets, onStep);
}

/**
 * Put the failed steps back to waiting, so a resume picks up only those.
 *
 * Deliberately NOT an automatic retry of a failed step. The retry that matters is per-CRN
 * and already lives inside the timetable handler; re-running a whole step to recover one
 * section is a hundred and sixty calls to fix one. And the failures that dominate — an
 * expired portal session, a missing extension — are deterministic, so retrying only
 * doubles the wait before saying the same thing. A button says who is retrying and when.
 *
 * `drive` finds the first `waiting` step with no new control flow at all.
 */
export function retryFailed(): number {
  const held = read();
  if (!held || held.finishedAt === null) return 0;
  const failed = held.steps.filter((step) => step.state === "failed");
  if (!failed.length) return 0;
  write({
    ...held,
    finishedAt: null,
    owner: TAB,
    beatAt: Date.now(),
    steps: held.steps.map((step) =>
      step.state === "failed"
        ? { ...step, state: "waiting", error: undefined, errorCode: undefined, startedAt: undefined }
        : step,
    ),
  });
  return failed.length;
}

/** Forget a finished run, so the button goes back to saying nothing happened. */
export function clearRun(): void {
  const held = read();
  if (isRunning(held)) return;
  forgetSweeps();
  write(null);
}

/**
 * Throw the run away whatever state it is in, and stop driving it.
 *
 * `clearRun` is the tidy-up: it refuses while a run is going, so a working run cannot be
 * lost by a stray click. That refusal made a STALLED run unrecoverable, because "running"
 * is only `finishedAt === null` and a stalled run's stays null for ever — so the one
 * action that would have recovered it declined precisely when it was needed, and the
 * button offering it was hidden as well. Reported from a real machine.
 *
 * This is the other verb: deliberate, asked for, and destructive on purpose. The pull
 * already in flight cannot be recalled — nothing can un-ask the portal — but it is no
 * longer written down when it lands, and nothing will resume it. A timetable sweep stops
 * before its next section.
 */
export function abandonRun(): void {
  driving = false;
  forgetSweeps();
  write(null);
}

/**
 * Where a timetable step keeps its sweep so far: beside the run, by step.
 *
 * Kept through a failure, so "Retry" carries on from the section where the portal session
 * ran out; forgotten when the step is done or the run is let go.
 */
function sweepMemo(runId: string, stepKey: string): SweepMemo & { forget: () => void } {
  const all = (): { run: string; steps: Record<string, SweepSoFar> } | null => {
    try {
      return JSON.parse(window.localStorage.getItem(SWEEPS) ?? "null");
    } catch {
      return null;
    }
  };
  const put = (steps: Record<string, SweepSoFar>) => {
    try {
      window.localStorage.setItem(SWEEPS, JSON.stringify({ run: runId, steps }));
    } catch {
      // A sweep that cannot be written down still runs; a reload just starts it again.
    }
  };
  const mine = () => {
    const held = all();
    return held && held.run === runId ? held.steps : {};
  };
  return {
    load: () => mine()[stepKey] ?? null,
    save: (sofar) => put({ ...mine(), [stepKey]: sofar }),
    forget: () => {
      const rest = { ...mine() };
      delete rest[stepKey];
      put(rest);
    },
  };
}

function forgetSweeps(): void {
  try {
    window.localStorage.removeItem(SWEEPS);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Whether this page is still the one driving this run: not given up on, not replaced, not taken over. */
function stillMine(runId: string): boolean {
  const held = read();
  return Boolean(held && held.id === runId && held.finishedAt === null && held.owner === TAB);
}

/** Change one step of this run — and only of this run, never of one that has replaced it. */
function patch(runId: string, key: string, change: Partial<SyncStep>): SyncStep | null {
  const held = read();
  if (!held || held.id !== runId) return null;
  let touched: SyncStep | null = null;
  const steps = held.steps.map((step) => {
    if (step.key !== key) return step;
    touched = { ...step, ...change };
    return touched;
  });
  write({ ...held, beatAt: Date.now(), steps });
  return touched;
}

/**
 * The word a failure is grouped by, from whoever raised it.
 *
 * `PortalError` was the only failure worth grouping while the portal was the only thing
 * that could fail a step. Our own server can fail one too now — it is given ninety seconds
 * to accept a list and no longer — and six lists whose server leg ran out of patience is
 * one problem with one sentence, exactly as six expired portal sessions are.
 */
function codeOf(error: unknown): string {
  if (error instanceof PortalError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
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
async function drive(runId: string, targets: SyncTarget[], onStep?: (step: SyncStep) => void): Promise<void> {
  driving = true;
  // While a pull is running there is nothing to write down, so the heartbeat says the
  // tab is still here on its own.
  const beat = window.setInterval(() => {
    const held = read();
    if (held && held.id === runId && held.owner === TAB && held.finishedAt === null) write({ ...held, beatAt: Date.now() });
  }, BEAT_MS);
  try {
    for (;;) {
      if (!stillMine(runId)) return;
      const next = read()!.steps.find((step) => step.state === "waiting");
      if (!next) break;
      // A list a reload cut off is still being answered for the page that went. Waited out
      // a little at a time, so a run given up on meanwhile is noticed.
      const early = (next.notBefore ?? 0) - Date.now();
      if (early > 0) {
        await pause(Math.min(early, BEAT_MS));
        continue;
      }
      const target = targets.find((candidate) => `${candidate.kind}:${candidate.id}` === next.key);
      if (!target) {
        // The view or portal filter was deleted between the run starting and getting here.
        // Written down first and told afterwards: what the run says must never depend on
        // anyone listening, and `f?.(g())` does not call g at all when f is not there.
        settle(patch(runId, next.key, { state: "failed", error: "This list no longer exists." }), onStep);
        continue;
      }
      patch(runId, next.key, { state: "running", startedAt: Date.now(), notBefore: undefined });
      const memo = target.kind === "timetable" ? sweepMemo(runId, next.key) : undefined;
      try {
        /*
         * Count what can be counted, while it is happening.
         *
         * Every other step is one slow request with nothing to report until it lands. The
         * timetable is a hundred and sixty, and over minutes an elapsed clock alone is
         * indistinguishable from a hang — which is the exact reading that had a working
         * sync reported as a missing extension.
         *
         * `patch` and not `settle`: the listeners are told (the panel redraws), but the
         * run's own onStep is not, because that re-reads every page's data and doing it
         * a hundred and sixty times would be worse than saying nothing.
         */
        const outcome = await syncTarget(
          target,
          (at) => {
            if (at.total) patch(runId, next.key, { seen: at.fetched, of: at.total });
          },
          undefined,
          // The sweep asks before every section whether anybody still wants it, so "Give
          // up" stops the portal being asked within a second rather than three minutes.
          { memo, stop: () => !stillMine(runId) },
        );
        memo?.forget();
        settle(patch(runId, next.key, { state: "done", seen: outcome.report.seen, warning: outcome.warning }), onStep);
      } catch (error) {
        settle(
          patch(runId, next.key, {
            state: "failed",
            error: (error as Error).message,
            errorCode: codeOf(error),
          }),
          onStep,
        );
      }
    }
    const done = read();
    if (done && done.id === runId && done.owner === TAB) write({ ...done, finishedAt: Date.now(), beatAt: Date.now() });
  } finally {
    window.clearInterval(beat);
    driving = false;
  }
}
