import { MessageSquare, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import {
  DAY_NAMES,
  DAY_SHORT,
  cantHours,
  carryOver,
  describeLine,
  lineOfCell,
  wishLines,
  type WishAway,
  type WishCell,
  type WishCollection,
  type WishKind,
  type WishLevel,
  type WishLimits,
  type WishLine,
  type Wishes,
  type WishesInput,
} from "@/services/teacherWishes";

type Brush = WishKind | "erase";

const BRUSHES: { value: Brush; label: string; on: string; swatch: CSSProperties }[] = [
  { value: "cant", label: "Can't teach", on: "border-[#a6292f] bg-[#fdf3f3] text-[#a6292f]", swatch: { backgroundColor: "#d9646a" } },
  { value: "prefer", label: "Would rather", on: "border-[#2e7d55] bg-[#f2f9f4] text-[#2e7d55]", swatch: { backgroundColor: "#4f9f74" } },
  { value: "erase", label: "Clear", on: "border-[#667085] bg-[#f2f4f7] text-[#344054]", swatch: { backgroundColor: "#ffffff", border: "1px solid #d0d5dd" } },
];

/*
 * A painted hour says how much it matters: a Must solid, a Would like light and hatched in
 * the same colour. One look at the week says which hours the teacher holds to.
 */
const hatch = (line: string) => `repeating-linear-gradient(135deg, ${line} 0 1.5px, transparent 1.5px 6px)`;
export const CELL_TONES: Record<WishKind, Record<WishLevel, CSSProperties>> = {
  cant: {
    must: { backgroundColor: "#d9646a" },
    would: { backgroundColor: "#f8dfe0", backgroundImage: hatch("rgba(217, 100, 106, 0.55)") },
  },
  prefer: {
    must: { backgroundColor: "#4f9f74" },
    would: { backgroundColor: "#dcefe4", backgroundImage: hatch("rgba(79, 159, 116, 0.55)") },
  },
};

const section = "border-t border-[#eef1f5] pt-4";
const heading = "text-sm font-semibold text-[#171717]";
const hint = "mt-0.5 text-xs text-[#667085]";
const field = "w-full rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm";
const COMMENT_LENGTH = 300;

const NONE = "";

/** Must or Would like, side by side. Past the quota, Must waits until another is let go. */
export function LevelToggle({
  name,
  level,
  full,
  quota,
  onChange,
}: {
  name: string;
  level: WishLevel;
  /** Every Must is used, by other wishes. */
  full: boolean;
  quota: number;
  onChange: (level: WishLevel) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex shrink-0 rounded-md border border-[#d0d5dd] p-0.5 text-xs font-semibold">
      <button
        type="button"
        role="radio"
        aria-checked={level === "must"}
        disabled={full && level !== "must"}
        title={full && level !== "must" ? `All ${quota} Musts are used: let another go first` : undefined}
        onClick={() => onChange("must")}
        className={`rounded px-2 py-0.5 ${level === "must" ? "bg-[#a6292f] text-white" : "text-[#344054] disabled:text-[#c8d0da]"}`}
      >
        Must
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={level === "would"}
        onClick={() => onChange("would")}
        className={`rounded px-2 py-0.5 ${level === "would" ? "bg-[#d99b1c] text-white" : "text-[#344054]"}`}
      >
        Would like
      </button>
    </div>
  );
}

/** What the form holds, said the same way whatever order it was entered in: to tell a change. */
function snapshot(parts: {
  cells: WishCell[];
  limits: WishLimits;
  away: WishAway[];
  needs: string;
  note: string;
  levels: Record<string, WishLevel>;
  comments: Record<string, string>;
  reason: string;
}): string {
  const lines = wishLines(parts.cells, parts.limits);
  return JSON.stringify({
    cells: [...parts.cells].sort((a, b) => a.day - b.day || a.hour - b.hour).map((cell) => `${cell.day}:${cell.hour}:${cell.kind}`),
    limits: Object.fromEntries(Object.entries(parts.limits).filter(([, value]) => value)),
    away: parts.away,
    needs: parts.needs.trim(),
    note: parts.note.trim(),
    levels: lines.map((line) => `${line.key}=${parts.levels[line.key] ?? "would"}`),
    comments: lines.map((line) => `${line.key}=${(parts.comments[line.key] ?? "").trim()}`),
    reason: parts.reason.trim(),
  });
}

/**
 * One teacher's timetable wishes for a semester: the week painted, limits, dates away and
 * needs. How much each wish matters is said where the wish is: a painted block is clicked
 * to make it a Must or a Would like, comment on it, or take it away, and each limit has its
 * own. The Must quota is kept as it is chosen, not after.
 *
 * The same parts wherever a teacher answers — here for a coordinator answering for them, and
 * on the page an invited teacher opens.
 */
export function WishesForm({
  collection,
  initial,
  busy,
  error,
  notice,
  noticeTone = "info",
  onSave,
  onCancel,
  onDirtyChange,
}: {
  collection: WishCollection;
  initial: Wishes | null;
  busy?: boolean;
  error?: string;
  /** Said above the form: whose answer this is, and on whose behalf it is entered. */
  notice?: ReactNode;
  /** A warning for changing somebody's answer; information for answering for them. */
  noticeTone?: "info" | "warning";
  onSave: (input: WishesInput) => void;
  onCancel?: () => void;
  /** Told whenever the form comes to differ from what it opened with, or stops differing. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [cells, setCells] = useState<Map<string, WishKind>>(
    () => new Map((initial?.cells ?? []).map((cell) => [`${cell.day}:${cell.hour}`, cell.kind])),
  );
  const [limits, setLimits] = useState<WishLimits>(initial?.limits ?? {});
  const [away, setAway] = useState<WishAway[]>(initial?.away ?? []);
  const [needs, setNeeds] = useState(initial?.needs ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [levels, setLevels] = useState<Record<string, WishLevel>>(initial?.levels ?? {});
  const [comments, setComments] = useState<Record<string, string>>(initial?.comments ?? {});
  const [reason, setReason] = useState(initial?.overCapReason ?? "");
  const [brush, setBrush] = useState<Brush>("cant");
  const [problem, setProblem] = useState("");
  // The painted block open for ranking, and where its pop-over sits over the grid.
  const [open, setOpen] = useState<{ key: string; left: number; top: number; cell: HTMLElement } | null>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  /*
   * The stroke under way: its colour and the cell it last reached. A press on a painted hour
   * waits: let go where it was pressed, it opens that block; dragged on, it paints.
   */
  const stroke = useRef<{ with_: Brush; at: [number, number]; waiting?: { day: number; hour: number; cell: HTMLElement } } | null>(null);

  const hours = Array.from({ length: collection.lastHour - collection.firstHour }, (_, index) => collection.firstHour + index);
  const asList: WishCell[] = useMemo(
    () =>
      [...cells.entries()].map(([key, kind]) => {
        const [day, hour] = key.split(":").map(Number);
        return { day, hour, kind };
      }),
    [cells],
  );
  const lines = useMemo(() => wishLines(asList, limits), [asList, limits]);
  const levelOf = (key: string): WishLevel => levels[key] ?? "would";
  const musts = lines.filter((line) => levelOf(line.key) === "must").length;
  const full = musts >= collection.mustQuota;
  const cant = cantHours(asList);
  const overCap = cant > collection.cantCap;

  // A block repainted keeps its rank and its comment under its new key (see `carryOver`).
  const before = useRef(lines);
  useEffect(() => {
    const was = before.current;
    before.current = lines;
    if (was === lines) return;
    setLevels((current) => {
      const next = carryOver(was, lines, current, {}).levels;
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
    setComments((current) => {
      const next = carryOver(was, lines, {}, current).comments;
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [lines]);

  const [opened] = useState(() =>
    snapshot({
      cells: initial?.cells ?? [],
      limits: initial?.limits ?? {},
      away: initial?.away ?? [],
      needs: initial?.needs ?? "",
      note: initial?.note ?? "",
      levels: initial?.levels ?? {},
      comments: initial?.comments ?? {},
      reason: initial?.overCapReason ?? "",
    }),
  );
  const dirty = snapshot({ cells: asList, limits, away, needs, note, levels, comments, reason }) !== opened;
  const told = useRef(onDirtyChange);
  useEffect(() => {
    told.current = onDirtyChange;
  });
  useEffect(() => {
    told.current?.(dirty);
  }, [dirty]);

  /** Open a painted block's pop-over under the hour it was clicked on. */
  const openAt = (cell: HTMLElement, day: number, hour: number) => {
    const line = lineOfCell(lines, day, hour, cells.get(`${day}:${hour}`));
    const box = gridBox.current;
    if (!line || !box) return;
    const at = cell.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const width = 288;
    setOpen({
      key: line.key,
      left: Math.max(0, Math.min(at.left - frame.left, frame.width - width)),
      top: at.bottom - frame.top + 4,
      cell,
    });
  };
  const opener = useRef(openAt);
  useEffect(() => {
    opener.current = openAt;
  });

  useEffect(() => {
    const stop = () => {
      const waiting = stroke.current?.waiting;
      stroke.current = null;
      if (waiting) opener.current(waiting.cell, waiting.day, waiting.hour);
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  // A press anywhere but the pop-over closes it — caught first, before the dialog keeps it to itself.
  useEffect(() => {
    if (!open) return;
    const away_ = (event: PointerEvent) => {
      if (!popover.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away_, true);
    return () => document.removeEventListener("pointerdown", away_, true);
  }, [open]);
  // Opened, the pop-over takes the keyboard, on the rank the wish has now.
  const openKey = open?.key;
  useEffect(() => {
    if (openKey) popover.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }, [openKey]);

  /**
   * Paint every cell on the way from one cell to another. A quick drag reaches cells the
   * pointer never stopped on — from 14:00 straight to 17:00 — and those are painted too.
   * A cell is [its place among the grid's days, its hour].
   */
  const paint = (from: [number, number], to: [number, number], with_: Brush) => {
    setCells((current) => {
      const next = new Map(current);
      const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      for (let step = 0; step <= steps; step += 1) {
        const share = steps ? step / steps : 0;
        const day = collection.days[Math.round(from[0] + (to[0] - from[0]) * share)];
        const key = `${day}:${Math.round(from[1] + (to[1] - from[1]) * share)}`;
        if (with_ === "erase") next.delete(key);
        else next.set(key, with_);
      }
      return next;
    });
  };

  /** Take a whole wish off the week: a can't-teach block on each of its days, or every preferred hour. */
  const removeLine = (line: WishLine) => {
    setCells((current) => {
      const next = new Map(current);
      for (const [key, kind] of current) {
        const [day, hour] = key.split(":").map(Number);
        if (line.kind === "prefer" ? kind === "prefer" : line.kind === "cant" && kind === "cant" && line.days.includes(day) && line.from <= hour && hour < line.to) {
          next.delete(key);
        }
      }
      return next;
    });
  };

  const setLevel = (key: string, level: WishLevel) => setLevels((current) => ({ ...current, [key]: level }));
  const setComment = (key: string, said: string) => setComments((current) => ({ ...current, [key]: said.slice(0, COMMENT_LENGTH) }));

  const limitBlock = (name: keyof WishLimits, label: string, options: { value: string; label: string }[]) => {
    const set = Boolean(limits[name]);
    return (
      <div className="grid content-start gap-1.5">
        <span className="text-xs font-semibold text-[#344054]">{label}</span>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SelectMenu
              label={label}
              value={limits[name] ? String(limits[name]) : NONE}
              onChange={(value) => setLimits((current) => ({ ...current, [name]: value ? Number(value) : null }))}
              options={[{ value: NONE, label: "No limit" }, ...options]}
            />
          </div>
          {set ? (
            <LevelToggle
              name={`${label}: how much it matters`}
              level={levelOf(name)}
              full={full}
              quota={collection.mustQuota}
              onChange={(level) => setLevel(name, level)}
            />
          ) : null}
        </div>
        {set ? (
          <input
            aria-label={`${label}: comment`}
            value={comments[name] ?? ""}
            maxLength={COMMENT_LENGTH}
            onChange={(event) => setComment(name, event.target.value)}
            placeholder="Why it matters (optional)"
            className="w-full rounded-md border border-[#e4e8ef] px-2.5 py-1 text-xs text-[#344054] placeholder:text-[#98a2b3]"
          />
        ) : null}
      </div>
    );
  };
  const counts = (from: number, to: number, unit: string) =>
    Array.from({ length: to - from + 1 }, (_, index) => ({ value: String(from + index), label: `${from + index} ${unit}${from + index === 1 ? "" : "s"}` }));

  const submit = (finished: boolean) => {
    setProblem("");
    if (finished && overCap && !reason.trim()) {
      setProblem(`Say why ${cant} hours can't be taught, over the ${collection.cantCap} a week, or mark fewer.`);
      return;
    }
    if (away.some((entry) => !entry.from || !entry.to || entry.to < entry.from)) {
      setProblem("Each time away needs a first and a last day, the last on or after the first.");
      return;
    }
    onSave({
      cells: asList,
      limits,
      away,
      needs,
      note,
      levels: Object.fromEntries(lines.map((line) => [line.key, levelOf(line.key)])),
      comments: Object.fromEntries(
        lines.filter((line) => (comments[line.key] ?? "").trim()).map((line) => [line.key, comments[line.key].trim()]),
      ),
      overCapReason: overCap ? reason : "",
      submit: finished,
    });
  };

  const openLine = open ? lines.find((line) => line.key === open.key) : undefined;

  return (
    <div className="space-y-4">
      {notice ? (
        <div
          role={noticeTone === "warning" ? "note" : undefined}
          className={`rounded-md px-3 py-2 text-sm ${noticeTone === "warning" ? "bg-[#fdf6e3] text-[#7a5d00]" : "bg-[#f2f7fb] text-[#344054]"}`}
        >
          {notice}
        </div>
      ) : null}

      {/* -------------------------------------------------------------- their week */}
      <div>
        <p className={heading}>1 · Their week</p>
        <p className={hint}>
          Choose a colour, then click or drag across the hours. Hours left white are fine. Click a painted block to say how
          much it matters, add a comment, or remove it.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div role="radiogroup" aria-label="Paint with" className="flex flex-wrap gap-1.5">
            {BRUSHES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={brush === option.value}
                onClick={() => setBrush(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  brush === option.value ? option.on : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
                }`}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={option.swatch} /> {option.label}
              </button>
            ))}
          </div>
          <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs tabular-nums">
            <span className={full ? "font-semibold text-[#1f4e79]" : "text-[#667085]"}>
              {musts} of {collection.mustQuota} Musts used
            </span>
            <span className={overCap ? "font-semibold text-[#a6292f]" : "text-[#667085]"}>
              Can&rsquo;t teach: {cant} of {collection.cantCap} h a week
            </span>
          </span>
        </div>
        <div ref={gridBox} className="relative mt-2">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-collapse select-none text-[11px]" aria-label="The week">
              <thead>
                <tr>
                  <th className="w-12" />
                  {collection.days.map((day) => (
                    <th key={day} className="pb-1 font-semibold text-[#344054]">
                      {DAY_SHORT[day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hours.map((hour) => (
                  <tr key={hour}>
                    <th className="pr-1.5 text-right font-normal tabular-nums text-[#98a2b3]">{`${String(hour).padStart(2, "0")}:00`}</th>
                    {collection.days.map((day, column) => {
                      const kind = cells.get(`${day}:${hour}`);
                      const here: [number, number] = [column, hour];
                      const line = kind ? lineOfCell(lines, day, hour, kind) : null;
                      const level = line ? levelOf(line.key) : "would";
                      const said = kind === "cant" ? "can't teach" : kind === "prefer" ? "would rather" : "fine";
                      return (
                        <td key={day} className="p-0">
                          <button
                            type="button"
                            aria-label={`${DAY_NAMES[day]} ${hour}:00: ${said}${kind ? `, ${level === "must" ? "a Must" : "a Would like"}` : ""}`}
                            aria-haspopup={kind ? "dialog" : undefined}
                            onPointerDown={(event) => {
                              event.preventDefault();
                              const cell = event.currentTarget;
                              if (kind && brush !== "erase") {
                                // Let go here and it opens; drag on and it paints from here.
                                stroke.current = { with_: brush, at: here, waiting: { day, hour, cell } };
                                return;
                              }
                              stroke.current = { with_: brush, at: here };
                              paint(here, here, brush);
                            }}
                            onPointerEnter={() => {
                              const held = stroke.current;
                              if (!held) return;
                              held.waiting = undefined;
                              paint(held.at, here, held.with_);
                              held.at = here;
                            }}
                            onClick={(event) => {
                              // Enter or Space on a cell: the pointer acts on press, the keyboard here.
                              if (event.detail !== 0) return;
                              if (kind) openAt(event.currentTarget, day, hour);
                              else paint(here, here, brush);
                            }}
                            className="block h-6 w-full border border-[#eef1f5] bg-white hover:brightness-95"
                            style={kind ? CELL_TONES[kind][level] : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {open && openLine ? (
            <div
              ref={popover}
              role="dialog"
              aria-label={describeLine(openLine)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // This pop-over only, not the window round it.
                event.stopPropagation();
                setOpen(null);
                open.cell.focus();
              }}
              className="absolute z-20 grid w-72 gap-2.5 rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"
              style={{ left: open.left, top: open.top }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-[#171717]">{describeLine(openLine)}</p>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => {
                    setOpen(null);
                    open.cell.focus();
                  }}
                  className="-mr-1 -mt-1 rounded p-1 text-[#98a2b3] hover:bg-[#f2f4f7] hover:text-[#344054]"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
              <LevelToggle
                name="How much it matters"
                level={levelOf(openLine.key)}
                full={full}
                quota={collection.mustQuota}
                onChange={(level) => setLevel(openLine.key, level)}
              />
              {full && levelOf(openLine.key) !== "must" ? (
                <p className="-mt-1 text-xs text-[#667085]">All {collection.mustQuota} Musts are used: let one go to make this a Must.</p>
              ) : null}
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-[#344054]">Comment</span>
                <input
                  value={comments[openLine.key] ?? ""}
                  maxLength={COMMENT_LENGTH}
                  onChange={(event) => setComment(openLine.key, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      setOpen(null);
                      open.cell.focus();
                    }
                  }}
                  placeholder="Why it matters (optional)"
                  className={field}
                />
              </label>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    removeLine(openLine);
                    setOpen(null);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                >
                  <Trash2 size={13} aria-hidden="true" /> Remove
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(null);
                    open.cell.focus();
                  }}
                  className="rounded-md bg-[#1f4e79] px-3 py-1 text-xs font-semibold text-white"
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#667085]">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.cant.must} />
            <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.cant.would} /> Can&rsquo;t teach
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.prefer.must} />
            <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.prefer.would} /> Would rather
          </span>
          <span>Solid is a Must, hatched a Would like.</span>
        </div>
        {lines.some((line) => (line.kind === "cant" || line.kind === "prefer") && comments[line.key]) ? (
          <ul className="mt-2 grid gap-0.5 text-xs text-[#667085]" aria-label="Comments on the week">
            {lines
              .filter((line) => (line.kind === "cant" || line.kind === "prefer") && comments[line.key])
              .map((line) => (
                <li key={line.key} className="flex items-start gap-1.5">
                  <MessageSquare size={12} className="mt-0.5 shrink-0 text-[#98a2b3]" aria-hidden="true" />
                  <span>
                    <span className="font-semibold text-[#344054]">{describeLine(line)}:</span> {comments[line.key]}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
        {overCap ? (
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-[#a6292f]">
              {cant} hours can&rsquo;t be taught, over the {collection.cantCap} a week: say why, for the coordinator
            </span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className={`mt-1 ${field}`} />
          </label>
        ) : null}
      </div>

      {/* -------------------------------------------------------------- limits */}
      <div className={section}>
        <p className={heading}>2 · Limits on their week</p>
        <p className={hint}>Only those that matter. Each one set is a wish of its own: a Must or a Would like.</p>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {limitBlock("maxDays", "Most days on campus", counts(1, Math.max(1, collection.days.length - 1), "day"))}
          {limitBlock("maxHoursDay", "Most hours in a day", counts(2, 10, "hour"))}
          {limitBlock("maxInRow", "Most hours in a row", counts(1, 8, "hour"))}
          {limitBlock(
            "freeDay",
            "A day they'd like free",
            collection.days.map((day) => ({ value: String(day), label: DAY_NAMES[day] })),
          )}
        </div>
      </div>

      {/* -------------------------------------------------------------- dates and needs */}
      <div className={section}>
        <p className={heading}>3 · Dates away and needs</p>
        <div className="mt-2 space-y-2">
          {away.map((entry, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Away from"
                value={entry.from}
                onChange={(event) => setAway((current) => current.map((each, at) => (at === index ? { ...each, from: event.target.value } : each)))}
                className="rounded-md border border-[#cbd5e1] px-2 py-1 text-sm"
              />
              <span className="text-xs text-[#667085]">to</span>
              <input
                type="date"
                aria-label="Away until"
                value={entry.to}
                onChange={(event) => setAway((current) => current.map((each, at) => (at === index ? { ...each, to: event.target.value } : each)))}
                className="rounded-md border border-[#cbd5e1] px-2 py-1 text-sm"
              />
              <input
                aria-label="Why"
                value={entry.reason}
                maxLength={160}
                placeholder="Why: conference, leave…"
                onChange={(event) => setAway((current) => current.map((each, at) => (at === index ? { ...each, reason: event.target.value } : each)))}
                className="min-w-0 flex-1 rounded-md border border-[#cbd5e1] px-2 py-1 text-sm"
              />
              <button
                type="button"
                aria-label="Remove these dates"
                onClick={() => setAway((current) => current.filter((_, at) => at !== index))}
                className="rounded p-1 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
              >
                <X size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAway((current) => [...current, { from: "", to: "", reason: "" }])}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4e79] hover:underline"
          >
            <Plus size={13} aria-hidden="true" /> Add dates away
          </button>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-[#344054]">Room or equipment needs</span>
          <input value={needs} onChange={(event) => setNeeds(event.target.value)} placeholder="Lab, PC room, ground floor…" className={`mt-1 ${field}`} />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-[#344054]">Note</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} className={`mt-1 ${field}`} />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#eef1f5] pt-3">
        {problem || error ? (
          <span role="alert" className="mr-auto text-sm text-[#a6292f]">
            {problem || error}
          </span>
        ) : null}
        {onCancel ? (
          <button type="button" onClick={onCancel} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(false)}
          className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
        >
          Save draft
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(true)}
          className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
        >
          {busy ? "Saving…" : "Submit"}
        </button>
      </div>
    </div>
  );
}
