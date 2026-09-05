import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { clearRun, getRun, isRunning, startRun, subscribe, type SyncRun, type SyncStep } from "@/services/syncRun";
import { freshen, useSyncTargets } from "@/services/syncTargets";

/** The order a run goes in, and what each list is called where a coordinator reads it. */
const WORDS = {
  students: "Students",
  courses: "Courses",
  teachers: "Teachers",
  registrations: "Course registration",
} as const;
const ORDER = Object.keys(WORDS) as (keyof typeof WORDS)[];

/** "2m 10s" — how long this list has been with the portal. */
function since(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function StepIcon({ state }: { state: SyncStep["state"] }) {
  if (state === "running") return <Loader2 size={13} className="animate-spin text-[#1f4e79]" aria-hidden="true" />;
  if (state === "done") return <Check size={13} className="text-[#2e7d55]" aria-hidden="true" />;
  if (state === "failed") return <X size={13} className="text-[#a6292f]" aria-hidden="true" />;
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c8d0da]" aria-hidden="true" />;
}

/**
 * Portal sync: one button that asks the registrar portal for every list.
 *
 * Every list here is the same act — ask the question a view or a portal filter fixed, and
 * write down what came back — and doing them a page at a time meant four visits and
 * remembering which ones you had done. This asks all of them, in the order the pages
 * depend on each other in, and it is the only way to ask: the pages themselves no longer
 * sync, so no page can be refreshed while the rest go stale.
 *
 * It stands at the top right of the header, where the account menu used to. The run
 * itself lives in {@link "@/services/syncRun"} rather than in this component, so changing
 * pages does not interrupt it and a reload picks it up where it was.
 */
export function PortalSyncButton() {
  const client = useQueryClient();
  const [run, setRun] = useState<SyncRun | null>(() => getRun());
  const [open, setOpen] = useState(false);
  const { targets, ready } = useSyncTargets();
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
  useEffect(() => {
    if (!going) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
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
  const troubled = failed.length || steps.some((step) => step.warning);


  return (
    <div className="relative" ref={box}>
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => {
            // While a run is going the button is how you look at it; only an idle one
            // starts another. Either way the report opens, rather than being gone looking for.
            if (running || !ready) return setOpen((was) => !was);
            setOpen(true);
            void startRun(targets, () => freshen(client));
          }}
          disabled={!ready && !running}
          title={ready ? "Ask the registrar portal for every list" : "Nothing to sync yet: no views or portal filters"}
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
            <span>Portal sync</span>
          )}
        </button>

      </div>

      {/* Under the button and against the right edge, which is where the header ends. */}
      {open && steps.length ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 text-left shadow-lg">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-semibold text-[#171717]">
              {running ? "Syncing every list" : failed.length ? "Synced, with trouble" : "Synced"}
            </p>
            {!running ? (
              <button type="button" onClick={() => { clearRun(); setOpen(false); }} className="text-xs text-[#667085] underline">
                Clear
              </button>
            ) : null}
          </div>
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
                        <span className="text-[#98a2b3]"> — {since(step.startedAt, now)}</span>
                      ) : null}
                      {step.warning ? <span className="block text-[#8a6116]">{step.warning}</span> : null}
                      {step.error ? <span className="block text-[#a6292f]">{step.error}</span> : null}
                    </span>
                  </li>
                )),
            )}
          </ul>
          <p className="mt-2 border-t border-[#eef1f5] pt-2 text-[11px] text-[#98a2b3]">
            {running
              ? `${current ? `${current.name} is with the portal now — one slow request, with nothing to count until it lands. ` : ""}This keeps going if you change page, and picks up where it was if you reload.`
              : `${done} of ${steps.length} synced${failed.length ? `, ${failed.length} did not` : ""}.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
