import { ChevronLeft, ChevronRight, MessageSquare, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Tip, TipDo } from "@/components/InfoTip";
import { SelectMenu } from "@/components/SelectMenu";
import {
  DAY_NAMES,
  DAY_SHORT,
  STEP,
  awayEntries,
  awaySpot,
  awaySpots,
  awayWords,
  cantHours,
  carryOver,
  clockOf,
  describeLine,
  isoPlus,
  isoWeekday,
  lineOfCell,
  teachingWeeks,
  wishLines,
  type WishAway,
  type WishCalendar,
  type WishCell,
  type WishCollection,
  type WishKind,
  type WishLevel,
  type WishLimits,
  type WishLine,
  type Wishes,
  type WishesInput,
} from "@/services/teacherWishes";
import { formatDayAndMonth, mondayOf, toIsoDate } from "@/services/weekSchedule";

type Brush = WishKind | "erase" | "away";

/** Time away, in the colour calendars give "out of office". */
export const AWAY_TONE: CSSProperties = { backgroundColor: "#8e6bbf" };
const AWAY_BRUSHES: { value: "away" | "erase"; label: string; on: string; swatch: CSSProperties }[] = [
  { value: "away", label: "Away", on: "border-[#6b4fa0] bg-[#f5f1fa] text-[#6b4fa0]", swatch: AWAY_TONE },
  { value: "erase", label: "Clear", on: "border-[#667085] bg-[#f2f4f7] text-[#344054]", swatch: { backgroundColor: "#ffffff", border: "1px solid #d0d5dd" } },
];

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

/** The line over a quarter of the grid: firm on the hour, light on the half hour, dashed on the quarters. */
export function ruleOf(hour: number): string {
  if (Number.isInteger(hour)) return "border-t border-[#c8d0db]";
  return Number.isInteger(hour * 2) ? "border-t border-[#e1e6ed]" : "border-t border-dashed border-[#e6eaf0]";
}

