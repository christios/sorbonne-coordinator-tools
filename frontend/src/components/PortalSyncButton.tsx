import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  abandonRun,
  CHOOSE_WHAT_TO_SYNC,
  clearRun,
  getRun,
  isRunning,
  resumeRun,
  retryFailed,
  startRun,
  subscribe,
  type SyncRun,
  type SyncStep,
} from "@/services/syncRun";
import type { SyncTarget } from "@/services/portalSync";
import { describeAge } from "@/services/rosterStore";
import { fetchCurrentUser } from "@/services/auth";
import { isExtensionInstalled } from "@/services/scenRosters";
import { DEFAULT_SECONDS, FASTEST, fetchSyncPace, paceSaved, setSyncPace, SLOWEST, useSyncPace } from "@/services/syncPace";
import { freshen, useSyncTargets } from "@/services/syncTargets";

/** The order a run goes in, and what each list is called where a coordinator reads it. */
const WORDS = {
  students: "Students",
  courses: "Courses",
  teachers: "Teachers",
  registrations: "Course registration",
  // Last, and much the longest: one call per section against the registrar's own
  // timetable. It reads the registrations above, so it cannot run before them.
  timetable: "Portal timetable",
} as const;
const ORDER = Object.keys(WORDS) as (keyof typeof WORDS)[];

/** "2m 10s" — how long this list has been with the portal. */
function since(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const keyOf = (target: SyncTarget) => `${target.kind}:${target.id}`;

/** How long a sync that went wrong keeps its report in front of the checklist. */
const REPORT_IS_NEWS_FOR_MS = 12 * 60 * 60 * 1000;

/**
 * How far apart the registrar's timetable is asked about two sections, where it can be
 * changed: in the pop-up that chooses what to pull, and in the report while a sweep is
 * still to come or going — a change there applies from the next section.
 *
 * Saved when the field is left or Enter is pressed, not on every keystroke: "12" typed is
 * a "1" first, and the pace of everybody's sync should not flicker through it.
 */
function PaceField() {
  const client = useQueryClient();
  const pace = useSyncPace();
  const held = pace.data?.secondsApart ?? DEFAULT_SECONDS;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Enter saves, and so does leaving the field: one change must be one save, not two.
  const saving = useRef(false);
  const save = async () => {
    if (draft === null || saving.current) return;
    const seconds = Number(draft);
    if (!Number.isInteger(seconds) || seconds < FASTEST || seconds > SLOWEST) {
      setError(`Keep it between ${FASTEST} and ${SLOWEST} seconds between sections.`);
      return;
    }
    setError("");
    if (seconds === held) return setDraft(null);
    saving.current = true;
    try {
      client.setQueryData(["sync-pace"], await setSyncPace(seconds));
      setDraft(null);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      saving.current = false;
    }
  };
  const set = pace.data?.updatedAt ? Date.parse(pace.data.updatedAt) : Number.NaN;
  return (
    <div className="mt-2 border-t border-[#eef1f5] pt-2 text-xs text-[#344054]">
      <label className="flex items-center gap-1.5">
        <span>Portal timetable: one section every</span>
        <input
          type="number"
          min={FASTEST}
          max={SLOWEST}
          step={1}
          value={draft ?? String(held)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void save()}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            void save();
          }}
          aria-label="Seconds between timetable requests"
          className="w-12 rounded border border-[#d9dee7] px-1.5 py-0.5 text-right tabular-nums"
        />
        <span>seconds</span>
      </label>
      <p className="mt-1 text-[11px] leading-4 text-[#98a2b3]">
        {/* One number for everybody: the portal is one system, whoever presses Sync. */}
        {pace.data?.updatedBy && !Number.isNaN(set)
          ? `Set by ${pace.data.updatedByName || pace.data.updatedBy}, ${describeAge(set, Date.now())}. Every coordinator's sync keeps it.`
          : "Every coordinator's sync keeps this pace."}
      </p>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-[#a6292f]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StepIcon({ state }: { state: SyncStep["state"] }) {
  if (state === "running") return <Loader2 size={13} className="animate-spin text-[#1f4e79]" aria-hidden="true" />;
  if (state === "done") return <Check size={13} className="text-[#2e7d55]" aria-hidden="true" />;
  if (state === "failed") return <X size={13} className="text-[#a6292f]" aria-hidden="true" />;
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c8d0da]" aria-hidden="true" />;
}

