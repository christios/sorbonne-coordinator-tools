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
 * Any word from the extension starts it again, so only a pull that has genuinely stopped
 * hits it. A minute without a word is stopped — for one section of the timetable, which
 * is a moment's question. A whole list is not asked on this clock: see LIST_SILENCE_MS.
 */
const FETCH_TIMEOUT_MS = 60_000;
/*
 * And a limit on the whole thing.
 *
 * Ten minutes is far longer than the slowest real pull (a whole term of students is about
 * a minute) and short enough that nobody sits watching a spinner that will never stop.
 */
const PULL_LIMIT_MS = 10 * 60_000;
/*
 * How long a whole list may be silent: as long as it may take at all.
 *
 * The extension means to beat every five seconds while it waits on the portal, but it
 * sends the beat with `chrome.runtime.sendMessage`, which Chrome does not deliver to
 * content scripts ("extensions cannot send messages to content scripts using this
 * method") — so no beat has ever reached a page. A list that took more than a minute was
 * given up on here while the portal was still working on it, and the run went on to ask
 * for the next list on top of it: two of the heaviest things the portal does, at once.
 *
 * A missing extension is not what this clock is for any more. The run asks for a ping
 * before it starts, and an extension that goes away mid-pull closes its message port,
 * which the bridge reports at once.
 */
const LIST_SILENCE_MS = PULL_LIMIT_MS;
const PING_TIMEOUT_MS = 1_500;

/*
 * How hard the portal is asked: one request at a time, a second apart at least, and a
 * breath after every whole list.
 *
 * On the morning of 29 September 2026 a sync asked the registrar's timetable about 167
 * sections in about nine seconds — two at a time, each the moment the last came back —
 * and the registrar's system was in trouble that morning. Nothing a sync does is urgent
 * enough to be worth that: a second apart, the sweep is three minutes. So every request
 * that reaches the portal waits its turn here, whichever step it belongs to.
 *
 * The clock is here with the pace so a test can keep time itself; nothing else replaces it.
 */
