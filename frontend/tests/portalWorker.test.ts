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
    requests.push({ url: String(target), body: JSON.parse(init?.body ?? "{}") });
    return {
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      json: async () => ({ Entities: [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira", PASSPORT_ID: "SECRET" }] }),
    };
  });

  vi.resetModules();
  await import("../../extension/background.js");
}

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
      Take: 0,
    });
    // The portal returns 45 columns including passports; only the allowlist survives.
    expect(reply.rows).toEqual([{ SPRIDEN_ID: "A001", FULL_NAME: "Amira" }]);
  });

  it("refuses a filter the schema does not allow, without calling the portal", async () => {
    const reply = await send({ type: "fetch", filter: { PASSPORT_ID: ["X"] } });

    expect(reply).toMatchObject({ ok: false, error: "filter_refused", detail: "unknown_field:PASSPORT_ID" });
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
