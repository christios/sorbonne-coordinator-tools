import { MessageSquare, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Tip, TipDo } from "@/components/InfoTip";
import { SelectMenu } from "@/components/SelectMenu";
import {
  DAY_NAMES,
  DAY_SHORT,
  STEP,
  cantHours,
  carryOver,
  clockOf,
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
 * A painted hour says how much it matters: a Must solid, a Would like light and striped in
 * the same colour. One look at the week says which hours the teacher holds to.
 */
const stripes = (line: string) => `repeating-linear-gradient(135deg, ${line} 0 1.5px, transparent 1.5px 6px)`;
export const CELL_TONES: Record<WishKind, Record<WishLevel, CSSProperties>> = {
  cant: {
    must: { backgroundColor: "#d9646a" },
    would: { backgroundColor: "#f8dfe0", backgroundImage: stripes("rgba(217, 100, 106, 0.55)") },
  },
  prefer: {
    must: { backgroundColor: "#4f9f74" },
    would: { backgroundColor: "#dcefe4", backgroundImage: stripes("rgba(79, 159, 116, 0.55)") },
  },
};

/** How finely the week is painted: an hour, half an hour or a quarter a cell, and how tall each row is. */
export type Fineness = 1 | 0.5 | 0.25;
const FINENESS: { value: Fineness; label: string; row: number }[] = [
  { value: 1, label: "1 h", row: 24 },
  { value: 0.5, label: "30 min", row: 16 },
  { value: 0.25, label: "15 min", row: 12 },
];

/** The coarsest cells that say an answer exactly: an hour unless something starts on the half or a quarter. */
export function finenessOf(cells: WishCell[]): Fineness {
  const kinds = new Map(cells.map((cell) => [`${cell.day}:${cell.hour}`, cell.kind]));
  const fits = (size: number) =>
    cells.every((cell) => {
      const start = Math.floor(cell.hour / size) * size;
      for (let hour = start; hour < start + size; hour += STEP) if (kinds.get(`${cell.day}:${hour}`) !== cell.kind) return false;
      return true;
    });
  return fits(1) ? 1 : fits(0.5) ? 0.5 : 0.25;
}

/** The plain words under a week: what the colours and the stripes mean. */
export function WishesLegend() {
  const swatch = (style: CSSProperties) => <span className="inline-block h-3 w-3 rounded-sm" style={style} />;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#667085]">
      <span className="inline-flex items-center gap-1.5">
        {swatch(CELL_TONES.cant.must)}
        {swatch(CELL_TONES.prefer.must)}
        <span>
          <b className="font-semibold text-[#344054]">Solid</b> = Must
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {swatch(CELL_TONES.cant.would)}
        {swatch(CELL_TONES.prefer.would)}
        <span>
          <b className="font-semibold text-[#344054]">Striped</b> = Would like
        </span>
      </span>
      <span>Red: can&rsquo;t teach · Green: would rather</span>
    </p>
  );
}

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

/** Who the form speaks to: a coordinator about a teacher, or the teacher themself. */
export type Voice = "they" | "you";

