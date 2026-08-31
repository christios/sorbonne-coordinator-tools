/**
 * The extension's service worker, driven the way the bridge drives it.
 *
 * Written after shipping a worker that answered "schema" with a ReferenceError: the file
 * loads fine, its syntax is valid, and every message still failed. Only running the
 * message handler catches that.
 */

// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const EXTENSION = new URL("../../extension/", import.meta.url);

type Handler = (message: unknown, sender: unknown, respond: (reply: unknown) => void) => boolean;

let handler: Handler;
let storage: Record<string, unknown>;
let requests: { url: string; body: unknown }[];

async function loadWorker(): Promise<void> {
  storage = {};
  requests = [];

  vi.stubGlobal("chrome", {
    runtime: {
      getURL: (name: string) => fileURLToPath(new URL(name, EXTENSION)),
      getManifest: () => ({ version: "1.2.0" }),
      onMessage: { addListener: (listener: Handler) => (handler = listener) },
      lastError: null,
    },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storage, values),
      },
    },
  });

  // config() reads presets.json through fetch; the portal call is the other caller.
  vi.stubGlobal("fetch", async (target: string, init?: { body?: string }) => {
    if (!String(target).startsWith("http")) {
      return { json: async () => JSON.parse(readFileSync(String(target), "utf8")) };
    }
    const body = JSON.parse(init?.body ?? "{}");
    requests.push({ url: String(target), body });
    // `population` lets a test say how many students the term holds; the default keeps
    // the single-row behaviour every other test was written against.
    const total = population ?? 1;
    const skip = Number(body.Skip ?? 0);
    const take = Number(body.Take ?? total);
    const entities = Array.from({ length: Math.max(0, Math.min(take, total - skip)) }, (_, i) => ({
      SPRIDEN_ID: `A${String(skip + i).padStart(3, "0")}`,
      FULL_NAME: "Amira",
      PASSPORT_ID: "SECRET",
    }));
    return {
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ Entities: entities, TotalCount: total }),
    };
  });

  vi.resetModules();
  await import("../../extension/background.js");
}

/** How many students the fake portal holds. Null keeps the one-row default. */
let population: number | null = null;

afterEach(() => {
  population = null;
});

const send = (message: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    handler(message, {}, (reply) => resolve(reply as Record<string, unknown>));
  });

beforeEach(loadWorker);
afterEach(() => vi.unstubAllGlobals());

