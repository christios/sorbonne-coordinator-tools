import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SyncTarget } from "@/services/portalSync";

const syncTarget = vi.hoisted(() => vi.fn());
vi.mock("@/services/portalSync", () => ({ syncTarget }));

const KEY = "scen-sync-run:v1";

const TARGETS: SyncTarget[] = [
  { kind: "students", id: "v1", name: "All Sorbonne students", filter: {} },
  { kind: "courses", id: "f1", name: "SCEN courses", filter: {} },
  { kind: "teachers", id: "f2", name: "SCEN teachers", filter: {} },
];

const answers = (seen: number) => ({ report: { seen, added: 0, missing: 0, syncedAt: "" }, roster: {}, warning: "" });

/** A fresh module, so each test gets its own tab identity and its own driver. */
async function load() {
  vi.resetModules();
  return import("@/services/syncRun");
}

const held = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");

beforeEach(() => {
  window.localStorage.clear();
  syncTarget.mockReset();
  syncTarget.mockResolvedValue(answers(10));
});
afterEach(() => vi.restoreAllMocks());

describe("syncing everything, once", () => {
  it("syncs each list in the order given, and says what came back", async () => {
    const run = await load();

    await run.startRun(TARGETS);

    expect(syncTarget.mock.calls.map(([target]) => target.id)).toEqual(["v1", "f1", "f2"]);
    const finished = run.getRun()!;
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.steps.map((step) => [step.key, step.state, step.seen])).toEqual([
      ["students:v1", "done", 10],
      ["courses:f1", "done", 10],
      ["teachers:f2", "done", 10],
    ]);
  });

  it("keeps going when one list fails, and keeps its reason", async () => {
    const run = await load();
    syncTarget.mockImplementation(async (target: SyncTarget) => {
      if (target.id === "f1") throw new Error("Your registrar portal session has expired.");
      return answers(4);
    });

    await run.startRun(TARGETS);

    const steps = run.getRun()!.steps;
    expect(steps.map((step) => step.state)).toEqual(["done", "failed", "done"]);
    expect(steps[1].error).toBe("Your registrar portal session has expired.");
    // The one after the failure was still asked.
    expect(syncTarget).toHaveBeenCalledTimes(3);
  });

  it("is written down as it goes, so a reload can see where it was", async () => {
    const run = await load();
    const seenMidway: string[][] = [];
    syncTarget.mockImplementation(async () => {
      seenMidway.push(held().steps.map((step: { state: string }) => step.state));
      return answers(1);
    });

    await run.startRun(TARGETS);

    // While the first list is with the portal, the run already says so on disk.
    expect(seenMidway[0]).toEqual(["running", "waiting", "waiting"]);
    expect(seenMidway[2]).toEqual(["done", "done", "running"]);
  });

  it("picks up a run a reload interrupted, and asks the interrupted list again", async () => {
    // What a reload leaves behind: one list done, one caught in flight, one never reached.
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "run-1", startedAt: 1, finishedAt: null, owner: "a tab that is gone", beatAt: 0,
        steps: [
          { key: "students:v1", kind: "students", id: "v1", name: "All", state: "done", seen: 7 },
          { key: "courses:f1", kind: "courses", id: "f1", name: "Courses", state: "running" },
          { key: "teachers:f2", kind: "teachers", id: "f2", name: "Teachers", state: "waiting" },
        ],
      }),
    );
    const run = await load();

    await run.resumeRun(TARGETS);

    // The one already done is not asked again; the one in flight is, because its pull died.
    expect(syncTarget.mock.calls.map(([target]) => target.id)).toEqual(["f1", "f2"]);
    expect(run.getRun()!.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
  });

  it("leaves a run alone while another tab is still driving it", async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "run-2", startedAt: Date.now(), finishedAt: null, owner: "another tab", beatAt: Date.now(),
        steps: [{ key: "courses:f1", kind: "courses", id: "f1", name: "Courses", state: "running" }],
      }),
    );
    const run = await load();

    await run.resumeRun(TARGETS);
    // And a fresh run cannot barge in either.
    await run.startRun(TARGETS);

    expect(syncTarget).not.toHaveBeenCalled();
    expect(run.getRun()!.id).toBe("run-2");
  });

  it("does not resume what this tab is already driving", async () => {
    const run = await load();
    let release = () => {};
    syncTarget.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(answers(3));
    }));

    const going = run.startRun(TARGETS.slice(0, 1));
    // A second look at the page while the first list is still with the portal.
    await run.resumeRun(TARGETS.slice(0, 1));
    expect(held().steps[0].state).toBe("running");

    release();
    await going;
    expect(syncTarget).toHaveBeenCalledTimes(1);
    expect(run.getRun()!.steps[0].state).toBe("done");
  });

  it("says whether it actually took the run over, so a refusal is not an attempt", async () => {
    /*
     * The driver above marks a run as attempted before calling this, and every refusal used
     * to look exactly like success — the same resolved promise. So one reload inside the
     * ninety seconds another tab is still trusted burned this tab's only attempt, and it
     * would never pick the run up again however long that tab had been dead. A timetable
     * sweep is the longest window anybody will ever reload during.
     */
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "run-3", startedAt: Date.now(), finishedAt: null, owner: "another tab", beatAt: Date.now(),
        steps: [{ key: "courses:f1", kind: "courses", id: "f1", name: "Courses", state: "running" }],
      }),
    );
    const run = await load();

    expect(await run.resumeRun(TARGETS)).toBe(false);

    // The same run, now long dead, is taken over — and says so.
    window.localStorage.setItem(KEY, JSON.stringify({ ...held(), beatAt: 0 }));
    expect(await run.resumeRun(TARGETS)).toBe(true);
  });

  it("says a list that has been deleted since cannot be synced", async () => {
    const run = await load();

    await run.startRun(TARGETS.slice(0, 1));
    // The view is gone by the time the run is resumed elsewhere.
    window.localStorage.setItem(KEY, JSON.stringify({ ...held(), finishedAt: null, steps: [{ ...held().steps[0], state: "waiting" }] }));
    await run.resumeRun([]);

    expect(run.getRun()!.steps[0]).toMatchObject({ state: "failed", error: "This list no longer exists." });
  });
});