/** "One wish: the whole block, on Tuesday and Thursday." What a choice in the pop-over reaches. */
function reach(line: WishLine, voice: Voice): string {
  if (line.kind === "prefer") return `One wish: every hour ${voice === "you" ? "you" : "they"} would rather teach, all of it.`;
  if (line.kind !== "cant") return "";
  const days = line.days.map((day) => DAY_NAMES[day]);
  const said = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
  return `One wish: the whole block, ${clockOf(line.from)}–${clockOf(line.to)}${days.length > 1 ? ` on ${said}` : ""}. What you choose here applies to all of it.`;
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

/** A cell of the grid: a day, and where its stretch of the day starts. */
type Spot = { day: number; time: number; cell: HTMLElement };

/**
 * One teacher's timetable wishes for a semester: the week painted, limits, dates away and
 * needs. How much each wish matters is said where the wish is: a painted block opens when the
 * stroke that painted it ends, or when it is clicked, to make it a Must or a Would like,
 * comment on it, or take it away; each limit has its own. The Must quota is kept as it is
 * chosen, not after.
 *
 * The week is painted an hour, half an hour or a quarter at a time; whatever the cells, it is
 * kept to the quarter. A block reads as one: hovered or opened, all of it lights up.
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
  voice = "they",
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
  /** "they" for a coordinator answering about a teacher; "you" on the teacher's own page. */
  voice?: Voice;
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
  const [fineness, setFineness] = useState<Fineness>(() => finenessOf(initial?.cells ?? []));
  const [problem, setProblem] = useState("");
  // The painted block open for ranking, and where its pop-over sits over the grid.
  const [open, setOpen] = useState<{ key: string; left: number; top: number; cell: HTMLElement } | null>(null);
  // The cell the pointer rests on, for its bubble and its block lit up; and a stroke under way.
  const [resting, setResting] = useState<{ day: number; time: number } | null>(null);
  const [stroking, setStroking] = useState(false);
  // A block to open once the stroke that painted it, or the click on it, has been drawn.
  const [toOpen, setToOpen] = useState<Spot | null>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  /*
   * The stroke under way: its colour, the cell it last reached, and that cell on the page. A
   * press on a painted cell waits: let go where it was pressed, it opens that block; dragged
   * on, it paints.
   */
  const stroke = useRef<{ with_: Brush; at: [number, number]; last: Spot; waiting: boolean } | null>(null);

  const rows = Array.from({ length: Math.round((collection.lastHour - collection.firstHour) / fineness) }, (_, index) => collection.firstHour + index * fineness);
  const quartersOf = (time: number) => Array.from({ length: Math.round(fineness / STEP) }, (_, index) => time + index * STEP);
  const rowHeight = FINENESS.find((option) => option.value === fineness)?.row ?? 24;
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
  /** The wish a cell of the grid is part of: the block of its first painted quarter. */
  const lineAt = (day: number, time: number): WishLine | null => {
    for (const hour of quartersOf(time)) {
      const kind = cells.get(`${day}:${hour}`);
      if (kind) return lineOfCell(lines, day, hour, kind);
    }
    return null;
  };

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

  /** Open a painted block's pop-over under the cell it was reached by. */
  const openAt = ({ cell, day, time }: Spot) => {
    const line = lineAt(day, time);
    const box = gridBox.current;
    if (!line || !box) return;
    const at = cell.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const width = 288;
    setOpen({ key: line.key, left: Math.max(0, Math.min(at.left - frame.left, frame.width - width)), top: at.bottom - frame.top + 4, cell });
  };
  const opener = useRef(openAt);
  useEffect(() => {
    opener.current = openAt;
  });
  // Opened only once what was painted is on the page, so it is the block as it now stands.
  useEffect(() => {
    if (!toOpen) return;
    setToOpen(null);
    opener.current(toOpen);
  }, [toOpen]);

  useEffect(() => {
    const stop = () => {
      const held = stroke.current;
      stroke.current = null;
      setStroking(false);
      // Let go: the block painted opens, to say how much it matters. Not after clearing.
      if (held && (held.waiting || held.with_ !== "erase")) setToOpen(held.last);
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  // A press anywhere but the pop-over closes it — caught first, before the dialog keeps it to itself.
  useEffect(() => {
    if (!open) return;
    const elsewhere = (event: PointerEvent) => {
      if (!popover.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", elsewhere, true);
    return () => document.removeEventListener("pointerdown", elsewhere, true);
  }, [open]);
  // Opened, the pop-over takes the keyboard, on the rank the wish has now.
  const openKey = open?.key;
  useEffect(() => {
    if (openKey) popover.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
  }, [openKey]);

  /**
   * Paint every cell on the way from one cell to another, each cell all its quarters. A quick
   * drag reaches cells the pointer never stopped on — from 14:00 straight to 17:00 — and those
   * are painted too. A cell is [its place among the grid's days, its row].
   */
  const paint = (from: [number, number], to: [number, number], with_: Brush) => {
    setCells((current) => {
      const next = new Map(current);
      const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      for (let step = 0; step <= steps; step += 1) {
        const share = steps ? step / steps : 0;
        const day = collection.days[Math.round(from[0] + (to[0] - from[0]) * share)];
        const time = collection.firstHour + Math.round(from[1] + (to[1] - from[1]) * share) * fineness;
        for (const hour of quartersOf(time)) {
          if (with_ === "erase") next.delete(`${day}:${hour}`);
          else next.set(`${day}:${hour}`, with_);
        }
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
          <div className="min-w-0 max-w-xs flex-1">
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
            className="w-full max-w-md rounded-md border border-[#e4e8ef] px-2.5 py-1 text-xs text-[#344054] placeholder:text-[#98a2b3]"
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
  // The block lit up: the one open, the one being painted, else the one the pointer rests on.
  const strokeAt = stroking ? stroke.current?.last : undefined;
  const litKey = open?.key ?? (strokeAt ? lineAt(strokeAt.day, strokeAt.time)?.key : resting ? lineAt(resting.day, resting.time)?.key : undefined);

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
        <p className={heading}>1 · {voice === "you" ? "Your" : "Their"} week</p>
        <p className={hint}>
          Choose a colour and paint across the hours; hours left white are fine. When you let go, the block opens to say how
          much it matters. Click a painted block to change it.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
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
          <div role="radiogroup" aria-label="Cells" className="inline-flex rounded-md bg-[#f2f4f7] p-0.5 text-xs font-semibold">
            {FINENESS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={fineness === option.value}
                onClick={() => setFineness(option.value)}
                className={`rounded px-2 py-0.5 ${fineness === option.value ? "bg-white text-[#1f4e79] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}
              >
                {option.label}
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
            <table className="w-full table-fixed border-separate border-spacing-x-0.5 border-spacing-y-0 select-none text-[11px]" aria-label="The week">
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
                {rows.map((time, row) => (
                  <tr key={time}>
                    <th className="relative pr-1.5 text-right align-top font-normal tabular-nums leading-none text-[#98a2b3]">
                      {Number.isInteger(time) ? <span className="relative -top-1">{clockOf(time)}</span> : null}
                    </th>
                    {collection.days.map((day, column) => {
                      const here: [number, number] = [column, row];
                      const quarters = quartersOf(time).map((hour) => {
                        const kind = cells.get(`${day}:${hour}`);
                        const line = kind ? lineOfCell(lines, day, hour, kind) : null;
                        return { hour, kind, line, level: line ? levelOf(line.key) : ("would" as WishLevel) };
                      });
                      const painted = quarters.filter((quarter) => quarter.kind);
                      const line = painted[0]?.line ?? null;
                      const same = painted.length === quarters.length && painted.every((quarter) => quarter.kind === painted[0].kind);
                      const said = !painted.length
                        ? "fine"
                        : !same
                          ? "partly painted"
                          : `${painted[0].kind === "cant" ? "can't teach" : "would rather"}, ${painted[0].level === "must" ? "a Must" : "a Would like"}`;
                      const comment = line ? comments[line.key] : "";
                      const button = (
                        <button
                          type="button"
                          aria-label={`${DAY_NAMES[day]} ${clockOf(time)}: ${said}`}
                          aria-haspopup={line ? "dialog" : undefined}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            const last = { day, time, cell: event.currentTarget };
                            setStroking(true);
                            setResting(null);
                            if (line && brush !== "erase") {
                              // Let go here and it opens; drag on and it paints from here.
                              stroke.current = { with_: brush, at: here, last, waiting: true };
                              return;
                            }
                            stroke.current = { with_: brush, at: here, last, waiting: false };
                            paint(here, here, brush);
                          }}
                          onPointerEnter={(event) => {
                            const held = stroke.current;
                            if (!held) {
                              setResting({ day, time });
                              return;
                            }
                            held.waiting = false;
                            paint(held.at, here, held.with_);
                            held.at = here;
                            held.last = { day, time, cell: event.currentTarget };
                          }}
                          onPointerLeave={() => setResting((current) => (current?.day === day && current.time === time ? null : current))}
                          onClick={(event) => {
                            // Enter or Space on a cell: the pointer acts on press, the keyboard here.
                            if (event.detail !== 0) return;
                            if (line) openAt({ day, time, cell: event.currentTarget });
                            else paint(here, here, brush);
                          }}
                          className="flex w-full flex-col overflow-hidden bg-white"
                          style={{ height: rowHeight }}
                        >
                          {quarters.map((quarter) => (
                            <span
                              key={quarter.hour}
                              data-quarter={quarter.hour}
                              className={`block min-h-0 w-full flex-1 ${
                                quarter.kind ? "" : Number.isInteger(quarter.hour) ? "border-t border-[#e4e8ef]" : "border-t border-dotted border-[#f2f4f7]"
                              } ${quarter.line && quarter.line.key === litKey ? "brightness-[0.85]" : ""}`}
                              style={quarter.kind ? CELL_TONES[quarter.kind][quarter.level] : undefined}
                            />
                          ))}
                        </button>
                      );
                      return (
                        <td key={day} className="p-0">
                          <Tip
                            open={Boolean(line) && !stroking && !open && resting?.day === day && resting.time === time}
                            side="right"
                            wide={false}
                            title={line ? describeLine(line) : undefined}
                            content={
                              line ? (
                                <>
                                  <span className="mb-1.5 block">
                                    <b className="font-semibold text-[#344054]">{levelOf(line.key) === "must" ? "Must" : "Would like"}</b>
                                    {comment ? <> · &ldquo;{comment}&rdquo;</> : null}
                                  </span>
                                  <TipDo>Click to set Must / Would like, comment or remove</TipDo>
                                  {line.kind === "cant" && line.days.length > 1 ? (
                                    <span className="block text-[#667085]">The whole block, on {line.days.map((each) => DAY_SHORT[each]).join(" and ")}: one wish.</span>
                                  ) : null}
                                </>
                              ) : null
                            }
                          >
                            {button}
                          </Tip>
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
                <div className="grid gap-0.5">
                  <p className="text-sm font-semibold text-[#171717]">{describeLine(openLine)}</p>
                  <p className="text-xs text-[#667085]">{reach(openLine, voice)}</p>
                </div>
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
                  <Trash2 size={13} aria-hidden="true" /> Remove the whole block
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
        <div className="mt-2">
          <WishesLegend />
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
        <p className={heading}>2 · Limits on {voice === "you" ? "your" : "their"} week</p>
        <p className={hint}>Only those that matter. Each one set is a wish of its own: a Must or a Would like.</p>
        <div className="mt-2 grid gap-4">
          {limitBlock("maxDays", "Most days on campus", counts(1, Math.max(1, collection.days.length - 1), "day"))}
          {limitBlock("maxHoursDay", "Most hours in a day", counts(2, 10, "hour"))}
          {limitBlock("maxInRow", "Most hours in a row", counts(1, 8, "hour"))}
          {limitBlock(
            "freeDay",
            voice === "you" ? "A day you'd like free" : "A day they'd like free",
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
