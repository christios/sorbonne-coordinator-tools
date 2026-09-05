import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { fetchPortalFilters } from "@/services/portalLists";
import type { SyncTarget } from "@/services/portalSync";
import {
  clearRun,
  getRun,
  isRunning,
  resumeRun,
  startRun,
  subscribe,
  type SyncRun,
  type SyncStep,
} from "@/services/syncRun";
import { fetchViews } from "@/services/studentDatabase";

/** The order the pages depend on each other in: students, then what they are checked against. */
const ORDER = ["students", "courses", "teachers", "registrations"] as const;

const WORDS: Record<(typeof ORDER)[number], string> = {
  students: "Students",
  courses: "Courses",
  teachers: "Teachers",
  registrations: "Course registration",
};

function StepIcon({ state }: { state: SyncStep["state"] }) {
  if (state === "running") return <Loader2 size={14} className="animate-spin text-[#1f4e79]" aria-hidden="true" />;
  if (state === "done") return <Check size={14} className="text-[#2e7d55]" aria-hidden="true" />;
  if (state === "failed") return <X size={14} className="text-[#a6292f]" aria-hidden="true" />;
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c8d0da]" aria-hidden="true" />;
}

/**
 * One button that syncs everything the student pages read.
 *
 * Every list here is the same act — ask the portal the question a view or a portal filter
 * fixed, and write down what came back — and doing them one page at a time meant four
 * visits and remembering which ones you had done. This asks all of them, in the order the
 * pages depend on each other in.
 *
 * The run itself is kept in {@link "@/services/syncRun"}, not in this component, so it
 * outlives the page: changing pages does not interrupt it, and a reload picks it up where
 * it was. That is also why the button is in the header — it is the one place that is
 * always mounted, so there is always somebody to drive the run.
 */
export function SyncAllButton() {
  const client = useQueryClient();
  const [run, setRun] = useState<SyncRun | null>(() => getRun());
  const [open, setOpen] = useState(false);
  const views = useQuery({ queryKey: ["views"], queryFn: fetchViews });
  const courses = useQuery({ queryKey: ["portal-filters", "courses"], queryFn: () => fetchPortalFilters("courses") });
  const teachers = useQuery({ queryKey: ["portal-filters", "teachers"], queryFn: () => fetchPortalFilters("teachers") });
  const registrations = useQuery({
    queryKey: ["portal-filters", "registrations"],
    queryFn: () => fetchPortalFilters("registrations"),
  });

  const targets: SyncTarget[] = [
    ...(views.data ?? []).map((view) => ({ kind: "students" as const, id: view.id, name: view.name, filter: view.filter })),
    ...(courses.data ?? []).map((filter) => ({ kind: "courses" as const, id: filter.id, name: filter.name, filter: filter.filter })),
    ...(teachers.data ?? []).map((filter) => ({ kind: "teachers" as const, id: filter.id, name: filter.name, filter: filter.filter })),
    ...(registrations.data ?? []).map((filter) => ({ kind: "registrations" as const, id: filter.id, name: filter.name, filter: filter.filter })),
  ];
  const ready = targets.length > 0;

  useEffect(() => subscribe(setRun), []);

  // What a step changed is read from the server, so every page showing it is right again.
  const onStep = () => {
    client.invalidateQueries({ queryKey: ["views"] });
    client.invalidateQueries({ queryKey: ["portal-filters"] });
    client.invalidateQueries({ queryKey: ["students"] });
    client.invalidateQueries({ queryKey: ["cohorts"] });
    client.invalidateQueries({ queryKey: ["portal"] });
    client.invalidateQueries({ queryKey: ["registration-check"] });
    client.invalidateQueries({ queryKey: ["active-teachers"] });
    client.invalidateQueries({ queryKey: ["active-courses"] });
  };

  // A run this page was reloaded out of, or one whose tab has gone quiet, is picked up as
  // soon as we know what its lists are. Once only, however often the queries settle.
  const resumed = useRef("");
  useEffect(() => {
    const held = getRun();
    if (!ready || !isRunning(held) || resumed.current === held.id) return;
    // resumeRun itself decides whether this tab may take it: its own unfinished run, or
    // one whose tab has gone quiet.
    resumed.current = held.id;
    void resumeRun(targets, onStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, run?.id]);

  const running = isRunning(run);
  const steps = run?.steps ?? [];
  const done = steps.filter((step) => step.state === "done").length;
  const failed = steps.filter((step) => step.state === "failed");
  const current = steps.find((step) => step.state === "running");
  const troubled = failed.length || steps.some((step) => step.warning);

  const start = () => {
    if (!ready || running) return;
    resumed.current = "";
    setOpen(true);
    void startRun(targets, onStep);
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (running ? setOpen((current) => !current) : start())}
        disabled={!ready && !running}
        title={ready ? "Sync every list from the registrar portal" : "Nothing to sync yet: no views or portal filters"}
        className="inline-flex items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] shadow-sm hover:bg-[#f2f7fb] disabled:opacity-50"
      >
        {running ? (
          <Loader2 size={15} className="animate-spin" aria-hidden="true" />
        ) : troubled ? (
          <AlertTriangle size={15} className="text-[#8a6116]" aria-hidden="true" />
        ) : (
          <RefreshCw size={15} aria-hidden="true" />
        )}
        {running ? `Syncing ${done + 1} of ${steps.length}…` : "Sync all"}
      </button>

      {/* What the run has done, and what it is doing. Opened by the button while a run is
          going, and by the caret afterwards — a finished run is worth reading. */}
      {steps.length ? (
        <button
          type="button"
          aria-label="What the last sync did"
          onClick={() => setOpen((current) => !current)}
          className="ml-1 rounded-md border border-[#d9dee7] bg-white px-1.5 py-2 text-xs text-[#667085] shadow-sm hover:bg-[#f2f7fb]"
        >
          {open ? "▴" : "▾"}
        </button>
      ) : null}

      {open && steps.length ? (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-[#d9dee7] bg-white p-3 text-left shadow-lg">
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
            {ORDER.flatMap((kind) => {
              const own = steps.filter((step) => step.kind === kind);
              return own.map((step, index) => (
                <li key={step.key} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 w-4 shrink-0 text-center"><StepIcon state={step.state} /></span>
                  <span className="min-w-0 flex-1">
                    {index === 0 ? <span className="font-semibold text-[#344054]">{WORDS[kind]} · </span> : null}
                    <span className="text-[#667085]">{step.name}</span>
                    {step.state === "done" ? (
                      <span className="text-[#98a2b3]"> — {step.seen?.toLocaleString() ?? 0} returned</span>
                    ) : null}
                    {step.warning ? <span className="block text-[#8a6116]">{step.warning}</span> : null}
                    {step.error ? <span className="block text-[#a6292f]">{step.error}</span> : null}
                  </span>
                </li>
              ));
            })}
          </ul>
          <p className="mt-2 border-t border-[#eef1f5] pt-2 text-[11px] text-[#98a2b3]">
            {running
              ? `${current ? `${current.name} is with the portal now. ` : ""}This keeps going if you change page, and picks up where it was if you reload.`
              : `${done} of ${steps.length} synced${failed.length ? `, ${failed.length} did not` : ""}.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
