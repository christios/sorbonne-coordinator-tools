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
/*
 * The clock is for silence, not for length.
 *
 * The extension pages the portal now and reports each page as it lands, and every report
 * starts this again — so a whole term takes as long as it takes, and only a pull that has
 * genuinely stopped hits the limit. A minute without a word is stopped.
 */
const FETCH_TIMEOUT_MS = 60_000;
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

export type RosterPreset = {
  id: string;
  name: string;
  expect: number | null;
  /** The codes the preset stands for, so it can be imported as a saved search. */
  filter?: Record<string, string[]>;
};

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

/** How far a pull has got, for a caller that wants to say so. */
export type PullProgress = { fetched: number; total: number | null };

function ask(
  type: string,
  extra: Record<string, unknown> = {},
  timeout = FETCH_TIMEOUT_MS,
  onProgress?: (progress: PullProgress) => void,
): Promise<Reply> {
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

    // "timed_out", not "extension_unavailable": silence for N seconds means the extension
    // did not answer *in time*, which is not the same as it not being there — and telling
    // a coordinator to install what they already have sends them somewhere useless.
    let timer = setTimeout(() => finish({ ok: false, error: "timed_out" }), timeout);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data as {
        channel?: string;
        dir?: string;
        id?: string;
        payload?: Reply;
        fetched?: number;
        total?: number | null;
      };
      if (message?.channel !== CHANNEL) return;

      /*
       * A pull is several pages now, and each one that lands is proof the extension is
       * still working. The clock is for silence, so any word from it starts the clock
       * again — otherwise a pull that is going perfectly well is abandoned for being
       * long, which is the whole fault this is here to prevent.
       */
      if (message.dir === "progress") {
        onProgress?.({ fetched: Number(message.fetched ?? 0), total: message.total ?? null });
        clearTimeout(timer);
        timer = setTimeout(() => finish({ ok: false, error: "timed_out" }), timeout);
        return;
      }

      if (message.dir !== "response" || message.id !== id) return;
      finish(message.payload ?? { ok: false, error: "extension_unavailable" });
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ channel: CHANNEL, dir: "request", id, type, ...extra }, window.location.origin);
  });
}

/** True when the extension is installed and this origin is in its content-script matches. */
export async function isExtensionInstalled(): Promise<boolean> {
  return Boolean((await ask("ping", {}, PING_TIMEOUT_MS)).ok);
}

/**
 * Which kind of silence this was.
 *
 * A request that times out has told us nothing about why. Asking the extension for a
 * ping settles it: an extension that answers in a moment is present and was simply still
 * working, and one that does not is not there. The difference is the whole message —
 * "try again or narrow the filter" against "install the extension".
 */
export function silenceMeans(extensionAnswers: boolean): "timed_out" | "extension_unavailable" {
  return extensionAnswers ? "timed_out" : "extension_unavailable";
}

async function diagnose(error: string): Promise<string> {
  if (error !== "timed_out") return error;
  return silenceMeans(await isExtensionInstalled());
}

export async function listPresets(): Promise<RosterPreset[]> {
  const reply = await ask("presets", {}, 3_000);
  return reply.ok ? ((reply.presets as RosterPreset[]) ?? []) : [];
}

/** One filter the portal accepts, and the values it offers for it. */
export type PortalField = {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  /** True only where the values have been confirmed — see filter-schema.js. */
  verified?: boolean;
  source?: string;
};

/** One column the portal's grid has, as its own column picker lists it. */
export type PortalColumn = {
  key: string;
  label: string;
  source?: string;
};

export type PortalSchema = {
  ok: boolean;
  /** "portal" once the extension has read the real thing; "built-in" until then. */
  source: "portal" | "built-in" | "unknown";
  fields: PortalField[];
  /**
   * What the table may show, which is not what it may filter by: a field can be
   * filterable and never shown, and a column shown and never filterable.
   */
  columns: PortalColumn[];
  term: { code: string; label: string } | null;
  harvestedAt: number | null;
  error: string;
};

/**
 * What the extension will let us filter by.
 *
 * The list is learned from the portal's own Student Search grid, so it stays true when
 * the portal changes. Until somebody visits the portal it falls back to the codes
 * verified by hand, which is worth showing plainly rather than hiding.
 */
export async function fetchSchema(): Promise<PortalSchema> {
  const reply = await ask("schema", {}, 5_000);
  const error = reply.ok ? "" : await diagnose(String(reply.error ?? "unknown"));
  return {
    ok: Boolean(reply.ok),
    source: (reply.source as PortalSchema["source"]) ?? "unknown",
    fields: (reply.fields as PortalField[]) ?? [],
    columns: (reply.columns as PortalColumn[]) ?? [],
    term: (reply.term as PortalSchema["term"]) ?? null,
    harvestedAt: (reply.harvestedAt as number | null) ?? null,
    error: reply.ok ? "" : messageFor(error, String(reply.message ?? "")),
  };
}

export class PortalError extends Error {
  constructor(
    readonly code: string,
    detail = "",
  ) {
    super(messageFor(code, detail));
    this.name = "PortalError";
  }
}

function messageFor(code: string, detail = ""): string {
  switch (code) {
    case "timed_out":
      return (
        "The registrar portal did not finish answering. A whole term is thousands of " +
        "students in one request — try again, or narrow the view's filter."
      );
    case "extension_unavailable":
      // Chrome says this when the extension has been updated under an open page: the
      // injected script belongs to the old instance and can no longer reach it.
      return /context invalidated/i.test(detail)
        ? "The SCEN Rosters extension was updated. Reload this page to reconnect to it."
        : "The SCEN Rosters extension did not answer. Install it, or reload this page after enabling it.";
    case "auth":
      return "Your registrar portal session has expired. Open the portal, sign in, then pull again.";
    case "network":
      return "The registrar portal could not be reached from your browser.";
    case "unknown_preset":
      return "That saved search is no longer in the extension.";
    case "filter_refused":
      // The extension decides what may be asked, so its refusal is the whole answer.
      return `The extension would not ask the portal that: ${detail || "the filter was refused"}.`;
    case "http":
      return `The registrar portal answered with an error${detail ? ` (${detail})` : ""}.`;
    case "internal":
      return `The SCEN Rosters extension failed${detail ? `: ${detail}` : ""}.`;
    default:
      return `The registrar portal returned an unexpected error${detail ? `: ${detail}` : ""}.`;
  }
}

/** Pull one of the extension's own presets, by name. */
export async function pullRoster(
  presetId: string,
  onProgress?: (progress: PullProgress) => void,
): Promise<PortalRoster> {
  return run({ presetId }, presetId, onProgress);
}

/**
 * Pull a filter composed here.
 *
 * The extension checks every field and value against the schema before it asks the
 * portal anything, so this can only ask for combinations the portal itself offers.
 */
export async function pullFilter(
  filter: Record<string, string[]>,
  meta: { name?: string; expect?: number | null } = {},
  onProgress?: (progress: PullProgress) => void,
): Promise<PortalRoster> {
  return run({ filter, meta }, "", onProgress);
}

async function run(
  request: Record<string, unknown>,
  presetId: string,
  onProgress?: (progress: PullProgress) => void,
): Promise<PortalRoster> {
  const reply = await ask("fetch", request, FETCH_TIMEOUT_MS, onProgress);
  if (!reply.ok) {
    // A refusal explains itself in `detail`; a failure further out uses `message`.
    const detail = String(reply.message ?? reply.detail ?? reply.status ?? "");
    throw new PortalError(await diagnose(String(reply.error ?? "unknown")), detail);
  }
  return {
    presetId: String(reply.presetId ?? presetId),
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