export const portalPace = {
  /** From the start of one request to the start of the next. */
  apart: 1_000,
  /** After a whole list has landed, before the portal is asked anything else. */
  afterList: 5_000,
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

let portalFreeAt = 0;
let portalQueue: Promise<unknown> = Promise.resolve();

/**
 * Wait for the portal's turn, then ask it.
 *
 * @param rest how long the portal is left alone after this request has been answered.
 */
export function portalTurn<T>(rest: number, work: () => Promise<T>): Promise<T> {
  const turn = portalQueue.then(async () => {
    const wait = portalFreeAt - portalPace.now();
    if (wait > 0) await portalPace.sleep(wait);
    portalFreeAt = portalPace.now() + portalPace.apart;
    try {
      return await work();
    } finally {
      portalFreeAt = Math.max(portalFreeAt, portalPace.now() + rest);
    }
  });
  portalQueue = turn.catch(() => undefined);
  return turn;
}

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

/**
 * Which portal grid a pull reads. Students was the only one for a year; courses,
 * teachers and a student's registrations are the same request behind other pages.
 */
export type PullKind = "students" | "courses" | "teachers" | "registrations";

export type PortalRoster = {
  kind: PullKind;
  /** The portal term the extension asked about, for lists that are per term. */
  term?: { code: string; label: string } | null;
  presetId: string;
  name: string;
  count: number;
  expect: number | null;
  /**
   * What the extension noticed about the answer: "zero_rows" when a filter code matched
   * nothing, "count_drift" when the size moved a lot, "short_answer" when the portal
   * said how many there were and then sent fewer, "truncated" when there were too many
   * to hold. A pull that is quietly incomplete is the worst kind, so these are said out
   * loud on the page rather than kept here.
   */
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
      clearTimeout(limit);
      resolve(payload);
    };

    // "timed_out", not "extension_unavailable": silence for N seconds means the extension
    // did not answer *in time*, which is not the same as it not being there — and telling
    // a coordinator to install what they already have sends them somewhere useless.
    let timer = setTimeout(() => finish({ ok: false, error: "timed_out" }), timeout);
    // Not restarted by progress: this one is the whole pull's length, not its silence.
    const limit = setTimeout(() => finish({ ok: false, error: "gave_up" }), PULL_LIMIT_MS);

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
export function fetchSchema(): Promise<PortalSchema> {
  return fetchGridSchema("students");
}

/** The same, for one of the other grids: its own fields, its own columns. */
export async function fetchGridSchema(kind: PullKind): Promise<PortalSchema> {
  const reply = await ask("schema", { kind }, 5_000);
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
    case "gave_up":
      return (
        "The portal was still answering after ten minutes, so this list was " +
        "given up on. The portal is not well; try again later, or narrow the filter."
      );
    case "timed_out":
      return (
        "The portal did not finish answering. A whole term is thousands of " +
        "students in one request — try again, or narrow the view's filter."
      );
    case "extension_unavailable":
      // Chrome says this when the extension has been updated under an open page: the
      // injected script belongs to the old instance and can no longer reach it.
      return /context invalidated/i.test(detail)
        ? "The SCEN Rosters extension was updated. Reload this page to reconnect to it."
        : "The SCEN Rosters extension did not answer. Install it, or reload this page after enabling it.";
    case "auth":
      return "Your portal session has expired. Open the portal, sign in, then pull again.";
    case "network":
      return "The portal could not be reached from your browser.";
    case "unknown_preset":
      return "That saved search is no longer in the extension.";
    case "filter_refused":
      // The extension decides what may be asked, so its refusal is the whole answer.
      return `The extension would not ask the portal that: ${detail || "the filter was refused"}.`;
    case "http":
      return `The portal answered with an error${detail ? ` (${detail})` : ""}.`;
    case "internal":
      return `The SCEN Rosters extension failed${detail ? `: ${detail}` : ""}.`;
    case "unknown_message":
      /*
       * The extension is older than this page and does not know what was asked of it.
       *
       * It answers this to anything it has no case for, which is exactly what happens to
       * the timetable sweep on a build before 1.8.0 — and without a sentence of its own it
       * arrived as "the registrar portal returned an unexpected error", blaming the portal
       * for a version skew and sending somebody to look at the wrong thing entirely.
       */
      return (
        "The SCEN Rosters extension is older than this page and does not know how to do " +
        "that yet. Update it in chrome://extensions and reload."
      );
    default:
      return `The portal returned an unexpected error${detail ? `: ${detail}` : ""}.`;
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
  meta: { name?: string; expect?: number | null; kind?: PullKind } = {},
  onProgress?: (progress: PullProgress) => void,
): Promise<PortalRoster> {
  const { kind = "students", ...rest } = meta;
  return run({ filter, meta: rest, kind }, "", onProgress);
}

/** One section as the registrar has it booked, collapsed by the extension. */
export type FacilitySection = {
  crn: string;
  courseCode: string;
  title: string;
  teacherName: string;
  /*
   * No head count. `cat=CRN` answers one row per MEETING, not one per student, so any
   * count derived from it is 1 for every section in the term — measured, on 110 of them.
   * Enrolment comes from `portal_courses.registered`, which is the registrar's own count.
   */
  meetings: { meetsOn: string; startsAt: string; endsAt: string; room: string }[];
};

/** One sweep of the registrar's timetable, exactly as the store on the far side takes it. */
export type TimetablePull = {
  termCode: string;
  asked: string[];
  sections: FacilitySection[];
  /** Asked, and told nothing. A fact of its own, never a section with no classes. */
  silent: string[];
  failed: string[];
  /** Whether the sweep reached the end of its own list. Only a complete one may retire a section. */
  complete: boolean;
  /** Rows whose times could not be read. Reported, never dropped in silence. */
  malformed: number;
  warning: string | null;
  fetchedAt: number;
};

/** What a sweep has gathered so far: handed out after every section, so a reload can carry on from it. */
export type TimetableSoFar = {
  termCode: string;
  sections: FacilitySection[];
  silent: string[];
  failed: string[];
  malformed: number;
};

export type SweepOptions = {
  /** What an earlier attempt at this same sweep had already gathered. */
  from?: TimetableSoFar | null;
  /** Told after every section, with everything gathered so far. */
  keep?: (sofar: TimetableSoFar) => void;
  /** Asked before every section: true once nobody wants the answer any more. */
  stop?: () => boolean;
};

/** The sweep was given up on, or replaced by another, part-way through. */
export class SweepStopped extends Error {
  readonly code = "stopped";

  constructor() {
    super("The sync was stopped before the timetable was finished.");
    this.name = "SweepStopped";
  }
}

/**
 * Ask the registrar what it has booked for these sections.
 *
 * One section per request, and each request waits its turn with the portal: a second
 * apart, never two at once. It used to be the whole list in one message, which the
 * extension worked through two at a time as fast as the portal answered — 167 sections in
 * nine seconds — and a page reloaded half-way lost everything asked so far, while the
 * extension carried on asking for a page that was no longer there to hear it. Asked from
 * here, a reload costs at most the one section in flight, and `keep` holds the rest.
 *
 * No category crosses the bridge. The extension will only ask about a CRN; Student and
 * Teacher would return a named person's whole week, which is not a question about a room.
 */
export async function pullTimetable(
  termCode: string,
  crns: string[],
  onProgress?: (progress: PullProgress) => void,
  options: SweepOptions = {},
): Promise<TimetablePull> {
  return sweepOneByOne(
    termCode,
    crns,
    (crn) => portalTurn(0, () => ask("timetable", { termCode, crns: [crn] }, FETCH_TIMEOUT_MS)),
    onProgress,
    options,
  );
}

/**
 * The sweep itself, given the way to ask about one section — apart from the asking so it
 * can be tested without an extension, since jsdom will not deliver postMessage on a clock.
 */
export async function sweepOneByOne(
  termCode: string,
  crns: string[],
  askOne: (crn: string) => Promise<Reply>,
  onProgress?: (progress: PullProgress) => void,
  { from, keep, stop }: SweepOptions = {},
): Promise<TimetablePull> {
  const asked = [...new Set(crns.map((crn) => String(crn).trim()).filter(Boolean))];
  const sofar: TimetableSoFar = {
    termCode: from?.termCode || termCode,
    sections: [...(from?.sections ?? [])],
    silent: [...(from?.silent ?? [])],
    failed: [...(from?.failed ?? [])],
    malformed: from?.malformed ?? 0,
  };
  const accounted = new Set([...sofar.sections.map((section) => section.crn), ...sofar.silent, ...sofar.failed]);
  let done = asked.filter((crn) => accounted.has(crn)).length;
  let truncated = false;
  if (done) onProgress?.({ fetched: done, total: asked.length });

  for (const crn of asked) {
    if (accounted.has(crn)) continue;
    if (stop?.()) throw new SweepStopped();
    const reply = await askOne(crn);
    if (!reply.ok) {
      // An expired session or a missing extension fails every section after this one the
      // same way, so the sweep stops and says so once. What it had stays with `keep`.
      const detail = String(reply.message ?? reply.detail ?? reply.status ?? "");
      throw new PortalError(await diagnose(String(reply.error ?? "unknown")), detail);
    }
    /*
     * Every section asked about lands in exactly one list, because the store refuses a
     * sweep that cannot account for what it asked. An answer that somehow says nothing
     * about it is a failure — never a silence, which is evidence the section is gone.
     */
    const section = ((reply.sections as FacilitySection[]) ?? []).find((one) => one.crn === crn);
    if (section) sofar.sections.push(section);
    else if (((reply.silent as string[]) ?? []).includes(crn)) sofar.silent.push(crn);
    else sofar.failed.push(crn);
    sofar.malformed += Number(reply.malformed ?? 0);
    if (reply.termCode) sofar.termCode = String(reply.termCode);
    if (reply.warning === "truncated") truncated = true;
    accounted.add(crn);
    done += 1;
    keep?.(sofar);
    onProgress?.({ fetched: done, total: asked.length });
  }

  return {
    termCode: sofar.termCode,
    asked,
    sections: sofar.sections,
    silent: sofar.silent,
    failed: sofar.failed,
    complete: !truncated,
    malformed: sofar.malformed,
    warning: truncated ? "truncated" : sofar.malformed ? "malformed_times" : null,
    fetchedAt: Date.now(),
  };
}

async function run(
  request: Record<string, unknown>,
  presetId: string,
  onProgress?: (progress: PullProgress) => void,
): Promise<PortalRoster> {
  // A whole list is the heaviest thing the portal is asked, so it is left alone for a
  // while after answering one.
  const reply = await portalTurn(portalPace.afterList, () => ask("fetch", request, LIST_SILENCE_MS, onProgress));
  if (!reply.ok) {
    // A refusal explains itself in `detail`; a failure further out uses `message`.
    const detail = String(reply.message ?? reply.detail ?? reply.status ?? "");
    throw new PortalError(await diagnose(String(reply.error ?? "unknown")), detail);
  }
  return {
    kind: (reply.kind as PullKind) ?? "students",
    term: (reply.term as PortalRoster["term"]) ?? null,
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
