import { describe, expect, it, vi } from "vitest";

import { PortalError, silenceMeans } from "@/services/scenRosters";

/**
 * What a coordinator is told when a pull fails.
 *
 * The bug this pins: every code without a case of its own read "the registrar portal
 * returned an unexpected error", including the extension refusing the request before the
 * portal was ever asked. That sent people to check the portal when the answer was here.
 */
describe("what a failed pull says", () => {
  it("passes on the extension's reason for refusing", () => {
    const error = new PortalError("filter_refused", "sensitive_field:PASSPORT_ID");

    expect(error.message).toContain("would not ask the portal that");
    expect(error.message).toContain("sensitive_field:PASSPORT_ID");
  });

  it("says the portal answered with an error, and with what", () => {
    expect(new PortalError("http", "500").message).toMatch(/portal answered with an error \(500\)/);
  });

  it("names the extension when the extension is what broke", () => {
    expect(new PortalError("internal", "ReferenceError: x").message).toMatch(
      /extension failed: ReferenceError/,
    );
  });

  it("still explains the ordinary failures in plain words", () => {
    expect(new PortalError("auth").message).toMatch(/session has expired/);
    expect(new PortalError("network").message).toMatch(/could not be reached/);
    expect(new PortalError("extension_unavailable", "context invalidated").message).toMatch(
      /Reload this page/,
    );
  });

  it("carries the detail even for a code it has never heard of", () => {
    // The point: an unknown code must not swallow what little is known about it.
    expect(new PortalError("something_new", "the details").message).toContain("the details");
  });

  it("does not tell somebody to install what they have already installed", () => {
    /*
     * The bug reported from production. Syncing the first term — 2876 students in one
     * request — ran past the timeout, and a timeout was reported with the same code as a
     * missing extension. The coordinator was told to install a thing that was working.
     */
    expect(new PortalError("timed_out").message).not.toMatch(/install/i);
    expect(new PortalError("timed_out").message).toMatch(/did not finish answering/);
    expect(new PortalError("timed_out").message).toMatch(/narrow the view's filter/);
  });
});

/**
 * Silence says nothing about its own cause, so the answer is to ask.
 *
 * An extension that replies to a ping in a moment is present and was merely still
 * working; one that does not is not there. The two want opposite advice — "try again or
 * narrow the filter" against "install the extension" — and before this they got the same.
 *
 * The decision is tested here; that it is reached through a real ping is verified in a
 * browser, because jsdom does not deliver postMessage on a clock any test can advance.
 */
describe("telling a slow extension from an absent one", () => {
  it("blames the portal when the extension answers a ping", () => {
    expect(silenceMeans(true)).toBe("timed_out");
    expect(new PortalError(silenceMeans(true)).message).toMatch(/did not finish answering/);
  });

  it("blames the extension when it answers nothing at all", () => {
    expect(silenceMeans(false)).toBe("extension_unavailable");
    expect(new PortalError(silenceMeans(false)).message).toMatch(/Install it/);
  });
});

describe("an extension older than the page", () => {
  it("says so, rather than blaming the portal", async () => {
    /*
     * A build before 1.8.0 has no case for the timetable sweep, so it answers
     * `unknown_message` — which without a sentence of its own arrived as "the registrar
     * portal returned an unexpected error" and sent somebody to look at the portal.
     */
    const { PortalError } = await import("@/services/scenRosters");
    const error = new PortalError("unknown_message");

    expect(error.message).toMatch(/older than this page/);
    expect(error.message).toMatch(/chrome:\/\/extensions/);
    expect(error.message).not.toMatch(/registrar portal returned/);
  });
});

/*
 * How hard the portal is asked.
 *
 * On 29 September 2026 a sync asked the registrar's timetable about 167 sections in about
 * nine seconds, and the registrar's system was in trouble that morning. These pin the
 * pace: one request at a time, a second apart, and five seconds after a whole list.
 */
describe("the portal's pace", () => {
  async function paced() {
    vi.resetModules();
    const module = await import("@/services/scenRosters");
    let clock = 1_000_000;
    const slept: number[] = [];
    module.portalPace.now = () => clock;
    module.portalPace.sleep = async (ms: number) => {
      slept.push(ms);
      clock += ms;
    };
    return { module, slept, pass: (ms: number) => (clock += ms) };
  }

  it("asks one thing at a time, a second apart", async () => {
    const { module, slept } = await paced();
    const order: string[] = [];
    const ask = (name: string) => module.portalTurn(0, async () => {
      order.push(`start ${name}`);
      await Promise.resolve();
      order.push(`end ${name}`);
    });

    await Promise.all([ask("a"), ask("b"), ask("c")]);

    // Never two at once, whoever asked first.
    expect(order).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    // The first goes at once; each after it waits out the second since the one before began.
    expect(slept).toEqual([1_000, 1_000]);
  });

  it("does not wait again for time an answer already took", async () => {
    const { module, slept, pass } = await paced();

    await module.portalTurn(0, async () => void pass(1_500));
    await module.portalTurn(0, async () => undefined);

    expect(slept).toEqual([]);
  });

  it("leaves the portal alone for five seconds after a whole list", async () => {
    const { module, slept } = await paced();

    await module.portalTurn(module.portalPace.afterList, async () => undefined);
    await module.portalTurn(0, async () => undefined);

    expect(slept).toEqual([5_000]);
  });

  it("keeps its place in line when a request fails", async () => {
    const { module, slept } = await paced();

    await expect(module.portalTurn(0, async () => Promise.reject(new Error("portal down")))).rejects.toThrow("portal down");
    await module.portalTurn(0, async () => undefined);

    expect(slept).toEqual([1_000]);
  });
});

describe("a sweep of the timetable, section by section", () => {
  const booked = (crn: string) => ({
    crn, courseCode: "MATH-001", title: "", teacherName: "",
    meetings: [{ meetsOn: "2026-10-01", startsAt: "08:30", endsAt: "10:00", room: "5.111" }],
  });
  /** An extension that answers for one section, the way it does. */
  const answers = (silent: string[] = [], failed: string[] = []) => vi.fn(async (crn: string) => ({
    ok: true,
    termCode: "262710",
    asked: [crn],
    sections: silent.includes(crn) || failed.includes(crn) ? [] : [booked(crn)],
    silent: silent.includes(crn) ? [crn] : [],
    failed: failed.includes(crn) ? [crn] : [],
    complete: true,
    malformed: 0,
  }));

  it("asks about each section once, in turn, and puts each in exactly one list", async () => {
    const { sweepOneByOne } = await import("@/services/scenRosters");
    const ask = answers(["b"], ["c"]);

    const pull = await sweepOneByOne("262710", ["a", "b", "c", "a", " "], ask);

    expect(ask.mock.calls.map(([crn]) => crn)).toEqual(["a", "b", "c"]);
    expect(pull.asked).toEqual(["a", "b", "c"]);
    expect(pull.sections.map((section) => section.crn)).toEqual(["a"]);
    expect(pull.silent).toEqual(["b"]);
    expect(pull.failed).toEqual(["c"]);
    expect(pull.complete).toBe(true);
  });

  it("counts an answer that says nothing about the section as a failure, never a silence", async () => {
    // A silence is evidence the section is gone; an answer about something else is not.
    const { sweepOneByOne } = await import("@/services/scenRosters");
    const ask = vi.fn(async () => ({ ok: true, sections: [], silent: [], failed: [] }));

    const pull = await sweepOneByOne("262710", ["a"], ask);

    expect(pull.silent).toEqual([]);
    expect(pull.failed).toEqual(["a"]);
  });

  it("hands over what it has after every section", async () => {
    const { sweepOneByOne } = await import("@/services/scenRosters");
    const kept: string[][] = [];

    await sweepOneByOne("262710", ["a", "b"], answers(["b"]), undefined, {
      keep: (sofar) => kept.push([...sofar.sections.map((section) => section.crn), ...sofar.silent]),
    });

    expect(kept).toEqual([["a"], ["a", "b"]]);
  });

  it("carries on from where an earlier attempt got to, without asking again", async () => {
    const { sweepOneByOne } = await import("@/services/scenRosters");
    const ask = answers();
    const progress: [number, number | null][] = [];

    const pull = await sweepOneByOne("262710", ["a", "b", "c"], ask, (at) => progress.push([at.fetched, at.total]), {
      from: { termCode: "262710", sections: [booked("a")], silent: ["b"], failed: [], malformed: 0 },
    });

    expect(ask.mock.calls.map(([crn]) => crn)).toEqual(["c"]);
    expect(pull.sections.map((section) => section.crn)).toEqual(["a", "c"]);
    expect(pull.silent).toEqual(["b"]);
    // The count starts where the earlier attempt left it, not at nought.
    expect(progress).toEqual([[2, 3], [3, 3]]);
  });

  it("stops before the next section once nobody wants the answer", async () => {
    const { sweepOneByOne, SweepStopped } = await import("@/services/scenRosters");
    const ask = answers();
    let wanted = true;

    const going = sweepOneByOne("262710", ["a", "b", "c"], async (crn) => {
      const reply = await ask(crn);
      if (crn === "a") wanted = false;
      return reply;
    }, undefined, { stop: () => !wanted });

    await expect(going).rejects.toBeInstanceOf(SweepStopped);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("stops at an expired session and says so once, keeping what it had", async () => {
    const { sweepOneByOne, PortalError } = await import("@/services/scenRosters");
    const ask = vi.fn(async (crn: string) =>
      crn === "b" ? { ok: false, error: "auth" } : { ok: true, sections: [booked(crn)], silent: [], failed: [] },
    );
    let kept: string[] = [];

    const going = sweepOneByOne("262710", ["a", "b", "c"], ask, undefined, {
      keep: (sofar) => (kept = sofar.sections.map((section) => section.crn)),
    });

    await expect(going).rejects.toBeInstanceOf(PortalError);
    await expect(going).rejects.toThrow(/session has expired/);
    // Not asked about the one after: it would fail the same way.
    expect(ask).toHaveBeenCalledTimes(2);
    expect(kept).toEqual(["a"]);
  });
});
