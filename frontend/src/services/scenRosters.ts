/**
 * Talks to the SCEN Rosters browser extension, the only party that can reach the
 * registrar portal — the portal sends no CORS headers, so this application can never
 * call it directly, no matter what code runs here.
 *
 * What comes back stays in this tab. Rows carry student names and university e-mail
 * addresses; they live in React state for the length of the working session and are
 * never written to our database, to storage, or to disk. The only thing this
 * application persists is a student id against a CRN.
 *
 * The wire format is the extension's content-script relay:
 *   page --window.postMessage--> bridge.js --chrome.runtime--> service worker --> portal
 */

const CHANNEL = "scen-rosters";
const FETCH_TIMEOUT_MS = 20_000;
const PING_TIMEOUT_MS = 1_500;

export type RosterRow = {
  SPRIDEN_ID?: string;
  FULL_NAME?: string;
  FIRST_NAME?: string;
  LAST_NAME?: string;
  PSUAD_EMAIL?: string;
  YEARLEVEL_CODE?: string;
  MAJOR_CODE_DESC?: string;
  ESTS_CODE?: string;
  [column: string]: string | number | null | undefined;
};

export type RosterPreset = { id: string; name: string; expect: number | null };

export type PortalRoster = {
  presetId: string;
  name: string;
  count: number;
  expect: number | null;
  /** "zero_rows" when a filter code matched nothing; "count_drift" when the size moved a lot. */
  warning: string | null;
  fetchedAt: number;
  rows: RosterRow[];
};

type Reply = { ok: boolean; error?: string; message?: string; [key: string]: unknown };

let sequence = 0;

function ask(type: string, extra: Record<string, unknown> = {}, timeout = FETCH_TIMEOUT_MS): Promise<Reply> {
  return new Promise((resolve) => {
    const id = `${CHANNEL}:${++sequence}`;
    let settled = false;

    const finish = (payload: Reply) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(payload);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as { channel?: string; dir?: string; id?: string; payload?: Reply };
      if (message?.channel !== CHANNEL || message.dir !== "response" || message.id !== id) return;
      finish(message.payload ?? { ok: false, error: "extension_unavailable" });
    };

    const timer = setTimeout(() => finish({ ok: false, error: "extension_unavailable" }), timeout);
    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, dir: "request", id, type, ...extra }, window.location.origin);
  });
}

/** True when the extension is installed and this origin is in its content-script matches. */
export async function isExtensionInstalled(): Promise<boolean> {
  return Boolean((await ask("ping", {}, PING_TIMEOUT_MS)).ok);
}

export async function listPresets(): Promise<RosterPreset[]> {
  const reply = await ask("presets", {}, 3_000);
  return reply.ok ? ((reply.presets as RosterPreset[]) ?? []) : [];
}

export class PortalError extends Error {
  constructor(readonly code: string) {
    super(messageFor(code));
    this.name = "PortalError";
  }
}

function messageFor(code: string): string {
  switch (code) {
    case "extension_unavailable":
      return "The SCEN Rosters extension did not answer. Install it, or reload this page after enabling it.";
    case "auth":
      return "Your registrar portal session has expired. Open the portal, sign in, then pull again.";
    case "network":
      return "The registrar portal could not be reached from your browser.";
    case "unknown_preset":
      return "That saved search is no longer in the extension.";
    default:
      return "The registrar portal returned an unexpected error.";
  }
}

/** Pull one saved search. Only a preset id crosses to the extension — never a raw filter. */
export async function pullRoster(presetId: string): Promise<PortalRoster> {
  const reply = await ask("fetch", { presetId });
  if (!reply.ok) throw new PortalError(String(reply.error ?? "unknown"));
  return {
    presetId,
    name: String(reply.name ?? presetId),
    count: Number(reply.count ?? 0),
    expect: (reply.expect as number | null) ?? null,
    warning: (reply.warning as string | null) ?? null,
    fetchedAt: Number(reply.fetchedAt ?? Date.now()),
    rows: (reply.rows as RosterRow[]) ?? [],
  };
}

/** The portal's own id column, in the shape the platform stores it. */
export function studentIdOf(row: RosterRow): string {
  return String(row.SPRIDEN_ID ?? "")
    .trim()
    .toUpperCase();
}

export function displayNameOf(row: RosterRow): string {
  const full = String(row.FULL_NAME ?? "").trim();
  if (full) return full;
  return [row.FIRST_NAME, row.LAST_NAME].filter(Boolean).join(" ").trim();
}