describe("what a failed step remembers", () => {
  it("keeps the reason, not only the sentence", async () => {
    // The sentence is written for a person and differs per list ("SCEN courses could not
    // be pulled…"); the reason is the same for all of them. Without the reason on the
    // step, nothing downstream can tell six lists failing for one cause from six causes,
    // and the button prints the same sentence six times.
    // load() resets the module registry, so PortalError must be taken from the registry
    // syncRun itself will use — otherwise the class identity differs and instanceof lies.
    const run = await load();
    const { PortalError } = await import("@/services/scenRosters");
    syncTarget.mockRejectedValue(new PortalError("auth"));

    await run.startRun(TARGETS);

    const steps = run.getRun()!.steps;
    expect(steps.map((step) => step.state)).toEqual(["failed", "failed", "failed"]);
    expect(steps.map((step) => step.errorCode)).toEqual(["auth", "auth", "auth"]);
    // The readable sentence survives too — this adds to the step, it does not replace.
    expect(steps.every((step) => Boolean(step.error))).toBe(true);
  });

  it("leaves the reason empty for a failure the portal did not name", async () => {
    syncTarget.mockRejectedValue(new Error("The server is having a moment."));
    const run = await load();

    await run.startRun(TARGETS.slice(0, 1));

    expect(run.getRun()!.steps[0].errorCode).toBe("");
    expect(run.getRun()!.steps[0].error).toBe("The server is having a moment.");
  });
});

describe("giving up on a run that will not finish", () => {
  it("abandons a run this tab is driving, even though it is still marked running", async () => {
    // Reported from a real machine: a run that stalls can never be cleared, because the
    // one action that would recover it refuses precisely when it is needed. `finishedAt`
    // being null is what "running" means, and a stalled run's is null for ever.
    const run = await load();
    syncTarget.mockImplementation(() => new Promise(() => {}));
    void run.startRun(TARGETS);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(run.isRunning(run.getRun())).toBe(true);

    run.abandonRun();

    expect(run.getRun()).toBeNull();
    expect(held()).toBeNull();
  });

  it("still refuses the tidy-up clear while a run is going", async () => {
    // clearRun stays as it was: it is the "this is finished with" button, and it must not
    // become a way to lose a run that is working.
    const run = await load();
    syncTarget.mockImplementation(() => new Promise(() => {}));
    void run.startRun(TARGETS);
    await new Promise((resolve) => setTimeout(resolve, 20));

    run.clearRun();

    expect(run.getRun()).not.toBeNull();
  });
});
