import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type ComponentType } from "react";

import { Modal } from "@/components/Modal";

/** One dismissed warning, as the list offers it back. */
export type DismissedItem = {
  key: string;
  /** The pill's few words: "PHYS-208 not registered". */
  label: string;
  /** The whole sentence, under the pill. */
  detail: string;
  by?: string;
  /** ISO, when it was dismissed. */
  at?: string;
  /** The pill's own colours, so it reads as the pill it was on the table. */
  tone?: string;
  icon?: ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean | "true" }>;
};

/** A row of the table — a student, a teacher — and its dismissed warnings. */
export type DismissedGroup = { id: string; title: string; subtitle?: string; items: DismissedItem[] };

/** "26 Sep 2026", in the reader's own way of writing a date. */
function dayOf(at?: string): string {
  const when = at ? Date.parse(at) : NaN;
  return Number.isNaN(when) ? "" : new Date(when).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** A tick box that can also say "some of these". */
function Tick({ checked, mixed, label, onChange }: { checked: boolean; mixed?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(mixed);
  }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} className="mt-0.5 shrink-0" />;
}

/**
 * The dismissed warnings, row by row, to bring back one at a time.
 *
 * "Bring back" used to bring back everything on screen in one press — eighty decisions
 * several people made over a month, undone because one of them was wrong. Here each is
 * listed under the student or teacher it is about, with who dismissed it and when, and
 * only what is ticked comes back. A row's own box ticks all of that row.
 */
export function BringBackDialog({
  groups,
  busy,
  onBringBack,
  onClose,
}: {
  groups: DismissedGroup[];
  busy: boolean;
  onBringBack: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const every = groups.flatMap((group) => group.items.map((item) => item.key));
  const flip = (keys: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  const count = chosen.size;
  return (
    <Modal
      open
      size="wide"
      onClose={onClose}
      title="Bring back dismissed warnings"
      description="Tick the ones to show again. They come back for everybody; the rest stay dismissed."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div className="flex gap-3 text-sm">
            <button type="button" onClick={() => setChosen(new Set(every))} className="font-semibold text-[#1f4e79] hover:underline">
              Tick all {every.length}
            </button>
            <button
              type="button"
              disabled={!count}
              onClick={() => setChosen(new Set())}
              className="font-semibold text-[#667085] hover:underline disabled:opacity-40"
            >
              Untick all
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!count || busy}
              onClick={() => onBringBack([...chosen])}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              <RotateCcw size={14} aria-hidden="true" />
              {count ? `Bring back ${count}` : "Bring back"}
            </button>
          </div>
        </div>
      }
    >
      <ul className="divide-y divide-[#edf0f4] rounded-lg border border-[#d9dee7] bg-white" aria-label="Dismissed warnings">
        {groups.map((group) => {
          const keys = group.items.map((item) => item.key);
          const ticked = keys.filter((key) => chosen.has(key)).length;
          return (
            <li key={group.id} className="px-4 py-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <Tick
                  label={`All of ${group.title}'s dismissed warnings`}
                  checked={ticked === keys.length}
                  mixed={ticked > 0 && ticked < keys.length}
                  onChange={() => flip(keys, ticked < keys.length)}
                />
                <span className="min-w-0">
                  <span className="font-semibold text-[#171717]">{group.title}</span>
                  {group.subtitle ? <span className="ml-2 font-mono text-xs text-[#98a2b3]">{group.subtitle}</span> : null}
                  <span className="ml-2 text-xs text-[#98a2b3]">{keys.length} dismissed</span>
                </span>
              </label>
              <ul className="mt-2 space-y-2 pl-6">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const when = dayOf(item.at);
                  return (
                    <li key={item.key}>
                      <label className="flex cursor-pointer items-start gap-2.5">
                        <Tick label={`Bring back: ${item.detail}`} checked={chosen.has(item.key)} onChange={() => flip([item.key], !chosen.has(item.key))} />
                        <span className="min-w-0 text-sm">
                          <span
                            className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${item.tone ?? "bg-[#f2f4f7] text-[#475467]"}`}
                          >
                            {Icon ? <Icon size={11} aria-hidden="true" /> : null}
                            <span className="min-w-0 truncate">{item.label}</span>
                          </span>
                          <span className="mt-0.5 block text-[#475467]">{item.detail}</span>
                          {item.by || when ? (
                            <span className="block text-xs text-[#98a2b3]">
                              Dismissed{item.by ? ` by ${item.by}` : ""}
                              {when ? ` on ${when}` : ""}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