describe("the extension's service worker", () => {
  it("answers a ping", async () => {
    expect(await send({ type: "ping" })).toMatchObject({ ok: true, version: "1.2.0" });
  });

  it("answers schema with the built-in list before the portal has been read", async () => {
    const reply = await send({ type: "schema" });

    expect(reply.ok).toBe(true);
    expect(reply.source).toBe("built-in");
    expect((reply.fields as { key: string }[]).map((field) => field.key)).toContain("YEARLEVEL_CODE");
  });

  it("prefers what was harvested from the portal", async () => {
    await send({
      type: "fields:harvest",
      fields: [{ key: "NEW_FIELD", label: "New", options: [{ value: "X", label: "X" }] }],
    });

    const reply = await send({ type: "schema" });

    expect(reply.source).toBe("portal");
    expect((reply.fields as { key: string }[])[0].key).toBe("NEW_FIELD");
  });

  it("keeps the richer harvest when a page knew fewer values", async () => {
    await send({
      type: "fields:harvest",
      fields: [{ key: "YEARLEVEL_CODE", label: "Year", options: [{ value: "FY" }, { value: "L1" }] }],
    });

    // A portal page with no filter panel open knows the names but not the values.
    const thinner = await send({
      type: "fields:harvest",
      fields: [{ key: "YEARLEVEL_CODE", label: "Year", options: [] }],
    });

    expect(thinner.kept).toBe(false);
    expect(((await send({ type: "schema" })).fields as { options: unknown[] }[])[0].options).toHaveLength(2);
  });

  it("runs a composed filter, and trims the answer to the allowlist", async () => {
    const reply = await send({ type: "fetch", filter: { YEARLEVEL_CODE: ["FY"] } });

    expect(reply.ok).toBe(true);
    expect(requests[0].body).toMatchObject({
      EqualityFilter: { TERM_CODE: "262710", YEARLEVEL_CODE: ["FY"] },
      Skip: 0,
      Take: 500,
    });
    // The portal returns 45 columns including passports; only the allowlist survives.
    expect(reply.rows).toEqual([{ SPRIDEN_ID: "A000", FULL_NAME: "Amira" }]);
  });

  /*
   * A whole term used to be one request with `Take: 0`. The first term is 2876 students,
   * and one request that large is a single point of failure with nothing to show while it
   * runs — the page could not tell a slow success from a hang, and abandoned it.
   */
  describe("a term that does not fit in one answer", () => {
    it("walks the pages and returns every student once", async () => {
      population = 1150;

      const reply = await send({ type: "fetch", filter: {} });

      expect(reply.rows).toHaveLength(1150);
      expect(new Set(reply.rows.map((r: { SPRIDEN_ID: string }) => r.SPRIDEN_ID)).size).toBe(1150);
    });

    it("asks for each page in turn", async () => {
      population = 1150;

      await send({ type: "fetch", filter: {} });

      const portal = requests.filter((r) => r.url.startsWith("http"));
      expect(portal.map((r) => r.body.Skip)).toEqual([0, 500, 1000]);
      expect(portal.every((r) => r.body.Take === 500)).toBe(true);
    });

    it("stops on the short page rather than asking for ever", async () => {
      population = 300;

      await send({ type: "fetch", filter: {} });

      expect(requests.filter((r) => r.url.startsWith("http"))).toHaveLength(1);
    });

    it("says so rather than quietly returning half a term", async () => {
      // A portal that never returns a short page would otherwise spin here for ever.
      population = 25000;

      const reply = await send({ type: "fetch", filter: {} });

      expect(reply.warning).toBe("truncated");
      expect(reply.rows.length).toBeLessThan(25000);
    });
  });

  it("returns the columns the portal's own picker lists, once it has read them", async () => {
    await send({
      type: "fields:harvest",
      fields: [],
      columns: [
        { key: "SPRIDEN_ID", label: "Id" },
        { key: "FULL_NAME", label: "Student" },
        { key: "ABSENCE_PER", label: "Absence %" },
      ],
    });

    const schema = await send({ type: "schema" });
    const reply = await send({ type: "fetch", filter: { YEARLEVEL_CODE: ["FY"] } });

    // ABSENCE_PER is shown by the grid and cannot be filtered by, so the old list — which
    // came from the filters — could never offer it.
    expect((schema.columns as { key: string }[]).map((column) => column.key)).toContain("ABSENCE_PER");
    expect(reply.columns).toContain("ABSENCE_PER");
  });

  it("refuses to return a column the picker offers but no cohort table needs", async () => {
    await send({
      type: "fields:harvest",
      fields: [],
      columns: [
        { key: "SPRIDEN_ID", label: "Id" },
        { key: "FULL_NAME", label: "Student" },
        { key: "PASSPORT_ID", label: "Passport" },
        { key: "STUDENT_DOB", label: "Date of birth" },
        { key: "MOBILE_NO", label: "Mobile" },
      ],
    });

    const schema = await send({ type: "schema" });
    const reply = await send({ type: "fetch", filter: { YEARLEVEL_CODE: ["FY"] } });

    // Neither offered to the table nor asked of the portal — and the row the portal sent
    // back carries a passport, which is stripped before anything sees it.
    const offered = (schema.columns as { key: string }[]).map((column) => column.key);

    expect(offered).toContain("FULL_NAME");
    for (const refused of ["PASSPORT_ID", "STUDENT_DOB", "MOBILE_NO"]) {
      expect(offered).not.toContain(refused);
      expect(reply.columns).not.toContain(refused);
    }
    expect(reply.rows).toEqual([{ SPRIDEN_ID: "A000", FULL_NAME: "Amira" }]);
  });

  it("offers what the service has always returned, not only what the grid shows", async () => {
    await send({
      type: "fields:harvest",
      fields: [],
      columns: [{ key: "FULL_NAME", label: "Student" }],
    });

    const offered = ((await send({ type: "schema" })).columns as { key: string }[]).map((c) => c.key);

    // The grid folds a student's name into one column; the service answers with both
    // halves, and they have been arriving in every pull all along.
    expect(offered).toEqual(expect.arrayContaining(["FIRST_NAME", "LAST_NAME", "ABSENCE_PER"]));
  });

  it("refuses the sensitive columns by their label, whatever the field is called", async () => {
    // The labels are the registrar's own, read off the portal's Column Picker. The field
    // keys behind them are unknown here, which is exactly why the label is checked.
    await send({
      type: "fields:harvest",
      fields: [],
      columns: [
        { key: "COL_1", label: "Personal Email" },
        { key: "COL_2", label: "Date Of Birth" },
        { key: "COL_3", label: "Mobile" },
        { key: "COL_4", label: "Passport ID" },
        { key: "COL_5", label: "Passport Expiry" },
        { key: "COL_6", label: "City of Birth" },
        { key: "COL_7", label: "Balance" },
        { key: "COL_8", label: "Nationality" },
      ],
    });

    const offered = ((await send({ type: "schema" })).columns as { label: string }[]).map((c) => c.label);

    expect(offered).not.toContain("Personal Email");
    expect(offered).not.toContain("Date Of Birth");
    expect(offered).not.toContain("Mobile");
    expect(offered).not.toContain("Passport ID");
    expect(offered).not.toContain("Passport Expiry");
    expect(offered).not.toContain("City of Birth");
    expect(offered).not.toContain("Balance");
    // Not on the list you chose, so it comes through — say the word and it moves.
    expect(offered).toContain("Nationality");
  });

  it("keeps the student id even if the picker somehow leaves it out", async () => {
    await send({
      type: "fields:harvest",
      fields: [],
      columns: [{ key: "FULL_NAME", label: "Student" }],
    });

    // Every answer is keyed by the id; rows without one could not be matched to a student.
    expect((await send({ type: "fetch", filter: {} })).columns).toContain("SPRIDEN_ID");
  });

  it("does not forget the filters when a page teaches it only columns", async () => {
    await send({
      type: "fields:harvest",
      fields: [{ key: "YEARLEVEL_CODE", label: "Year", options: [{ value: "FY" }] }],
    });

    // The columns and the filters are read from different parts of the page and arrive
    // apart. Learning one must not erase the other.
    await send({ type: "fields:harvest", fields: [], columns: [{ key: "FULL_NAME", label: "Student" }] });
    const schema = await send({ type: "schema" });

    expect((schema.fields as { key: string }[]).map((field) => field.key)).toContain("YEARLEVEL_CODE");
    expect((schema.columns as { key: string }[]).map((column) => column.key)).toContain("FULL_NAME");
  });

  it("refuses a filter the schema does not allow, without calling the portal", async () => {
    const reply = await send({ type: "fetch", filter: { PASSPORT_ID: ["X"] } });

    expect(reply).toMatchObject({
      ok: false,
      error: "filter_refused",
      detail: "sensitive_field:PASSPORT_ID",
    });
    expect(requests).toHaveLength(0);
  });

  it("still runs a named preset", async () => {
    const reply = await send({ type: "fetch", presetId: "scen-fy" });

    expect(reply.ok).toBe(true);
    expect(requests[0].body).toMatchObject({ EqualityFilter: { DEPT_CODE: ["SCEN"] } });
  });

  it("says so for a preset that no longer exists", async () => {
    expect(await send({ type: "fetch", presetId: "gone" })).toMatchObject({ ok: false, error: "unknown_preset" });
  });

  it("refuses a message it does not understand", async () => {
    expect(await send({ type: "whatever" })).toMatchObject({ ok: false, error: "unknown_message" });
  });
});