/**
 * Portal sync: one button that asks the registrar portal for the lists.
 *
 * Every list here is the same act — ask the question a view or a portal filter fixed, and
 * write down what came back — and doing them a page at a time meant four visits and
 * remembering which ones you had done. This asks them in the order the pages depend on
 * each other in, and it is the only way to ask: the pages themselves no longer sync.
 *
 * Which lists, a coordinator ticks each time. Every one of them used to be asked on every
 * press — the whole university's students and staff included — even when a colleague had
 * asked an hour before, and the portal is the registrar's working system: it was reported
 * out on 12 October 2026, and the 13 October sync stopped at the staff list. So the press
 * opens a checklist, everything ticked and each list's age beside it, and the coordinator
 * leaves out what is fresh enough.
 *
 * It stands at the top right of the header, where the account menu used to. The run
 * itself lives in {@link "@/services/syncRun"} rather than in this component, so changing
 * pages does not interrupt it and a reload picks it up where it was.
 */
export function PortalSyncButton() {
  const client = useQueryClient();
  const [run, setRun] = useState<SyncRun | null>(() => getRun());
  const [open, setOpen] = useState(false);
  const { targets, ready, syncedAt, syncedBy } = useSyncTargets();
  const pace = useSyncPace();
  /* The checklist: open or not, and what is ticked in it — everything, each time it opens. */
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  /*
   * Whose sync the age is. Everybody reads the same lists, so the age on this button can be
   * a colleague's sync — and an age with no name read as a sync this coordinator had not
   * run. Their own reads "you"; anybody else's, the first name Settings gives them.
   */
  const me = useQuery({ queryKey: ["staff-user"], queryFn: fetchCurrentUser, retry: false });
  const syncer = syncedBy
    ? syncedBy.email.toLowerCase() === (me.data?.email ?? "").toLowerCase()
      ? "you"
      : syncedBy.name.split(/\s+/)[0] || syncedBy.email
    : "";
  const box = useRef<HTMLDivElement>(null);

  // Anywhere else puts the report away — it is a report, not a dialog, and nothing in the
  // page below it should have to wait for a close button to be found.
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  useEffect(() => subscribe(setRun), []);

  /*
   * A ticking clock while a list is with the portal.
   *
   * A pull is one slow request with nothing to count, so the only honest signal of
   * progress is how long it has been going — and that is also what tells a coordinator
   * whether to wait or to worry. It stops when the run does.
   */
  const [now, setNow] = useState(() => Date.now());
  const going = isRunning(run);
  /*
   * The clock runs whether or not a sync does, only slower when it does not.
   *
   * It used to stop the moment a run ended, which froze the age beside the button at
   * whatever it read when the page was opened: a tab left open all morning went on saying
   * "2 days ago" an hour after a sync, and only a reload corrected it. The age is the
   * whole point of the line — it is what says whether what you are looking at is worth
   * trusting — so it is kept true. Every second while a run is going, because seconds are
   * what it counts then; every half minute otherwise, which is finer than the coarsest
   * thing the words can say.
   */
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), going ? 1000 : 30_000);
    return () => window.clearInterval(tick);
  }, [going]);

  const running = going;
  const steps = run?.steps ?? [];
  const done = steps.filter((step) => step.state === "done").length;
  // How far along the run is: a list that failed is behind us too, and counting only the
  // ones that worked left the button frozen on the first number for the whole run.
  const settled = steps.filter((step) => step.state === "done" || step.state === "failed").length;
  const failed = steps.filter((step) => step.state === "failed");
  const current = steps.find((step) => step.state === "running");
  /*
   * One reason, when every failure has the same one.
   *
   * An expired session fails every list, because every list starts by asking the portal
   * who you are. Six identical sentences reads as six problems and buries the single
   * thing to do about it. Grouped on the portal's own code rather than on the sentence,
   * which names the list and so is different every time.
   */
  const codes = new Set(failed.map((step) => step.errorCode ?? ""));
  const oneReason = failed.length > 1 && codes.size === 1 && [...codes][0] ? failed[0].error : "";
  const troubled = failed.length || steps.some((step) => step.warning);
  // A finished run's report is opened first only while it is news.
  const recent = Boolean(run?.finishedAt && Date.now() - run.finishedAt < REPORT_IS_NEWS_FOR_MS);
  /*
   * Asked once, before the run, instead of discovered N times during it.
   *
   * Without the extension every list fails the same way, and each one waits out the sixty
   * seconds of silence that is how a missing extension announces itself. Six lists is six
   * minutes to be told one thing. The check itself is a second and a half, and if it
   * cannot be answered the run goes ahead — refusing to start on a maybe would be worse
   * than the wait.
   */
  const [missing, setMissing] = useState(false);
  const choose = () => {
    setMissing(false);
    setPicked(new Set(targets.map(keyOf)));
    setChoosing(true);
    setOpen(true);
  };
  const begin = async () => {
    setMissing(false);
    const chosen = targets.filter((target) => picked.has(keyOf(target)));
    if (!chosen.length) return;
    if (!(await isExtensionInstalled())) {
      setMissing(true);
      setChoosing(false);
      return;
    }
    setChoosing(false);
    // The department's pace as it stands now, after any change still being saved — this
    // page is about to drive the run, and keeps whatever it read last.
    await paceSaved();
    await client.fetchQuery({ queryKey: ["sync-pace"], queryFn: fetchSyncPace }).catch(() => undefined);
    await startRun(chosen, () => freshen(client));
  };

  // The warning that the data is old opens this same checklist rather than syncing everything.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  useEffect(() => {
    const ask = () => {
      if (!isRunning(getRun())) chooseRef.current();
    };
    window.addEventListener(CHOOSE_WHAT_TO_SYNC, ask);
    return () => window.removeEventListener(CHOOSE_WHAT_TO_SYNC, ask);
  }, []);
  const seconds = pace.data?.secondsApart ?? DEFAULT_SECONDS;
  const sweepAhead = running && steps.some((step) => step.kind === "timetable" && (step.state === "waiting" || step.state === "running"));


  return (
    <div className="relative" ref={box}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            /*
             * A finished run is opened, never overwritten.
             *
             * This used to start a new sync whenever one was not already going — including
             * the click somebody made to find out what the warning icon meant. The panel
             * opened, and by the time it did, the run it would have shown had been replaced
             * by a fresh one with every step back to waiting. The warning was unreadable by
             * construction: the only way to ask what it said destroyed the answer.
             *
             * So: a run in flight toggles the report, a finished one opens it, and only
             * having nothing to show starts a sync on the first click. Syncing again is a
             * button inside, next to Clear, where it cannot be pressed by accident.
             */
            if (running || !ready) return setOpen((was) => !was);
            if (open) return setOpen(false);
            /*
             * The checklist, unless the last sync went wrong lately — then what it said
             * first, so a warning can still be read by clicking the icon that shows it.
             * A report kept from days ago is not news: it stays one link away in the
             * checklist, and opening on it hid the checklist from anybody who had ever
             * synced before.
             */
            if (steps.length && troubled && recent && !choosing) return setOpen(true);
            choose();
          }}
          disabled={!ready && !running}
          title={
            !ready
              ? "Nothing to sync yet: no views or portal filters"
              : running
                ? "See how the sync is going"
                : [
                    steps.length ? "See what the last sync did" : "Choose what to ask the portal for",
                    syncedAt && syncedBy ? `Last synced by ${syncer === "you" ? "you" : syncedBy.name}, ${describeAge(syncedAt, now)}` : "",
                  ]
                    .filter(Boolean)
                    .join(" — ")
          }
          className="inline-flex items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] shadow-sm hover:bg-[#f2f7fb] disabled:opacity-50"
        >
          {running ? (
            <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden="true" />
          ) : troubled ? (
            <AlertTriangle size={15} className="shrink-0 text-[#8a6116]" aria-hidden="true" />
          ) : (
            <RefreshCw size={15} className="shrink-0" aria-hidden="true" />
          )}
          {/*
            * The clock is on the button, not only in the panel behind it: the students are
            * two thousand rows in one request, so the count sits on "1 of 6" for minutes
            * and a number that moves is the difference between waiting and worrying.
            *
            * It has a slot of its own — fixed width, lining figures — because a button
            * that changes size every second as the digits change is worse than no clock.
            */}
          {running ? (
            <span className="flex items-center gap-1.5">
              <span>{`Syncing ${Math.min(settled + 1, steps.length)} of ${steps.length}`}</span>
              <span className="w-[3.75rem] text-right font-normal tabular-nums text-[#667085]">
                {current?.startedAt ? since(current.startedAt, now) : ""}
              </span>
            </span>
          ) : (
            <span className="flex items-baseline gap-1.5">
              <span className="hidden sm:inline">Portal sync</span>
              <span className="sm:hidden">Sync</span>
              {/*
                * How stale the oldest list is, on the button rather than greyed in the
                * middle of a page. It is the one thing worth knowing without opening
                * anything: everything on screen was read from a pull of that age.
                */}
              {syncedAt ? (
                <span className="hidden font-normal text-[11px] tabular-nums text-[#98a2b3] sm:inline">
                  {syncer ? `${syncer} · ` : ""}
                  {describeAge(syncedAt, now)}
                </span>
              ) : null}
            </span>
          )}
        </button>

      </div>

      {/* Under the button and against the right edge, which is where the header ends. */}
      {/* Also when nothing ran: a run that was refused before it started still owes a reason. */}
      {open && choosing && !running ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 text-left shadow-lg">
          <div className="mb-1 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-[#171717]">What to ask the portal for</p>
            <button
              type="button"
              onClick={() => setPicked((was) => (was.size === targets.length ? new Set() : new Set(targets.map(keyOf))))}
              className="text-xs text-[#667085] underline"
            >
              {picked.size === targets.length ? "None" : "All"}
            </button>
          </div>
          <p className="mb-2 text-[11px] leading-4 text-[#98a2b3]">
            What is left out stays as it was last synced. The whole-university lists and the timetable are the heavy ones
            for the portal.
          </p>
          {steps.length ? (
            <button type="button" onClick={() => setChoosing(false)} className="mb-2 text-[11px] text-[#1f4e79] underline">
              See what the last sync did
            </button>
          ) : null}
          <ul className="space-y-1">
            {ORDER.flatMap((kind) =>
              targets
                .filter((target) => target.kind === kind)
                .map((target) => {
                  const at = target.lastSyncedAt ? Date.parse(target.lastSyncedAt) : Number.NaN;
                  return (
                    <li key={keyOf(target)}>
                      <label className="flex items-start gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={picked.has(keyOf(target))}
                          onChange={(event) => {
                            const ticked = event.target.checked;
                            setPicked((was) => {
                              const next = new Set(was);
                              if (ticked) next.add(keyOf(target));
                              else next.delete(keyOf(target));
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-[#344054]">{WORDS[kind]} · </span>
                          <span className="text-[#667085]">{target.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-[#98a2b3]">
                          {Number.isNaN(at) ? "never" : describeAge(at, now)}
                        </span>
                      </label>
                    </li>
                  );
                }),
            )}
          </ul>
          {targets.some((target) => target.kind === "timetable") ? <PaceField /> : null}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setChoosing(false);
                setOpen(false);
              }}
              className="rounded-md border border-[#d9dee7] px-2.5 py-1 text-xs font-semibold text-[#344054] hover:bg-[#f7f8fa]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void begin()}
              disabled={!picked.size}
              className="rounded-md bg-[#1f4e79] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#1a4368] disabled:opacity-50"
            >
              {picked.size === targets.length ? "Sync everything" : `Sync ${picked.size} of ${targets.length}`}
            </button>
          </div>
        </div>
      ) : open && (steps.length > 0 || missing) ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 text-left shadow-lg">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-[#171717]">
              {running
                ? "Syncing"
                : missing && !steps.length
                  ? "Nothing was asked for"
                  : failed.length
                    ? "Synced, with trouble"
                    : "Synced"}
            </p>
            {/*
              * While a run is going, the way out is "Give up" — not nothing.
              *
              * There was no control here at all during a run, and clearRun refuses while
              * one is unfinished, so a stalled run could only be recovered by deleting a
              * localStorage key from the console. The pull in flight cannot be recalled;
              * this stops it being written down or resumed, which is what being stuck
              * actually needs.
              */}
            {running ? (
              <button
                type="button"
                onClick={() => { abandonRun(); setOpen(false); }}
                title="Stop waiting on this run. The request already sent cannot be recalled, but nothing will resume it."
                className="text-xs text-[#a6292f] underline"
              >
                Give up
              </button>
            ) : (
              <span className="flex items-center gap-3">
                {/*
                  * Where syncing again lives now that the button above shows the report
                  * instead of replacing it. Beside Clear rather than in place of it: one
                  * runs it again, the other puts the report away, and after a run with
                  * trouble a coordinator wants both to be a deliberate choice.
                  */}
                {failed.length ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (retryFailed()) void resumeRun(targets, () => freshen(client));
                    }}
                    className="text-xs font-semibold text-[#1f4e79] underline"
                  >
                    Retry the {failed.length} that failed
                  </button>
                ) : null}
                <button type="button" onClick={choose} className="text-xs font-semibold text-[#1f4e79] underline">
                  Sync again
                </button>
                <button type="button" onClick={() => { clearRun(); setOpen(false); }} className="text-xs text-[#667085] underline">
                  Clear
                </button>
              </span>
            )}
          </div>
          {missing ? (
            <p role="alert" className="mb-2 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-xs leading-5 text-[#a6292f]">
              The SCEN Rosters extension did not answer, so nothing was asked for. Install it, or reload this page
              after enabling it.
            </p>
          ) : null}
          {oneReason ? (
            <p role="alert" className="mb-2 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-xs leading-5 text-[#a6292f]">
              {oneReason}
            </p>
          ) : null}
          <ul className="space-y-1.5">
            {ORDER.flatMap((kind) =>
              steps
                .filter((step) => step.kind === kind)
                .map((step, index) => (
                  <li key={step.key} className="flex items-start gap-2 text-xs">
                    <span className="mt-0.5 w-4 shrink-0 text-center"><StepIcon state={step.state} /></span>
                    <span className="min-w-0 flex-1">
                      {index === 0 ? <span className="font-semibold text-[#344054]">{WORDS[kind]} · </span> : null}
                      <span className="text-[#667085]">{step.name}</span>
                      {step.state === "done" ? (
                        <span className="text-[#98a2b3]"> — {step.seen?.toLocaleString() ?? 0} returned</span>
                      ) : null}
                      {step.state === "running" && step.startedAt ? (
                        <span className="text-[#98a2b3]">
                          {" — "}
                          {/* A step that is many requests says how many; the rest say how long. */}
                          {step.of ? `${step.seen ?? 0} of ${step.of}, ` : ""}
                          {since(step.startedAt, now)}
                        </span>
                      ) : null}
                      {/*
                        * A list a reload cut off waits for the portal to finish answering the
                        * page that went, and says so — a step sitting still with no reason
                        * given reads as a stuck one.
                        */}
                      {step.state === "waiting" && step.notBefore && step.notBefore > now ? (
                        <span className="text-[#98a2b3]">
                          {" — "}asked again in {since(now, step.notBefore)}, once the portal has answered the page that was
                          reloaded
                        </span>
                      ) : null}
                      {step.warning ? <span className="block text-[#8a6116]">{step.warning}</span> : null}
                      {step.error && !oneReason ? <span className="block text-[#a6292f]">{step.error}</span> : null}
                    </span>
                  </li>
                )),
            )}
          </ul>
          <p className="mt-2 border-t border-[#eef1f5] pt-2 text-[11px] text-[#98a2b3]">
            {running
              ? `${
                  current
                    ? `${current.name} is with the portal now${
                        current.of
                          ? ` — one request per section, ${seconds} second${seconds === 1 ? "" : "s"} apart, so this is the long one. `
                          : " — one slow request, with nothing to count until it lands. "
                      }`
                    : ""
                }The portal is asked one thing at a time, never in a rush. This keeps going if you change page, and picks up where it was if you reload.`
              : `${done} of ${steps.length} synced${failed.length ? `, ${failed.length} did not` : ""}.`}
          </p>
          {sweepAhead ? <PaceField /> : null}
        </div>
      ) : null}
    </div>
  );
}