/** A row's time down the left, on every row: "08:00", "08:30", and the quarters short, ":15". */
export function RowTime({ time, size }: { time: number; size: number }) {
  const whole = Number.isInteger(time);
  return (
    <span className={`relative -top-1.5 ${whole ? "text-[#667085]" : "text-[10px] text-[#a3acb9]"}`}>
      {whole || size === 0.5 ? clockOf(time) : `:${clockOf(time).slice(3)}`}
    </span>
  );
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
  if (line.kind === "prefer") return `One preference: every hour ${voice === "you" ? "you" : "they"} would rather teach, all of it.`;
  if (line.kind !== "cant") return "";
  const days = line.days.map((day) => DAY_NAMES[day]);
  const said = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
  return `One preference: the whole block, ${clockOf(line.from)}–${clockOf(line.to)}${days.length > 1 ? ` on ${said}` : ""}. What you choose here applies to all of it.`;
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


/** The Monday of the week a date falls in. */
const mondayOfIso = (date: string) => isoPlus(date, 1 - isoWeekday(date));

/**
 * One teacher's timetable preferences and constraints for a semester: the week painted,
 * limits, time away and needs. How much each preference matters is said where it is: a
 * painted block opens when the stroke that painted it ends, or when it is clicked, to make it
 * a Must or a Would like, comment on it, or take it away; each limit has its own. The Must
 * quota is kept as it is chosen, not after.
 *
 * The week is painted an hour, half an hour or a quarter at a time; whatever the cells, it is
 * kept to the quarter. A block reads as one: hovered or opened, all of it lights up.
 *
 * Time away is marked on the weeks it falls in: "Week by week" shows one teaching week at a
 * time, its dates on the days, and paints the hours away — a day's name, all of it. Each day
 * away may say why.
 *
 * The same parts wherever a teacher answers — here for a coordinator answering for them, and
 * on the page an invited teacher opens.
 */
export function WishesForm({
  collection,
  calendar,
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
  /** The semester's teaching weeks, to mark time away on; without them, weeks of the calendar. */
  calendar?: WishCalendar | null;
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
  const [startAway] = useState(() => awaySpots(initial?.away ?? [], collection));
  // Each quarter hour away, on its date; and why, date by date.
  const [awayAt, setAwayAt] = useState<Set<string>>(startAway.spots);
  const [awayWhy, setAwayWhy] = useState<Record<string, string>>(startAway.reasons);
  const [needs, setNeeds] = useState(initial?.needs ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [levels, setLevels] = useState<Record<string, WishLevel>>(initial?.levels ?? {});
  const [comments, setComments] = useState<Record<string, string>>(initial?.comments ?? {});
  const [reason, setReason] = useState(initial?.overCapReason ?? "");
  const [brush, setBrush] = useState<Brush>("cant");
  const [awayBrush, setAwayBrush] = useState<"away" | "erase">("away");
  const [fineness, setFineness] = useState<Fineness>(() => finenessOf(initial?.cells ?? []));
  // The week on screen, by its Monday: null for every week, the usual one.
  const [week, setWeek] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  // What is open over the grid — a painted block by its key, or a day away as `away:<date>` —
  // and where its pop-over sits.
  const [open, setOpen] = useState<{ key: string; left: number; top: number; cell: HTMLElement } | null>(null);
  // The cell the pointer rests on, for its bubble and its block lit up; and a stroke under way.
  const [resting, setResting] = useState<{ day: number; time: number; box: { left: number; top: number; width: number; height: number } } | null>(null);
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
  const dayQuarters = Array.from({ length: Math.round((collection.lastHour - collection.firstHour) / STEP) }, (_, index) => collection.firstHour + index * STEP);
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
  const away = useMemo(() => awayEntries(awayAt, awayWhy, collection), [awayAt, awayWhy, collection]);
  const levelOf = (key: string): WishLevel => levels[key] ?? "would";
  const musts = lines.filter((line) => levelOf(line.key) === "must").length;
  const full = musts >= collection.mustQuota;
  const cant = cantHours(asList);
  const overCap = cant > collection.cantCap;
  /** The preference a cell of the grid is part of: the block of its first painted quarter. */
  const lineAt = (day: number, time: number): WishLine | null => {
    for (const hour of quartersOf(time)) {
      const kind = cells.get(`${day}:${hour}`);
      if (kind) return lineOfCell(lines, day, hour, kind);
    }
    return null;
  };

  // ---------------------------------------------------------------- the weeks, for time away
  const weeks = useMemo(() => teachingWeeks(calendar), [calendar]);
  const holidays = new Map((calendar?.holidays ?? []).map((entry) => [entry.date, entry.label]));
  const dateOf = (day: number) => (week ? isoPlus(week, day - 1) : "");
  const awayOn = (date: string) => dayQuarters.some((hour) => awayAt.has(awaySpot(date, hour)));
  const awayWeeks = new Set([...awayAt].map((spot) => mondayOfIso(spot.split("|")[0])));
  const lastDay = Math.max(...collection.days);
  const weekName = (monday: string) => {
    const number = weeks.find((each) => each.monday === monday)?.number;
    const dates = `${formatDayAndMonth(monday)}–${formatDayAndMonth(isoPlus(monday, lastDay - 1))}`;
    return number ? `Week ${number} · ${dates}` : `Week of ${dates}`;
  };
  /** The week to start from: the first teaching week still to come, else Week 1, else this one. */
  const firstWeek = () => {
    const now = toIsoDate(mondayOf(new Date()));
    return weeks.find((each) => each.monday >= now)?.monday ?? weeks[0]?.monday ?? now;
  };
  const showWeek = (monday: string | null) => {
    setOpen(null);
    setWeek(monday);
  };
  const before_ = week ? (weeks.length ? [...weeks].reverse().find((each) => each.monday < week)?.monday : isoPlus(week, -7)) : undefined;
  const after_ = week ? (weeks.length ? weeks.find((each) => each.monday > week)?.monday : isoPlus(week, 7)) : undefined;
  const brushNow: Brush = week ? awayBrush : brush;

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
      away: awayEntries(startAway.spots, startAway.reasons, collection),
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

  /** Open what a cell of the grid holds — a painted block, or a day away — under the cell. */
  const openAt = ({ cell, day, time }: Spot) => {
    const box = gridBox.current;
    if (!box) return;
    let key: string;
    if (week) {
      const date = dateOf(day);
      if (!awayOn(date)) return;
      key = `away:${date}`;
      // A day marked after one away says the same, until it is told otherwise: a week of leave.
      if (!awayWhy[date]) {
        let earlier = isoPlus(date, -1);
        for (let guard = 0; guard < 6 && !collection.days.includes(isoWeekday(earlier)); guard += 1) earlier = isoPlus(earlier, -1);
        if (awayOn(earlier) && awayWhy[earlier]) setAwayWhy((current) => ({ ...current, [date]: awayWhy[earlier] }));
      }
    } else {
      const line = lineAt(day, time);
      if (!line) return;
      key = line.key;
    }
    const at = cell.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const width = 288;
    setOpen({ key, left: Math.max(0, Math.min(at.left - frame.left, frame.width - width)), top: at.bottom - frame.top + 4, cell });
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
  // Opened, the pop-over takes the keyboard: on the rank a preference has now, or on why a day is away.
  const openKey = open?.key;
  useEffect(() => {
    if (openKey) popover.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true], [data-first]")?.focus();
  }, [openKey]);

  /**
   * Paint every cell on the way from one cell to another, each cell all its quarters. A quick
   * drag reaches cells the pointer never stopped on — from 14:00 straight to 17:00 — and those
   * are painted too. A cell is [its place among the grid's days, its row]. On a single week,
   * the paint is time away, on that week's dates; a holiday takes none.
   */
  const paint = (from: [number, number], to: [number, number], with_: Brush) => {
    const reached: [number, number][] = [];
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    for (let step = 0; step <= steps; step += 1) {
      const share = steps ? step / steps : 0;
      reached.push([
        collection.days[Math.round(from[0] + (to[0] - from[0]) * share)],
        collection.firstHour + Math.round(from[1] + (to[1] - from[1]) * share) * fineness,
      ]);
    }
    if (week) {
      setAwayAt((current) => {
        const next = new Set(current);
        for (const [day, time] of reached) {
          const date = isoPlus(week, day - 1);
          if (holidays.has(date)) continue;
          for (const hour of quartersOf(time)) {
            if (with_ === "erase") next.delete(awaySpot(date, hour));
            else next.add(awaySpot(date, hour));
          }
        }
        return next;
      });
      return;
    }
    setCells((current) => {
      const next = new Map(current);
      for (const [day, time] of reached) {
        for (const hour of quartersOf(time)) {
          if (with_ === "erase") next.delete(`${day}:${hour}`);
          else if (with_ !== "away") next.set(`${day}:${hour}`, with_);
        }
      }
      return next;
    });
  };

  /** A whole day away, from its name over the grid — or, all of it away already, not away. */
  const wholeDay = (day: number, header: HTMLElement) => {
    const date = dateOf(day);
    const every = dayQuarters.every((hour) => awayAt.has(awaySpot(date, hour)));
    setAwayAt((current) => {
      const next = new Set(current);
      for (const hour of dayQuarters) {
        if (every) next.delete(awaySpot(date, hour));
        else next.add(awaySpot(date, hour));
      }
      return next;
    });
    if (every) setOpen(null);
    else setToOpen({ day, time: collection.firstHour, cell: header });
  };

  /** Not away after all: every quarter of a time away, on each of its days. */
  const removeAway = (entry: WishAway) => {
    setAwayAt((current) => {
      const next = new Set(current);
      for (let date = entry.from, guard = 0; date <= entry.to && guard < 400; date = isoPlus(date, 1), guard += 1) {
        for (const hour of dayQuarters) {
          if (hour >= (entry.start ?? 0) && hour < (entry.end ?? 24)) next.delete(awaySpot(date, hour));
        }
      }
      return next;
    });
  };

  /** Take a whole preference off the week: a can't-teach block on each of its days, or every preferred hour. */
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
      // The reason is asked for under the usual week: back to it.
      showWeek(null);
      setProblem(`Say why ${cant} hours can't be taught, over the ${collection.cantCap} a week, or mark fewer.`);
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
  const openDate = open?.key.startsWith("away:") ? open.key.slice(5) : "";
  // The block lit up: the one open, the one being painted, else the one the pointer rests on.
  const strokeAt = stroking ? stroke.current?.last : undefined;
  const litKey = week
    ? undefined
    : (open?.key ?? (strokeAt ? lineAt(strokeAt.day, strokeAt.time)?.key : resting ? lineAt(resting.day, resting.time)?.key : undefined));
  // On a single week, the day away open or rested on lights up.
  const litDate = week ? openDate || (resting ? dateOf(resting.day) : "") : "";
  const yours = voice === "you" ? "your" : "their";
  // What the bubble says, for the cell the pointer rests on: its painted block, or its time away.
  const restingLine = !week && resting ? lineAt(resting.day, resting.time) : null;
  const restingDate = week && resting ? dateOf(resting.day) : "";
  const restingAway = restingDate
    ? away.find(
        (entry) =>
          entry.from <= restingDate &&
          restingDate <= entry.to &&
          (entry.start ?? 0) < resting!.time + fineness &&
          resting!.time < (entry.end ?? 24),
      )
    : undefined;
  const bubbleTitle = restingAway ? `Away · ${awayWords(restingAway)}` : restingLine ? describeLine(restingLine) : undefined;
  const restingComment = restingLine ? comments[restingLine.key] : "";
  const bubble = restingAway ? (
    <>
      {restingAway.reason ? <span className="mb-1.5 block">&ldquo;{restingAway.reason}&rdquo;</span> : null}
      <TipDo>Click to say why, or remove</TipDo>
    </>
  ) : restingLine ? (
    <>
      <span className="mb-1.5 block">
        <b className="font-semibold text-[#344054]">{levelOf(restingLine.key) === "must" ? "Must" : "Would like"}</b>
        {restingComment ? <> · &ldquo;{restingComment}&rdquo;</> : null}
      </span>
      <TipDo>Click to set Must / Would like, comment or remove</TipDo>
      {restingLine.kind === "cant" && restingLine.days.length > 1 ? (
        <span className="block text-[#667085]">
          The whole block, on {restingLine.days.map((each) => DAY_SHORT[each]).join(" and ")}: one preference.
        </span>
      ) : null}
    </>
  ) : null;

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={heading}>1 · {voice === "you" ? "Your" : "Their"} week</p>
          <div role="radiogroup" aria-label="Which week" className="inline-flex rounded-md bg-[#f2f4f7] p-0.5 text-xs font-semibold">
            {[
              { value: false, label: "Every week" },
              { value: true, label: "Week by week" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={Boolean(week) === option.value}
                onClick={() => {
                  if (Boolean(week) !== option.value) showWeek(option.value ? firstWeek() : null);
                }}
                className={`rounded px-2.5 py-1 ${Boolean(week) === option.value ? "bg-white text-[#1f4e79] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <p className={hint}>
          {week ? (
            <>
              Mark when {voice === "you" ? "you're" : "they're"} away in a particular week — a conference, leave. Paint across the hours, or
              click a day&rsquo;s name for all of it. {voice === "you" ? "Your" : "Their"} usual week shows faintly behind.
            </>
          ) : (
            <>
              Choose a colour and paint across the hours; hours left white are fine. When you let go, the block opens to say how
              much it matters. Click a painted block to change it. Away on particular dates? Mark them <b>Week by week</b>.
            </>
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {week ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="The week before"
                disabled={!before_}
                onClick={() => before_ && showWeek(before_)}
                className="rounded p-1 text-[#344054] hover:bg-[#f2f4f7] disabled:text-[#d0d5dd] disabled:hover:bg-transparent"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              {weeks.length ? (
                <div className="w-56">
                  <SelectMenu
                    label="Week"
                    size="small"
                    value={week}
                    onChange={(value) => value && showWeek(value)}
                    options={[
                      ...(weeks.some((each) => each.monday === week) ? [] : [{ value: week, label: weekName(week) }]),
                      ...weeks.map((each) => ({
                        value: each.monday,
                        label: weekName(each.monday),
                        badge: awayWeeks.has(each.monday) ? "away" : undefined,
                      })),
                    ]}
                  />
                </div>
              ) : (
                <span className="px-1 text-xs font-semibold text-[#344054]">{weekName(week)}</span>
              )}
              <button
                type="button"
                aria-label="The week after"
                disabled={!after_}
                onClick={() => after_ && showWeek(after_)}
                className="rounded p-1 text-[#344054] hover:bg-[#f2f4f7] disabled:text-[#d0d5dd] disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          <div role="radiogroup" aria-label="Paint with" className="flex flex-wrap gap-1.5">
            {(week ? AWAY_BRUSHES : BRUSHES).map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={brushNow === option.value}
                onClick={() => (week ? setAwayBrush(option.value as "away" | "erase") : setBrush(option.value))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  brushNow === option.value ? option.on : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
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
          {week ? null : (
            <span className="ml-auto flex flex-wrap items-center gap-x-3 text-xs tabular-nums">
              <span className={full ? "font-semibold text-[#1f4e79]" : "text-[#667085]"}>
                {musts} of {collection.mustQuota} Musts used
              </span>
              <span className={overCap ? "font-semibold text-[#a6292f]" : "text-[#667085]"}>
                Can&rsquo;t teach: {cant} of {collection.cantCap} h a week
              </span>
            </span>
          )}
        </div>
        <div ref={gridBox} className="relative mt-3">
          <div className="overflow-x-auto pt-1.5">
            <table
              className="w-full table-fixed border-collapse select-none text-[11px]"
              aria-label={week ? `${weekName(week)}: time away` : "The week"}
            >
              <thead>
                <tr>
                  <th className="w-12" />
                  {collection.days.map((day) => {
                    if (!week) {
                      return (
                        <th key={day} className="pb-1 font-semibold text-[#344054]">
                          {DAY_SHORT[day]}
                        </th>
                      );
                    }
                    const date = dateOf(day);
                    const holiday = holidays.get(date);
                    const allDay = dayQuarters.every((hour) => awayAt.has(awaySpot(date, hour)));
                    return (
                      <th key={day} className="pb-1 align-bottom font-semibold text-[#344054]">
                        {holiday !== undefined ? (
                          <span className="block leading-tight">
                            {DAY_SHORT[day]} <span className="font-normal text-[#667085]">{formatDayAndMonth(date)}</span>
                            <span className="block text-[10px] font-normal text-[#98a2b3]">{holiday || "Holiday"}</span>
                          </span>
                        ) : (
                          <Tip
                            side="top"
                            wide={false}
                            content={allDay ? "Click: not away this day after all." : `Click: away all ${DAY_NAMES[day]}.`}
                          >
                            <button
                              type="button"
                              aria-label={`${DAY_NAMES[day]} ${formatDayAndMonth(date)}: ${allDay ? "away all day" : "mark away all day"}`}
                              aria-pressed={allDay}
                              onClick={(event) => wholeDay(day, event.currentTarget)}
                              className={`rounded px-1.5 py-0.5 hover:bg-[#f5f1fa] hover:text-[#6b4fa0] ${allDay ? "bg-[#f5f1fa] text-[#6b4fa0]" : ""}`}
                            >
                              {DAY_SHORT[day]} <span className="font-normal">{formatDayAndMonth(date)}</span>
                            </button>
                          </Tip>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((time, row) => (
                  <tr key={time}>
                    <th className="pr-1.5 text-right align-top font-normal tabular-nums leading-none">
                      <RowTime time={time} size={fineness} />
                    </th>
                    {collection.days.map((day, column) => {
                      const here: [number, number] = [column, row];
                      const date = dateOf(day);
                      const holiday = week ? holidays.has(date) : false;
                      const quarters = quartersOf(time).map((hour) => {
                        const kind = cells.get(`${day}:${hour}`);
                        const line = kind ? lineOfCell(lines, day, hour, kind) : null;
                        const isAway = week ? awayAt.has(awaySpot(date, hour)) : false;
                        return { hour, kind, line, isAway, level: line ? levelOf(line.key) : ("would" as WishLevel) };
                      });
                      const painted = quarters.filter((quarter) => quarter.kind);
                      const line = painted[0]?.line ?? null;
                      const awayHere = quarters.some((quarter) => quarter.isAway);
                      const same = painted.length === quarters.length && painted.every((quarter) => quarter.kind === painted[0].kind);
                      const said = week
                        ? holiday
                          ? "holiday"
                          : awayHere
                            ? "away"
                            : "not away"
                        : !painted.length
                          ? "fine"
                          : !same
                            ? "partly painted"
                            : `${painted[0].kind === "cant" ? "can't teach" : "would rather"}, ${painted[0].level === "must" ? "a Must" : "a Would like"}`;
                      // What the cell holds, to open: a painted block, or on a single week, a day away.
                      const holds = week ? awayHere : Boolean(line);
                      const button = (
                        <button
                          type="button"
                          disabled={holiday}
                          aria-label={`${DAY_NAMES[day]}${week ? ` ${formatDayAndMonth(date)}` : ""} ${clockOf(time)}: ${said}`}
                          aria-haspopup={holds ? "dialog" : undefined}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            const last = { day, time, cell: event.currentTarget };
                            setStroking(true);
                            setResting(null);
                            if (holds && brushNow !== "erase") {
                              // Let go here and it opens; drag on and it paints from here.
                              stroke.current = { with_: brushNow, at: here, last, waiting: true };
                              return;
                            }
                            stroke.current = { with_: brushNow, at: here, last, waiting: false };
                            paint(here, here, brushNow);
                          }}
                          onPointerEnter={(event) => {
                            const held = stroke.current;
                            if (!held) {
                              // Where the cell sits in the grid, for the one bubble to open beside it.
                              const at = event.currentTarget.getBoundingClientRect();
                              const frame = gridBox.current?.getBoundingClientRect();
                              setResting({
                                day,
                                time,
                                box: { left: at.left - (frame?.left ?? 0), top: at.top - (frame?.top ?? 0), width: at.width, height: at.height },
                              });
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
                            if (holds) openAt({ day, time, cell: event.currentTarget });
                            else paint(here, here, brushNow);
                          }}
                          className="flex w-full flex-col overflow-hidden bg-white disabled:cursor-default"
                          style={
                            holiday
                              ? { height: rowHeight, backgroundColor: "#f2f4f7", backgroundImage: stripes("rgba(152, 162, 179, 0.25)") }
                              : { height: rowHeight }
                          }
                        >
                          {quarters.map((quarter) => {
                            const tone = quarter.isAway
                              ? AWAY_TONE
                              : quarter.kind
                                ? week
                                  ? { ...CELL_TONES[quarter.kind][quarter.level], opacity: 0.3 }
                                  : CELL_TONES[quarter.kind][quarter.level]
                                : undefined;
                            const lit = week ? quarter.isAway && date === litDate : Boolean(quarter.line) && quarter.line?.key === litKey;
                            return (
                              <span
                                key={quarter.hour}
                                data-quarter={quarter.hour}
                                className={`block min-h-0 w-full flex-1 ${tone || holiday || quarter.hour !== time ? "" : ruleOf(quarter.hour)} ${lit ? "brightness-[0.85]" : ""}`}
                                style={tone}
                              />
                            );
                          })}
                        </button>
                      );
                      return (
                        <td key={day} className={`border-x border-[#c8d0db] p-0 ${row === rows.length - 1 ? "border-b" : ""}`}>
                          {button}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
           * One bubble for the whole grid, beside the cell the pointer rests on: a bubble on
           * every cell made a week of quarter hours slow to draw, and only one is ever open.
           */}
          {resting ? (
            <Tip open={Boolean(restingLine || restingAway) && !stroking && !open} side="right" wide={false} title={bubbleTitle} content={bubble}>
              <span aria-hidden="true" className="pointer-events-none absolute" style={resting.box} />
            </Tip>
          ) : null}
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
                      // Not to reach the cell the focus goes back to, and press it.
                      event.preventDefault();
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
          {open && openDate ? (
            <div
              ref={popover}
              role="dialog"
              aria-label={`Away ${DAY_NAMES[isoWeekday(openDate)]} ${formatDayAndMonth(openDate)}`}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                setOpen(null);
                open.cell.focus();
              }}
              className="absolute z-20 grid w-72 gap-2.5 rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg"
              style={{ left: open.left, top: open.top }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="grid gap-0.5">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-[#171717]">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={AWAY_TONE} /> Away · {DAY_NAMES[isoWeekday(openDate)]}{" "}
                    {formatDayAndMonth(openDate)}
                  </p>
                  <p className="text-xs text-[#667085]">
                    {away
                      .filter((entry) => entry.from <= openDate && openDate <= entry.to)
                      .map((entry) => (entry.start === undefined || entry.end === undefined ? "All day" : `${clockOf(entry.start)}–${clockOf(entry.end)}`))
                      .join(", ")}
                  </p>
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
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-[#344054]">Why (optional)</span>
                <input
                  data-first
                  value={awayWhy[openDate] ?? ""}
                  maxLength={160}
                  onChange={(event) => setAwayWhy((current) => ({ ...current, [openDate]: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      // Not to reach the cell the focus goes back to, and press it.
                      event.preventDefault();
                      setOpen(null);
                      open.cell.focus();
                    }
                  }}
                  placeholder="Conference, leave…"
                  className={field}
                />
              </label>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    removeAway({ from: openDate, to: openDate, reason: "" });
                    setAwayWhy((current) => {
                      const next = { ...current };
                      delete next[openDate];
                      return next;
                    });
                    setOpen(null);
                  }}
                  className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                >
                  <Trash2 size={13} aria-hidden="true" /> Not away this day
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
          {week ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#667085]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={AWAY_TONE} />
                <b className="font-semibold text-[#344054]">Away</b> this week
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={{ ...CELL_TONES.cant.must, opacity: 0.3 }} />
                <span className="inline-block h-3 w-3 rounded-sm" style={{ ...CELL_TONES.prefer.must, opacity: 0.3 }} />
                Faint: {yours} usual week
              </span>
            </p>
          ) : (
            <WishesLegend />
          )}
        </div>
        {away.length ? (
          <div className="mt-3 rounded-md bg-[#faf8fd] px-3 py-2" aria-label="Time away">
            <p className="text-xs font-semibold text-[#6b4fa0]">Time away</p>
            <ul className="mt-1 grid gap-0.5">
              {away.map((entry) => (
                <li key={`${entry.from}-${entry.to}-${entry.start ?? ""}`} className="flex items-center gap-2 text-xs text-[#344054]">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={AWAY_TONE} />
                  <button
                    type="button"
                    onClick={() => showWeek(mondayOfIso(entry.from))}
                    className="text-left hover:text-[#6b4fa0] hover:underline"
                  >
                    {awayWords(entry)}
                  </button>
                  {entry.reason ? <span className="min-w-0 truncate text-[#667085]">· {entry.reason}</span> : null}
                  <button
                    type="button"
                    aria-label={`Not away ${awayWords(entry)}`}
                    onClick={() => removeAway(entry)}
                    className="ml-auto rounded p-0.5 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {!week && lines.some((line) => (line.kind === "cant" || line.kind === "prefer") && comments[line.key]) ? (
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
        {overCap && !week ? (
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
        <p className={heading}>2 · Limits on {yours} week</p>
        <p className={hint}>Only those that matter. Each one set is a preference of its own: a Must or a Would like.</p>
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

      {/* -------------------------------------------------------------- needs */}
      <div className={section}>
        <p className={heading}>3 · Needs</p>
        <label className="mt-2 block">
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
