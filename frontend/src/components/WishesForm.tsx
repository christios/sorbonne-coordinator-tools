import {
  ArrowLeft,
  ArrowRight,
  CalendarX2,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  MessageSquare,
  MoveDown,
  Paintbrush,
  Pointer,
  Repeat,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { FormTour, rememberTourTaken, tourTaken, type TourStep } from "@/components/FormTour";
import { Tip, TipDo } from "@/components/InfoTip";
import { SelectMenu } from "@/components/SelectMenu";
import {
  DAY_NAMES,
  DAY_SHORT,
  STEP,
  clockOf,
  datesOf,
  describeBlock,
  isoPlus,
  recurringConstraintHours,
  teachingWeeks,
  weekOf,
  type WishBlock,
  type WishCalendar,
  type WishCollection,
  type WishKind,
  type WishLimits,
  type WishRepeat,
  type Wishes,
  type WishesInput,
} from "@/services/teacherWishes";
import { formatDayAndMonth, mondayOf, toIsoDate } from "@/services/weekSchedule";

/** Who the form speaks to: a coordinator about a teacher, or the teacher themself. */
export type Voice = "they" | "you";

/*
 * Two kinds of block, two colours: red for a constraint (can't teach then), green for a
 * preference (would like to teach then). A block of one week only is striped over its colour,
 * to tell it at a glance from the usual week.
 */
const stripes = (line: string) => `repeating-linear-gradient(135deg, ${line} 0 1.5px, transparent 1.5px 6px)`;
export const KIND_TONE: Record<WishKind, CSSProperties> = {
  constraint: { backgroundColor: "#d9646a" },
  preference: { backgroundColor: "#4f9f74" },
};
export function toneOf(block: Pick<WishBlock, "kind" | "repeat">): CSSProperties {
  const tone = KIND_TONE[block.kind];
  return block.repeat === "once" ? { ...tone, backgroundImage: stripes("rgba(255, 255, 255, 0.6)") } : tone;
}
/** A stroke under way, before it is let go: the brush's colour, see-through. */
const PREVIEW: Record<WishKind, CSSProperties> = {
  constraint: { backgroundColor: "rgba(217, 100, 106, 0.5)" },
  preference: { backgroundColor: "rgba(79, 159, 116, 0.5)" },
};

const KINDS: { value: WishKind; label: string; on: string; solid: string }[] = [
  { value: "constraint", label: "Constraint", on: "border-[#a6292f] bg-[#fdf3f3] text-[#a6292f]", solid: "bg-[#a6292f] text-white" },
  { value: "preference", label: "Preference", on: "border-[#2e7d55] bg-[#f2f9f4] text-[#2e7d55]", solid: "bg-[#2e7d55] text-white" },
];

/** What each kind means, in the form's voice. */
const meaning = (kind: WishKind, voice: Voice) =>
  kind === "constraint" ? `${voice === "you" ? "you" : "they"} can't teach then` : `${voice === "you" ? "you'd" : "they'd"} like to teach then`;

/** How finely the week is painted: an hour, half an hour or a quarter a cell, and how tall each row is. */
export type Fineness = 1 | 0.5 | 0.25;
const FINENESS: { value: Fineness; label: string; row: number }[] = [
  { value: 1, label: "1 h", row: 24 },
  { value: 0.5, label: "30 min", row: 16 },
  { value: 0.25, label: "15 min", row: 12 },
];

/** The coarsest cells that say every block exactly: an hour, unless one starts or ends on the half or a quarter. */
export function finenessOf(blocks: Pick<WishBlock, "from" | "to">[]): Fineness {
  const on = (value: number, size: number) => Math.abs(value / size - Math.round(value / size)) < 1e-9;
  const fits = (size: number) => blocks.every((block) => on(block.from, size) && on(block.to, size));
  return fits(1) ? 1 : fits(0.5) ? 0.5 : 0.25;
}

/** A kind as its button looks, inside a sentence: the tour names them so they are found at a glance. */
function KindLook({ kind }: { kind: WishKind }) {
  const option = KINDS.find((each) => each.value === kind)!;
  return (
    <span className={`mx-0.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px align-middle text-[11px] font-semibold ${option.on}`}>
      <span className="inline-block h-2 w-2 rounded-sm" style={KIND_TONE[kind]} /> {option.label}
    </span>
  );
}

/** "Constraint" or "Preference", as a small tag in its colour. */
export function KindTag({ kind }: { kind: WishKind }) {
  return kind === "constraint" ? (
    <span className="shrink-0 rounded bg-[#fdf3f3] px-1.5 text-[11px] font-semibold text-[#a6292f]">Constraint</span>
  ) : (
    <span className="shrink-0 rounded bg-[#e7f4ec] px-1.5 text-[11px] font-semibold text-[#2e7d55]">Preference</span>
  );
}

/** Constraint or Preference, side by side, for a block or a limit. */
export function KindToggle({ name, kind, onChange }: { name: string; kind: WishKind; onChange: (kind: WishKind) => void }) {
  return (
    <div role="radiogroup" aria-label={name} className="inline-flex shrink-0 rounded-md border border-[#d0d5dd] p-0.5 text-xs font-semibold">
      {KINDS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={kind === option.value}
          onClick={() => onChange(option.value)}
          className={`flex-1 rounded px-2 py-0.5 text-center ${kind === option.value ? option.solid : "text-[#344054] hover:bg-[#f8fafc]"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** How a part of the form is used, in three short steps side by side: an icon, what to do, a hint. */
function HowTo({ steps, children }: { steps: { icon: LucideIcon; title: ReactNode; hint: ReactNode }[]; children?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-2">
      <ol className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, hint }, index) => (
          <li key={index} className="flex items-start gap-2.5 rounded-lg border border-[#e3e8ef] bg-white px-3 py-2">
            <span className="relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef4fa] text-[#1f4e79]">
              <Icon size={14} aria-hidden="true" />
              <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#1f4e79] text-[9px] font-semibold text-white">
                {index + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[#171717]">{title}</span>
              <span className="block text-[11px] leading-4 text-[#667085]">{hint}</span>
            </span>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
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
export function WishesLegend({ voice = "they" }: { voice?: Voice }) {
  const swatch = (style: CSSProperties) => <span className="inline-block h-3 w-3 rounded-sm" style={style} />;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#667085]">
      <span className="inline-flex items-center gap-1.5">
        {swatch(KIND_TONE.constraint)}
        <span>
          <b className="font-semibold text-[#344054]">Constraint</b>: {meaning("constraint", voice)}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {swatch(KIND_TONE.preference)}
        <span>
          <b className="font-semibold text-[#344054]">Preference</b>: {meaning("preference", voice)}
        </span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        {swatch(toneOf({ kind: "constraint", repeat: "once" }))}
        {swatch(toneOf({ kind: "preference", repeat: "once" }))}
        <span>
          <b className="font-semibold text-[#344054]">Striped</b>: that week only
        </span>
      </span>
    </p>
  );
}

/** "Every week", "From 18 Jan", "One week only": how a block repeats, as a list says it. */
function repeatTag(block: Pick<WishBlock, "repeat" | "week">): string {
  if (block.repeat === "all") return "Every week";
  if (block.repeat === "from") return `Every week from ${formatDayAndMonth(block.week)}`;
  return "One week only";
}

/** "Tue, Thu 14:00–16:00", "Fri 22 Jan, all day": when a block is, without its kind or how it repeats. */
export function whenWords(block: WishBlock, grid: { firstHour: number; lastHour: number }): string {
  const hours = block.from <= grid.firstHour && block.to >= grid.lastHour ? "all day" : `${clockOf(block.from)}–${clockOf(block.to)}`;
  if (block.repeat === "once") return `${datesOf(block)}, ${hours}`;
  return `${block.days.map((day) => DAY_SHORT[day]).join(", ")} ${hours}`;
}

const REPEAT_RANK: Record<WishRepeat, number> = { all: 0, from: 1, once: 2 };
/** Blocks as a list reads them: every week first, then from a week on, then single weeks; by day and hour. */
export function inListOrder(blocks: WishBlock[]): WishBlock[] {
  return [...blocks].sort(
    (left, right) =>
      REPEAT_RANK[left.repeat] - REPEAT_RANK[right.repeat] ||
      left.week.localeCompare(right.week) ||
      Math.min(...left.days) - Math.min(...right.days) ||
      left.from - right.from,
  );
}

/**
 * Everything marked on the calendar, said in words: the constraints, then the preferences,
 * each with when it is, how it repeats and why. Clicked, a block is shown on its week; × takes
 * it off.
 */
export function BlockList({
  blocks,
  grid,
  voice = "they",
  onPick,
  onRemove,
  removeOff,
  onHover,
  flagMissing = false,
}: {
  blocks: WishBlock[];
  grid: { firstHour: number; lastHour: number };
  voice?: Voice;
  onPick?: (block: WishBlock) => void;
  onRemove?: (block: WishBlock) => void;
  /** Why × is off for now, if it is. */
  removeOff?: string;
  onHover?: (id: string | null) => void;
  /** A constraint without its reason says so: it cannot be submitted that way. */
  flagMissing?: boolean;
}) {
  if (!blocks.length) return <p className="text-sm text-[#98a2b3]">Nothing marked: every hour is fine.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {(["constraint", "preference"] as const).map((kind) => {
        const these = inListOrder(blocks.filter((block) => block.kind === kind));
        return (
          <div key={kind} className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-[#344054]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={KIND_TONE[kind]} />
              {kind === "constraint" ? "Constraints" : "Preferences"}
              <span className="font-normal text-[#98a2b3]">
                · {meaning(kind, voice).replace(" then", "")} · {these.length}
              </span>
            </p>
            {these.length ? (
              <ul className="mt-1.5 grid gap-1">
                {these.map((block) => (
                  <li
                    key={block.id}
                    className="flex items-start gap-2 rounded-md border border-[#e3e8ef] bg-white px-2.5 py-1.5 text-xs"
                    onMouseEnter={() => onHover?.(block.id)}
                    onMouseLeave={() => onHover?.(null)}
                  >
                    <span className="mt-0.5 inline-block h-3 w-3 shrink-0 rounded-sm" style={toneOf(block)} />
                    <span className="min-w-0 flex-1">
                      {onPick ? (
                        <button
                          type="button"
                          onClick={() => onPick(block)}
                          aria-label={`Show ${describeBlock(block, grid)}`}
                          className="text-left font-semibold text-[#344054] hover:text-[#1f4e79] hover:underline"
                        >
                          {whenWords(block, grid)}
                        </button>
                      ) : (
                        <span className="font-semibold text-[#344054]">{whenWords(block, grid)}</span>
                      )}
                      <span className="ml-1.5 whitespace-nowrap rounded bg-[#f2f4f7] px-1.5 text-[10px] font-semibold text-[#667085]">
                        {repeatTag(block)}
                      </span>
                      {block.comment ? (
                        <span className="mt-0.5 block text-[#667085]">&ldquo;{block.comment}&rdquo;</span>
                      ) : flagMissing && block.kind === "constraint" ? (
                        <span className="mt-0.5 block font-semibold text-[#a6292f]">Reason needed: click to say why</span>
                      ) : null}
                    </span>
                    {onRemove ? (
                      <button
                        type="button"
                        aria-label={`Remove ${describeBlock(block, grid)}`}
                        disabled={Boolean(removeOff)}
                        title={removeOff || undefined}
                        onClick={() => onRemove(block)}
                        className="rounded p-0.5 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f] disabled:text-[#d0d5dd] disabled:hover:bg-transparent"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-xs text-[#98a2b3]">None.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Each page of the form on a canvas of its own: the week, the limits, the needs. */
const section = "rounded-xl border border-[#d5dde8] bg-[#edf1f6] p-4 sm:p-5";
const hint = "mt-1 text-xs text-[#667085]";
const field = "w-full rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-sm";
const COMMENT_LENGTH = 300;
const NONE = "";
const LIMIT_NAMES: (keyof WishLimits)[] = ["maxDays", "maxHoursDay", "maxInRow", "freeDay"];

/** What the form holds, said the same way whatever order it was entered in: to tell a change. */
function snapshot(parts: {
  blocks: WishBlock[];
  limits: WishLimits;
  limitKinds: Wishes["limitKinds"];
  comments: Record<string, string>;
  needs: string;
  note: string;
  reason: string;
}): string {
  return JSON.stringify({
    blocks: [...parts.blocks]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((block) => [block.id, block.kind, block.days.join(","), block.from, block.to, block.repeat, block.week, block.comment.trim()]),
    limits: LIMIT_NAMES.filter((name) => parts.limits[name]).map(
      (name) => `${name}=${parts.limits[name]}:${parts.limitKinds[name] ?? "preference"}:${(parts.comments[name] ?? "").trim()}`,
    ),
    needs: parts.needs.trim(),
    note: parts.note.trim(),
    reason: parts.reason.trim(),
  });
}

/** A new block's name: unique in the answer, and never one used before in it. */
let made = 0;
const newId = () => `b${Date.now().toString(36)}${(made += 1).toString(36)}`;

/** The guided tour's steps, in order (their words are in the form, which they act on). */
const TOUR = ["intro", "paint", "open", "repeat", "weeks", "day", "week", "summary", "next", "limits", "save", "again"] as const;

/** A cell of the grid: a day, where its stretch of the day starts, and the cell on the page. */
type Spot = { day: number; time: number; cell: HTMLElement };

/**
 * One teacher's timetable preferences and constraints for a semester, on three pages: the
 * calendar, limits on the week, needs and a note.
 *
 * The calendar shows one teaching week at a time, with its dates. A stroke across it — down
 * the hours, across the days — makes a block, a constraint (can't teach then) or a preference
 * (would like to teach then). A new block repeats every week; its box, which opens as it is
 * made or when it is clicked, makes it repeat from that week on, or only that week, says why,
 * or takes it off. A day's name makes the whole day a constraint for that week. Under the
 * calendar, every block is listed in words.
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
  tourButtonIn,
}: {
  collection: WishCollection;
  /** The semester's teaching weeks, shown one at a time; without them, weeks of the calendar. */
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
  /** Where the Guided tour button goes: top right of whatever holds the form, outside it. Above the form if not given. */
  tourButtonIn?: HTMLElement | null;
}) {
  const [blocks, setBlocks] = useState<WishBlock[]>(initial?.blocks ?? []);
  const [limits, setLimits] = useState<WishLimits>(initial?.limits ?? {});
  const [limitKinds, setLimitKinds] = useState<Wishes["limitKinds"]>(initial?.limitKinds ?? {});
  const [comments, setComments] = useState<Record<string, string>>(initial?.comments ?? {});
  const [needs, setNeeds] = useState(initial?.needs ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [reason, setReason] = useState(initial?.overCapReason ?? "");
  // A new block starts as a constraint; its box makes it a preference.
  const brush: WishKind = "constraint";
  const [fineness, setFineness] = useState<Fineness>(() => finenessOf(initial?.blocks ?? []));
  // The page on screen: the calendar, the limits, the needs.
  const [page, setPage] = useState(0);
  const weeks = useMemo(() => teachingWeeks(calendar), [calendar]);
  /** The week to start from: the first teaching week still to come, else Week 1, else this one. */
  const firstWeek = () => {
    const now = toIsoDate(mondayOf(new Date()));
    return weeks.find((each) => each.monday >= now)?.monday ?? weeks[0]?.monday ?? now;
  };
  // The week on screen, by its Monday.
  const [week, setWeek] = useState<string>(firstWeek);
  const [problem, setProblem] = useState("");
  // A constraint's reason asked for: in its box (Done pressed without one), and on the limits and
  // the list once Submit has found one missing. The next box to open asks at once, if set.
  const [askWhy, setAskWhy] = useState(false);
  const [missingWhy, setMissingWhy] = useState(false);
  const whyNext = useRef(false);
  // The block open over the grid, by its name, and where its pop-over sits.
  const [open, setOpen] = useState<{ id: string; left: number; top: number; cell: HTMLElement } | null>(null);
  // The cell the pointer rests on, for its bubble and its block lit up; a block hovered in the list.
  const [resting, setResting] = useState<{ day: number; time: number; box: { left: number; top: number; width: number; height: number } } | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // A stroke under way, as the rectangle it covers: [a day's place among the grid's days, a row].
  const [drag, setDrag] = useState<{ from: [number, number]; to: [number, number] } | null>(null);
  // A block to open once it is on the page: made a moment ago, or picked from the list.
  const [toOpen, setToOpen] = useState<{ id: string; cell?: HTMLElement } | null>(null);
  const gridBox = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  /*
   * The stroke under way: where it started and reached, the block it started on, and whether it
   * moved. Let go where it was pressed on a block, it opens that block; else it makes one.
   */
  const stroke = useRef<{ from: [number, number]; to: [number, number]; on: WishBlock | null; moved: boolean; kind: WishKind; last: Spot } | null>(null);

  // ---------------------------------------------------------------- the guided tour's state
  const [tourAt, setTourAt] = useState<number | null>(null);
  // Taken once, to its end, before the form is used in a browser; then again whenever wanted.
  const [tourRequired, setTourRequired] = useState(() => !tourTaken());
  // Where each step started from — the week shown, whether its box was seen open — to tell when its "Try it" is done.
  const [tourBase, setTourBase] = useState({ week: "", sawOpen: false });
  // The one block made during the tour: after it, the tour makes no more.
  const [tourMade, setTourMade] = useState("");
  // And the one whole day marked on the step about a day away: the only other the tour allows.
  const [tourDay, setTourDay] = useState("");
  // And the one whole week, on the step about a week away.
  const [tourWeek, setTourWeek] = useState("");
  // Counted up when the form ignores something done during the tour: the card shakes and says what to do.
  const [tourNudge, setTourNudge] = useState(0);
  // The block clicked while the tour teaches clicking, opened once the tour has said so.
  const [tourClicked, setTourClicked] = useState<{ id: string; cell: HTMLElement } | null>(null);
  const [popFromTour, setPopFromTour] = useState(false);
  const tourStepId = tourAt === null ? "" : TOUR[tourAt];
  // Where the tour shows a stroke being painted, or where to click, over the grid.
  const [demo, setDemo] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  const rows = Array.from({ length: Math.round((collection.lastHour - collection.firstHour) / fineness) }, (_, index) => collection.firstHour + index * fineness);
  const quartersOf = (time: number) => Array.from({ length: Math.round(fineness / STEP) }, (_, index) => time + index * STEP);
  const rowOf = (hour: number) => collection.firstHour + Math.floor((hour - collection.firstHour) / fineness) * fineness;
  const rowHeight = FINENESS.find((option) => option.value === fineness)?.row ?? 24;
  const grid = { firstHour: collection.firstHour, lastHour: collection.lastHour };
  const held = useMemo(() => weekOf(blocks, week), [blocks, week]);
  /** The block a cell of the grid shows: the one on top at its first marked quarter. */
  const blockAt = (day: number, time: number): WishBlock | null => {
    for (const hour of quartersOf(time)) {
      const block = held.get(`${day}:${hour}`);
      if (block) return block;
    }
    return null;
  };
  const cant = recurringConstraintHours(blocks);
  const overCap = cant > collection.cantCap;
  const yours = voice === "you" ? "your" : "their";
  const Yours = voice === "you" ? "Your" : "Their";

  // ---------------------------------------------------------------- the weeks
  const holidays = new Map((calendar?.holidays ?? []).map((entry) => [entry.date, entry.label]));
  const dateOf = (day: number) => isoPlus(week, day - 1);
  const lastDay = Math.max(...collection.days);
  const weekName = (monday: string) => {
    const number = weeks.find((each) => each.monday === monday)?.number;
    const dates = `${formatDayAndMonth(monday)}–${formatDayAndMonth(isoPlus(monday, lastDay - 1))}`;
    return number ? `Week ${number} · ${dates}` : `Week of ${dates}`;
  };
  const weekShort = (monday: string) => {
    const number = weeks.find((each) => each.monday === monday)?.number;
    return number ? `Week ${number} (${formatDayAndMonth(monday)})` : formatDayAndMonth(monday);
  };
  const ownWeeks = new Map<string, number>();
  for (const block of blocks) if (block.repeat !== "all") ownWeeks.set(block.week, (ownWeeks.get(block.week) ?? 0) + 1);
  const showWeek = (monday: string) => {
    setOpen(null);
    setWeek(monday);
  };
  const before_ = weeks.length ? [...weeks].reverse().find((each) => each.monday < week)?.monday : isoPlus(week, -7);
  const after_ = weeks.length ? weeks.find((each) => each.monday > week)?.monday : isoPlus(week, 7);

  // ---------------------------------------------------------------- changed or not
  const [opened] = useState(() =>
    snapshot({
      blocks: initial?.blocks ?? [],
      limits: initial?.limits ?? {},
      limitKinds: initial?.limitKinds ?? {},
      comments: initial?.comments ?? {},
      needs: initial?.needs ?? "",
      note: initial?.note ?? "",
      reason: initial?.overCapReason ?? "",
    }),
  );
  const current = snapshot({ blocks, limits, limitKinds, comments, needs, note, reason });
  const dirty = current !== opened;
  const told = useRef(onDirtyChange);
  useEffect(() => {
    told.current = onDirtyChange;
  });
  useEffect(() => {
    told.current?.(dirty);
  }, [dirty]);

  // ---------------------------------------------------------------- blocks
  const canMake = tourAt === null || !tourMade;
  // While the tour is on, a block made does not open by itself — opening it is a step — but for a
  // day away, whose box is where its reason goes.
  const quiet = tourAt !== null && tourStepId !== "day" && tourStepId !== "week";
  /** Something done during the tour that the tour does not take: the card is nudged to say what is. */
  const nudgeTour = () => {
    if (tourAt !== null) setTourNudge((count) => count + 1);
  };
  const change = (id: string, patch: Partial<WishBlock>) => setBlocks((current) => current.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  const remove = (id: string) => {
    setBlocks((current) => current.filter((block) => block.id !== id));
    setOpen((now) => (now?.id === id ? null : now));
  };
  const make = (block: Omit<WishBlock, "id" | "comment">, at?: HTMLElement) => {
    // The tour's steps about a day and a week away may mark one each, past the tour's one block.
    const aDay = tourStepId === "day" && !tourDay;
    const aWeek = tourStepId === "week" && !tourWeek;
    if (!canMake && !aDay && !aWeek) {
      nudgeTour();
      return;
    }
    const id = newId();
    setBlocks((current) => [...current, { ...block, id, comment: "" }]);
    if (aDay) setTourDay(id);
    else if (aWeek) setTourWeek(id);
    else if (tourAt !== null) setTourMade(id);
    if (!quiet) setToOpen({ id, cell: at });
  };

  /** Open a block's box under a cell of it. */
  const openAt = (id: string, cell: HTMLElement) => {
    const box = gridBox.current;
    if (!box) return;
    const at = cell.getBoundingClientRect();
    const frame = box.getBoundingClientRect();
    const width = 300;
    setOpen({ id, left: Math.max(0, Math.min(at.left - frame.left, frame.width - width)), top: at.bottom - frame.top + 4, cell });
  };
  // Opened only once it is on the page, in the week shown: under the cell it was made or clicked
  // on, else under its first cell.
  useEffect(() => {
    if (!toOpen) return;
    setToOpen(null);
    const block = blocks.find((each) => each.id === toOpen.id);
    if (!block) return;
    const cell =
      toOpen.cell?.isConnected
        ? toOpen.cell
        : gridBox.current?.querySelector<HTMLElement>(`[data-cell="${block.days[0]}:${rowOf(Math.max(block.from, collection.firstHour))}"]`);
    if (cell) openAt(block.id, cell);
    // Once, for the block asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toOpen]);

  /** The block on the list, shown: its week, and its box open. */
  const pick = (block: WishBlock) => {
    if (block.repeat !== "all" && !(block.repeat === "from" && week >= block.week)) setWeek(block.week);
    setOpen(null);
    setToOpen({ id: block.id });
  };

  /** The block making a day of this week a constraint all day, if there is one. */
  const wholeDayOf = (day: number) =>
    blocks.find(
      (block) =>
        block.repeat === "once" &&
        block.week === week &&
        block.kind === "constraint" &&
        block.days.length === 1 &&
        block.days[0] === day &&
        block.from <= collection.firstHour &&
        block.to >= collection.lastHour,
    );
  /** A whole day a constraint, this week only, from its Whole day button; or that day's own block, if it has one. */
  const wholeDay = (day: number, header: HTMLElement) => {
    const there = wholeDayOf(day);
    if (there) {
      if (tourStepId === "paint") nudgeTour();
      else openAt(there.id, header);
      return;
    }
    make({ kind: "constraint", days: [day], from: collection.firstHour, to: collection.lastHour, repeat: "once", week }, header);
  };

  /** The block making every day of this week a constraint all day, if there is one. */
  const wholeWeekOf = () =>
    blocks.find(
      (block) =>
        block.repeat === "once" &&
        block.week === week &&
        block.kind === "constraint" &&
        collection.days.every((day) => block.days.includes(day)) &&
        block.from <= collection.firstHour &&
        block.to >= collection.lastHour,
    );
  /** The whole week a constraint, this week only, from its Whole week button; its box opens over the first day. */
  const wholeWeek = () => {
    const under = gridBox.current?.querySelector<HTMLElement>("thead [data-day-name]") ?? undefined;
    const there = wholeWeekOf();
    if (there) {
      if (tourStepId === "paint") nudgeTour();
      else if (under) openAt(there.id, under);
      return;
    }
    make({ kind: "constraint", days: [...collection.days], from: collection.firstHour, to: collection.lastHour, repeat: "once", week }, under);
  };

  // Let go: a press on a block that did not move opens it; any other stroke makes a block.
  const letGo = useRef<() => void>(() => {});
  letGo.current = () => {
    const was = stroke.current;
    stroke.current = null;
    setDrag(null);
    if (!was) return;
    if (was.on && !was.moved) {
      // On the tour's painting step, a click on a block is nothing at all: opening it comes next.
      if (tourStepId === "paint") return;
      // While the tour teaches clicking, it opens once the tour has said so.
      if (tourStepId === "open") setTourClicked({ id: was.on.id, cell: was.last.cell });
      else setToOpen({ id: was.on.id, cell: was.last.cell });
      return;
    }
    const [left, right] = [Math.min(was.from[0], was.to[0]), Math.max(was.from[0], was.to[0])];
    const [top, bottom] = [Math.min(was.from[1], was.to[1]), Math.max(was.from[1], was.to[1])];
    make(
      {
        kind: was.kind,
        days: collection.days.slice(left, right + 1),
        from: collection.firstHour + top * fineness,
        to: collection.firstHour + (bottom + 1) * fineness,
        repeat: "all",
        week: "",
      },
      was.last.cell,
    );
  };
  useEffect(() => {
    const up = () => letGo.current();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  // A press anywhere but the pop-over closes it — caught first, before the dialog keeps it to itself.
  useEffect(() => {
    if (!open) return;
    const elsewhere = (event: PointerEvent) => {
      // A press on the tour's card is not one on the page: Back must not close what it is about.
      if ((event.target as Element | null)?.closest?.("[data-tour-card]")) return;
      if (!popover.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", elsewhere, true);
    return () => document.removeEventListener("pointerdown", elsewhere, true);
  }, [open]);
  // Opened, the pop-over takes the keyboard, on how the block repeats; and is brought into view
  // whole, by as little scrolling as it takes, if it hangs below what shows.
  const openId = open?.id;
  useEffect(() => {
    if (!openId) return;
    // Opened to give a constraint its missing reason (from Submit): on the reason, already asked.
    const why = whyNext.current;
    whyNext.current = false;
    setAskWhy(why);
    popover.current?.querySelector<HTMLElement>(why ? "[data-why]" : "[data-first]")?.focus({ preventScroll: true });
    // At once, not gliding: a short way, and sure to happen where a glide can stall.
    popover.current?.scrollIntoView?.({ block: "nearest" });
  }, [openId]);

  const setLimitKind = (name: keyof WishLimits, kind: WishKind) => setLimitKinds((current) => ({ ...current, [name]: kind }));
  const setComment = (key: string, said: string) => setComments((current) => ({ ...current, [key]: said.slice(0, COMMENT_LENGTH) }));

  const limitBlock = (name: keyof WishLimits, label: string, options: { value: string; label: string }[]) => {
    const set = Boolean(limits[name]);
    return (
      <div className="grid content-start gap-1.5 rounded-lg border border-[#e3e8ef] bg-white px-3 py-2.5">
        <span className="text-xs font-semibold text-[#344054]">{label}</span>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 max-w-xs flex-1">
            <SelectMenu
              label={label}
              value={limits[name] ? String(limits[name]) : NONE}
              onChange={(value) => setLimits((current) => ({ ...current, [name]: value ? Number(value) : null }))}
              options={[{ value: NONE, label: "No limit" }, ...options]}
            />
          </div>
          {set ? <KindToggle name={`${label}: constraint or preference`} kind={limitKinds[name] ?? "preference"} onChange={(kind) => setLimitKind(name, kind)} /> : null}
        </div>
        {set ? (
          <input
            aria-label={`${label}: comment`}
            value={comments[name] ?? ""}
            maxLength={COMMENT_LENGTH}
            onChange={(event) => setComment(name, event.target.value)}
            aria-required={(limitKinds[name] ?? "preference") === "constraint"}
            aria-invalid={missingWhy && (limitKinds[name] ?? "preference") === "constraint" && !(comments[name] ?? "").trim()}
            placeholder={(limitKinds[name] ?? "preference") === "constraint" ? "Why (required for a constraint)" : "Why it matters (optional)"}
            className="w-full max-w-md rounded-md border border-[#e4e8ef] bg-white px-2.5 py-1 text-xs text-[#344054] placeholder:text-[#98a2b3] aria-[invalid=true]:border-[#d9646a] aria-[invalid=true]:bg-[#fdf3f3]"
          />
        ) : null}
      </div>
    );
  };
  const counts = (from: number, to: number, unit: string) =>
    Array.from({ length: to - from + 1 }, (_, index) => ({ value: String(from + index), label: `${from + index} ${unit}${from + index === 1 ? "" : "s"}` }));

  const goTo = (next: number) => {
    setOpen(null);
    setProblem("");
    setPage(next);
    const top = root.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) root.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  const submit = (finished: boolean) => {
    setProblem("");
    if (finished && overCap && !reason.trim()) {
      // The reason is asked for under the calendar: back to it.
      goTo(0);
      setProblem(`That's ${cant} hours a week of constraints, over the ${collection.cantCap}: say why under the calendar, or mark fewer.`);
      return;
    }
    if (finished) {
      const bare = inListOrder(blocks).filter((block) => block.kind === "constraint" && !block.comment.trim());
      const bareLimits = LIMIT_NAMES.filter((name) => limits[name] && limitKinds[name] === "constraint" && !(comments[name] ?? "").trim());
      if (bare.length || bareLimits.length) {
        setMissingWhy(true);
        const count = bare.length + bareLimits.length;
        if (bare.length) {
          // Back on the calendar, the first one open, its reason asked for.
          goTo(0);
          whyNext.current = true;
          pick(bare[0]);
        } else {
          goTo(1);
        }
        setProblem(`Each constraint needs a reason, for the coordinator: ${count === 1 ? "one has" : `${count} have`} none yet.`);
        return;
      }
    }
    const set = LIMIT_NAMES.filter((name) => limits[name]);
    onSave({
      blocks: blocks.map((block) => ({ ...block, comment: block.comment.trim() })),
      limits,
      limitKinds: Object.fromEntries(set.map((name) => [name, limitKinds[name] ?? "preference"])),
      comments: Object.fromEntries(set.filter((name) => (comments[name] ?? "").trim()).map((name) => [name, comments[name].trim()])),
      needs,
      note,
      overCapReason: overCap ? reason : "",
      submit: finished,
    });
  };

  const openBlock = open ? blocks.find((block) => block.id === open.id) : undefined;
  // The block lit up: the one open, clicked in the tour, hovered in the list, or under the pointer.
  const litId = open?.id ?? tourClicked?.id ?? hovered ?? (resting && !drag ? blockAt(resting.day, resting.time)?.id : undefined);
  const restingBlock = resting && !drag ? blockAt(resting.day, resting.time) : null;
  const inDrag = (column: number, row: number) =>
    drag !== null &&
    column >= Math.min(drag.from[0], drag.to[0]) &&
    column <= Math.max(drag.from[0], drag.to[0]) &&
    row >= Math.min(drag.from[1], drag.to[1]) &&
    row <= Math.max(drag.from[1], drag.to[1]);

  // ---------------------------------------------------------------- the guided tour
  const part = (name: string) => root.current?.querySelector(`[data-tour="${name}"]`) ?? null;
  const tourFrom = useRef<{
    said: string;
    week: string;
    blocks: WishBlock[];
    limits: WishLimits;
    limitKinds: Wishes["limitKinds"];
    comments: Record<string, string>;
    needs: string;
    note: string;
    reason: string;
  } | null>(null);
  const tried = tourFrom.current !== null && current !== tourFrom.current.said;
  const startTour = () => {
    tourFrom.current = { said: current, week, blocks, limits, limitKinds, comments, needs, note, reason };
    setOpen(null);
    setTourMade("");
    setTourDay("");
    setTourWeek("");
    setTourClicked(null);
    setTourAt(0);
  };
  /*
   * A card of its own over the form, outside the tour: the tour suggested as the form first opens
   * in a browser (it has not been taken here, and the form waits for it), or how to take it again
   * after leaving it before its end.
   */
  const [tourHint, setTourHint] = useState<"welcome" | "again" | null>(() => (tourRequired ? "welcome" : null));
  const endTour = () => {
    const from = tourFrom.current;
    tourFrom.current = null;
    setTourAt(null);
    setTourClicked(null);
    setOpen(null);
    setPage(0);
    if (from) setWeek(from.week);
  };
  const clearTried = () => {
    const from = tourFrom.current;
    if (from) {
      setBlocks(from.blocks);
      setLimits(from.limits);
      setLimitKinds(from.limitKinds);
      setComments(from.comments);
      setNeeds(from.needs);
      setNote(from.note);
      setReason(from.reason);
    }
    endTour();
  };

  // A tour step starts from the form as it is, on the page it is about.
  const entering = useRef<(id: string) => void>(() => {});
  entering.current = (id: string) => {
    // Only the step about the box keeps one open: come back to an earlier step, and it is closed.
    const keepsOpen = id === "repeat";
    if (!keepsOpen) setOpen(null);
    setTourBase({ week, sawOpen: keepsOpen && Boolean(open) });
    setPage(id === "limits" || id === "save" || id === "again" ? 1 : 0);
    if (id === "open") setTourClicked(null);
    // The block clicked on the step before opens now, growing out of it.
    if (id === "repeat" && tourClicked) {
      setPopFromTour(true);
      setToOpen(tourClicked);
      setTourClicked(null);
    }
    // Come to the end, the tour has been taken: the form is free to use.
    if (id === "save") {
      rememberTourTaken();
      setTourRequired(false);
    }
  };
  useEffect(() => {
    if (tourStepId) entering.current(tourStepId);
  }, [tourStepId]);
  useEffect(() => {
    if (!open) setPopFromTour(false);
  }, [open]);
  // The box opened while the tour is on how a block repeats: closing it is what was to try.
  useEffect(() => {
    if (open && (tourStepId === "repeat" || tourStepId === "day" || tourStepId === "week")) setTourBase((base) => (base.sawOpen ? base : { ...base, sawOpen: true }));
  }, [open, tourStepId]);

  // The painting shown while the tour asks for it, until somebody paints: Tuesday from 14:00, three hours.
  const showDemo = tourStepId === "paint" && !tourMade && !drag;
  // And where to click, once there is a block: a hand tapping on it.
  const tapOn = tourStepId === "open" && !open && !tourClicked ? (blocks.find((block) => block.id === tourMade && held.has(`${block.days[0]}:${block.from}`)) ?? [...held.values()][0]) : undefined;
  useLayoutEffect(() => {
    if (!showDemo && !tapOn) {
      setDemo(null);
      return;
    }
    const measure = () => {
      const box = gridBox.current;
      let first: Element | null | undefined;
      let last: Element | null | undefined;
      if (tapOn) {
        first = last = box?.querySelector(`[data-cell="${tapOn.days[0]}:${rowOf(Math.max(tapOn.from, collection.firstHour))}"]`);
      } else {
        const day = collection.days.includes(2) ? 2 : collection.days[Math.min(1, collection.days.length - 1)];
        const from = Math.max(collection.firstHour, Math.min(14, collection.lastHour - 1));
        const to = Math.min(from + 3, collection.lastHour);
        first = box?.querySelector(`[data-cell="${day}:${from}"]`);
        last = box?.querySelector(`[data-cell="${day}:${to - fineness}"]`);
      }
      if (!box || !first || !last) return setDemo(null);
      const frame = box.getBoundingClientRect();
      const top = first.getBoundingClientRect();
      const bottom = last.getBoundingClientRect();
      setDemo({ left: top.left - frame.left, top: top.top - frame.top, width: top.width, height: bottom.bottom - top.top });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // Measured again when the cells change: a block made, the cells made finer, another week.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo, tapOn?.id, fineness, collection, week, page]);

  const tourButtonAt = useRef<HTMLButtonElement>(null);
  const tourButton = (
    <button
      ref={tourButtonAt}
      type="button"
      onClick={startTour}
      disabled={tourAt !== null}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#cfe0f1] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#1f4e79] hover:bg-[#eef4fa] disabled:opacity-50"
    >
      <Compass size={14} aria-hidden="true" /> Guided tour
    </button>
  );
  const gridBody = () => gridBox.current?.querySelector("tbody");
  /*
   * The cards' words: one line per thing to do, or per thing the page does not already say.
   * No option or field named again where the page shows it, and no line said twice.
   */
  const tourSteps: (TourStep & { id: (typeof TOUR)[number] })[] = [
    {
      // Before anything: that this is a tour, and that only what its card says works.
      id: "intro",
      title: "How this tour works",
      body: <span className="font-semibold text-[#1f4e79]">This is a guided tour of the form: you try each part as you go.</span>,
      steps: [
        <>Read this card: it says what to do, one step at a time.</>,
        <>Do only that. The rest of the page stays locked until the tour ends.</>,
        <>
          The card moves on once it is done; <b>Back</b> returns to the step before.
        </>,
      ],
    },
    {
      id: "paint",
      title: "Mark a time",
      body: tourMade ? <b className="font-semibold text-[#1f4e79]">One block is enough for the tour. Press Next.</b> : undefined,
      steps: [<>Drag down a few hours on any day; sideways covers several days.</>, <>Let go: that makes a block. You set it in its box in a moment.</>],
      tryIt: "Drag down a few hours on any day of the calendar.",
      done: Boolean(tourMade) && !drag,
      target: () => [part("toolbar"), gridBox.current],
      allow: () => gridBody(),
    },
    {
      id: "open",
      title: "Open a block",
      steps: [<>Click the block you made.</>],
      tryIt: "Click the block you made.",
      done: Boolean(tourClicked || (open && openBlock)),
      doneWords: "Nicely done: opening it…",
      // Clicked: a moment to see the block chosen, then it opens and the tour goes on by itself.
      autoNext: 2000,
      target: () => gridBox.current,
      allow: () => gridBody(),
    },
    {
      id: "repeat",
      title: "Set the block",
      body: open && openBlock ? <span className="font-semibold text-[#1f4e79]">Your click opened this box.</span> : undefined,
      steps:
        open && openBlock
          ? [
              <>
                Choose <KindLook kind="constraint" /> (can&rsquo;t teach) or <KindLook kind="preference" /> (would like to teach).
              </>,
              <>Pick how it repeats.</>,
              <>Say why: a constraint needs a reason; for a preference it&rsquo;s optional. The coordinator reads it.</>,
              <>
                Press <b>Done</b>.
              </>,
            ]
          : [<>Click your block to open its box.</>],
      tryIt: open && openBlock ? "Set the block in its box, then press Done." : "Click your block to open its box.",
      done: tourBase.sawOpen && !open,
      // Done pressed: straight on.
      instantNext: true,
      // The calendar and all above it, to see the block change as it is chosen, and the box: each lit
      // on its own, so the summary under the calendar stays in the dim, wherever the box reaches.
      target: () => [[part("notice"), part("stepper"), part("week-head"), part("toolbar"), gridBox.current], open ? popover.current : null],
      apart: true,
      allow: () => (open ? popover.current : gridBody()),
      pointAt: () => popover.current?.querySelector('[aria-label="Constraint or preference"]'),
      // Beside the choice, outside its box: over it would cover the box's words.
      pointFrom: "left",
    },
    {
      id: "weeks",
      title: "Move between weeks",
      steps: [<>Press the arrow to go to {after_ ? "the next week" : "the week before"}.</>],
      tryIt: `Press the arrow to go to ${after_ ? "the next week" : "the week before"}.`,
      done: week !== tourBase.week,
      instantNext: true,
      target: () => [part("toolbar"), gridBox.current],
      allow: () => [part("week-before"), part("week-after"), part("weeks")?.querySelector("[aria-haspopup]")],
      pointAt: () => part(after_ || !before_ ? "week-after" : "week-before"),
    },
    {
      id: "day",
      title: "Away for a day?",
      steps: [
        <>
          Press <b>Whole day</b> under a day&rsquo;s name.
        </>,
        <>
          The whole day becomes a <KindLook kind="constraint" /> for this week only: say why in its box, e.g. &ldquo;Conference&rdquo;.
        </>,
        <>
          Press <b>Done</b>.
        </>,
      ],
      tryIt: open ? "Say why in the day's box, then press Done." : "Press Whole day under a day's name.",
      done: Boolean(tourDay) && tourBase.sawOpen && !open,
      instantNext: true,
      // The calendar, and the day's box on its own once it is open.
      target: () => [[part("toolbar"), gridBox.current], open ? popover.current : null],
      apart: true,
      allow: () => [gridBox.current?.querySelector("thead"), open ? popover.current : null],
      pointAt: () => (open ? popover.current?.querySelector("[data-why]") : gridBox.current?.querySelector("thead button[data-day-name]")),
      pointFrom: open ? "left" : undefined,
    },
    {
      id: "week",
      title: "Away for a whole week?",
      steps: [
        <>
          Press <b>Whole week</b>, beside the week&rsquo;s name.
        </>,
        <>
          Every day of the week becomes a <KindLook kind="constraint" /> for this week only: say why in its box, e.g. &ldquo;Leave&rdquo;.
        </>,
        <>
          Press <b>Done</b>.
        </>,
      ],
      tryIt: open ? "Say why in the week's box, then press Done." : "Press Whole week, beside the week's name.",
      done: Boolean(tourWeek) && tourBase.sawOpen && !open,
      instantNext: true,
      target: () => [[part("toolbar"), gridBox.current], open ? popover.current : null],
      apart: true,
      allow: () => [part("whole-week"), open ? popover.current : null],
      pointAt: () => (open ? popover.current?.querySelector("[data-why]") : part("whole-week")),
      pointFrom: open ? "left" : undefined,
    },
    {
      id: "summary",
      title: "Summary of constraints and preferences",
      steps: [<>Everything marked is listed here, with how it repeats and why.</>, <>Click one to go to its week and open it.</>],
      // The light grows from the calendar to take in the list under it.
      target: () => [gridBox.current, part("summary")],
      pointAt: () => part("summary"),
      pointFrom: "left",
    },
    {
      id: "next",
      title: "Two more pages",
      steps: [
        <>
          Press <b>Next: Limits</b>.
        </>,
        <>
          <b>Back</b> returns to the calendar as you left it.
        </>,
      ],
      tryIt: "Go on.",
      done: page >= 1,
      instantNext: true,
      target: () => part("nav"),
      allow: () => part("next"),
      pointAt: () => part("next"),
    },
    {
      id: "limits",
      title: `Limits on ${yours} week`,
      steps: [
        <>Set only those that matter.</>,
        <>
          Each is a <KindLook kind="preference" /> unless you switch it to <KindLook kind="constraint" />.
        </>,
      ],
      target: () => part("limits"),
      allow: () => part("limits"),
    },
    {
      id: "save",
      title: "Save or submit",
      steps: [
        <>
          <b>Save draft</b> keeps it for later.
        </>,
        <>
          <b>Submit</b> is on the last page.
        </>,
        voice === "you" ? <>You can change your answer until the deadline.</> : <>It&rsquo;s kept as entered by you.</>,
      ],
      target: () => part("nav"),
    },
    {
      id: "again",
      title: "Take the tour again",
      steps: [
        <>
          Press <b>Guided tour</b>, top right, whenever you want it.
        </>,
      ],
      target: () => tourButtonAt.current,
      pointAt: () => tourButtonAt.current,
      actions: tried
        ? [
            { label: "Clear what I tried", onClick: clearTried },
            { label: "Keep it", primary: true, onClick: endTour },
          ]
        : undefined,
    },
  ];

  const hintStep: TourStep | null =
    tourHint === "welcome"
      ? {
          id: "welcome",
          title: "New here? Take the one-minute tour",
          steps: [
            <>You try each part of the form as you go.</>,
            <>Anything you try can be cleared at the end.</>,
            <>
              <b>Save draft</b> and <b>Submit</b> open once it is done.
            </>,
          ],
          actions: [
            { label: "Later", onClick: () => setTourHint("again") },
            {
              label: "Start the tour",
              primary: true,
              onClick: () => {
                setTourHint(null);
                startTour();
              },
            },
          ],
        }
      : tourHint === "again"
        ? {
            id: "again-hint",
            title: "Take the tour again",
            steps: [
              <>
                Press <b>Guided tour</b>, top right, whenever you want it.
              </>,
              ...(tourRequired
                ? [
                    <>
                      <b>Save draft</b> and <b>Submit</b> open once it is finished.
                    </>,
                  ]
                : []),
            ],
            target: () => tourButtonAt.current,
            pointAt: () => tourButtonAt.current,
            actions: [{ label: "Got it", primary: true, onClick: () => setTourHint(null) }],
          }
        : null;

  const PAGES = [`${Yours} week`, "Limits", "Needs and a note"];
  const repeatChoices = (block: WishBlock): { value: WishRepeat; label: string; hint: string }[] => {
    const fromWeek = block.repeat === "from" ? block.week : week;
    const onceWeek = block.repeat === "once" ? block.week : week;
    return [
      { value: "all", label: "Every week", hint: "The whole semester" },
      { value: "from", label: `Every week from ${weekShort(fromWeek)}`, hint: "From that week to the end" },
      { value: "once", label: "This week only", hint: weekName(onceWeek) },
    ];
  };
  const setRepeat = (block: WishBlock, repeat: WishRepeat) => {
    const weekFor = repeat === "all" ? "" : repeat === block.repeat ? block.week : week;
    change(block.id, { repeat, week: weekFor });
  };
  const closeBox = () => {
    if (!open) return;
    const cell = open.cell;
    setOpen(null);
    if (cell.isConnected) cell.focus();
  };
  /** Done: a constraint is done once it says why; a preference, at once. (× and Escape close it anyway.) */
  const finishBox = () => {
    if (openBlock?.kind === "constraint" && !openBlock.comment.trim()) {
      setAskWhy(true);
      popover.current?.querySelector<HTMLElement>("[data-why]")?.focus();
      return;
    }
    closeBox();
  };

  return (
    <div ref={root} className="space-y-4">
      {tourAt !== null ? (
        <FormTour
          steps={tourSteps}
          at={tourAt}
          onStep={setTourAt}
          nudge={tourNudge}
          endWords={[
            tried && tourAt !== tourSteps.length - 1 ? "What you tried during the tour is cleared." : "",
            tourRequired
              ? "Save and Submit stay off until the tour is taken to its end: start it again from Guided tour, top right."
              : "You can take it again from Guided tour, top right.",
          ]
            .filter(Boolean)
            .join(" ")}
          // Finished, or ended early: what was tried on the way is cleared, unless kept at the end;
          // and, ended early, how to take it again pops up.
          onClose={() => {
            const early = tourAt !== tourSteps.length - 1;
            if (tried && early) clearTried();
            else endTour();
            if (early) setTourHint("again");
          }}
        />
      ) : null}
      {tourAt === null && hintStep ? (
        // Its ×, on the suggestion, is a "Later": how to take the tour then follows.
        <FormTour hint steps={[hintStep]} at={0} onStep={() => {}} onClose={() => setTourHint(tourHint === "welcome" ? "again" : null)} />
      ) : null}
      {tourButtonIn ? createPortal(tourButton, tourButtonIn) : <div className="flex justify-end">{tourButton}</div>}
      {notice ? (
        <div
          data-tour="notice"
          role={noticeTone === "warning" ? "note" : undefined}
          className={`rounded-md px-3 py-2 text-sm ${noticeTone === "warning" ? "bg-[#fdf6e3] text-[#7a5d00]" : "bg-[#f2f7fb] text-[#344054]"}`}
        >
          {notice}
        </div>
      ) : null}

      {/* -------------------------------------------------------------- which page */}
      <ol data-tour="stepper" aria-label="Parts of the form" className="flex flex-wrap items-center gap-1.5">
        {PAGES.map((title, index) => (
          <li key={title} className="flex items-center gap-1.5">
            {index ? <span aria-hidden="true" className="h-px w-5 bg-[#c8d0db]" /> : null}
            <button
              type="button"
              aria-current={page === index ? "step" : undefined}
              onClick={() => goTo(index)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                page === index ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`grid h-4 w-4 place-items-center rounded-full text-[10px] ${page === index ? "bg-white text-[#1f4e79]" : index < page ? "bg-[#e7f4ec] text-[#2e7d55]" : "bg-[#eef1f5] text-[#667085]"}`}
              >
                {index < page ? <Check size={10} strokeWidth={3} /> : index + 1}
              </span>
              {title}
            </button>
          </li>
        ))}
      </ol>

      {/* -------------------------------------------------------------- the week */}
      {page === 0 ? (
        <section aria-label={`${Yours} week`} className={section}>
          <div data-tour="week-head">
            <h3 className="text-sm font-semibold text-[#171717]">{Yours} week</h3>
            <HowTo
              steps={[
                { icon: MoveDown, title: "Drag across the hours", hint: "And across days · hours left white are fine" },
                { icon: Paintbrush, title: "Constraint or preference", hint: `In its box: red, ${meaning("constraint", voice)}; green, ${meaning("preference", voice)}` },
                { icon: Repeat, title: "How it repeats", hint: "Every week, from a week on, or one week only" },
              ]}
            >
              <div className="flex flex-col justify-center gap-0.5 rounded-lg border border-dashed border-[#e8b4b7] bg-[#fdf6f6] px-3 py-2">
                <span className="text-[11px] text-[#a6292f]">Away for a day or a week?</span>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#a6292f]">
                  <CalendarX2 size={12} aria-hidden="true" /> Whole day · Whole week
                </span>
              </div>
            </HowTo>
          </div>
          <div data-tour="toolbar" className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div data-tour="weeks" className="flex items-center gap-1">
              <button
                type="button"
                data-tour="week-before"
                aria-label="The week before"
                disabled={!before_}
                onClick={() => before_ && showWeek(before_)}
                className="rounded p-1 text-[#344054] hover:bg-white disabled:text-[#d0d5dd] disabled:hover:bg-transparent"
              >
                <ChevronLeft size={16} aria-hidden="true" />
              </button>
              {weeks.length ? (
                <div className="w-72">
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
                        badge: ownWeeks.get(each.monday) ? `${ownWeeks.get(each.monday)} own` : undefined,
                      })),
                    ]}
                  />
                </div>
              ) : (
                <span className="px-1 text-xs font-semibold text-[#344054]">{weekName(week)}</span>
              )}
              <button
                type="button"
                data-tour="week-after"
                aria-label="The week after"
                disabled={!after_}
                onClick={() => after_ && showWeek(after_)}
                className="rounded p-1 text-[#344054] hover:bg-white disabled:text-[#d0d5dd] disabled:hover:bg-transparent"
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
              <Tip side="top" wide={false} content={`Can't teach at all in ${weekName(week)}: a constraint every day, this week only.`}>
                <button
                  type="button"
                  data-tour="whole-week"
                  aria-label={`${weekName(week)}: a constraint all week, this week only`}
                  aria-pressed={wholeWeekOf() ? true : false}
                  onClick={wholeWeek}
                  className={`ml-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    wholeWeekOf() ? "border-[#a6292f] bg-[#fdf3f3] text-[#a6292f]" : "border-[#e8b4b7] bg-white text-[#a6292f] hover:bg-[#fdf3f3]"
                  }`}
                >
                  <CalendarX2 size={12} aria-hidden="true" /> Whole week
                </button>
              </Tip>
            </div>
            <div role="radiogroup" aria-label="Cells" className="inline-flex rounded-md bg-white/70 p-0.5 text-xs font-semibold">
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
            <Tip
              side="bottom"
              wide={false}
              content={`Hours a week marked as constraints that repeat; a one-week block is not counted. Over ${collection.cantCap}, say why for the coordinator.`}
            >
              <span
                aria-label={`Constraints: ${cant} of ${collection.cantCap} hours a week`}
                className={`ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs tabular-nums ${
                  overCap ? "border-[#e8b4b7] bg-[#fdf3f3] text-[#a6292f]" : "border-[#e3e8ef] bg-white text-[#475467]"
                }`}
              >
                <span className="font-semibold">Constraints</span>
                <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-[#eef1f5]" aria-hidden="true">
                  <span
                    className={`absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] ${overCap ? "bg-[#a6292f]" : "bg-[#d9646a]"}`}
                    style={{ width: `${collection.cantCap ? Math.min(100, (cant / collection.cantCap) * 100) : cant ? 100 : 0}%` }}
                  />
                </span>
                <span aria-hidden="true">
                  {cant} / {collection.cantCap} h a week{overCap ? " · over" : ""}
                </span>
              </span>
            </Tip>
          </div>
          <div ref={gridBox} className="relative mt-3">
            <div className="overflow-x-auto rounded-md bg-white pt-1.5">
              <table className="w-full table-fixed border-collapse select-none text-[11px]" aria-label={weekName(week)}>
                <thead>
                  <tr>
                    <th className="w-12" />
                    {collection.days.map((day) => {
                      const date = dateOf(day);
                      const holiday = holidays.get(date);
                      return (
                        <th key={day} className="pb-1 align-bottom font-semibold text-[#344054]">
                          {holiday !== undefined ? (
                            <span className="block leading-tight">
                              {DAY_SHORT[day]} <span className="font-normal text-[#667085]">{formatDayAndMonth(date)}</span>
                              <span className="block text-[10px] font-normal text-[#98a2b3]">{holiday || "Holiday"}</span>
                            </span>
                          ) : (
                            <span className="flex flex-col items-center gap-1">
                              <span>
                                {DAY_SHORT[day]} <span className="font-normal">{formatDayAndMonth(date)}</span>
                              </span>
                              {/* The whole day, a button of its own: a date alone does not say it can be pressed. */}
                              <Tip side="top" wide={false} content={`Can't teach all ${DAY_NAMES[day]} ${formatDayAndMonth(date)}: a constraint for this week only.`}>
                                <button
                                  type="button"
                                  data-day-name
                                  aria-label={`${DAY_NAMES[day]} ${formatDayAndMonth(date)}: a constraint all day, this week only`}
                                  aria-pressed={wholeDayOf(day) ? true : false}
                                  onClick={(event) => wholeDay(day, event.currentTarget)}
                                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10px] font-semibold ${
                                    wholeDayOf(day)
                                      ? "border-[#a6292f] bg-[#fdf3f3] text-[#a6292f]"
                                      : "border-[#e8b4b7] bg-white text-[#a6292f] hover:bg-[#fdf3f3]"
                                  }`}
                                >
                                  <CalendarX2 size={11} aria-hidden="true" /> Whole day
                                </button>
                              </Tip>
                            </span>
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
                        const holiday = holidays.has(date);
                        const quarters = quartersOf(time).map((hour) => ({ hour, block: held.get(`${day}:${hour}`) ?? null }));
                        const first = quarters.find((quarter) => quarter.block)?.block ?? null;
                        const previewing = inDrag(column, row);
                        const said = holiday
                          ? "holiday"
                          : first
                            ? `${first.kind}, ${first.repeat === "all" ? "every week" : first.repeat === "from" ? `every week from ${formatDayAndMonth(first.week)}` : "this week only"}`
                            : "fine";
                        return (
                          <td key={day} className={`border-x border-[#c8d0db] p-0 ${row === rows.length - 1 ? "border-b" : ""}`}>
                            <button
                              type="button"
                              disabled={holiday}
                              data-cell={`${day}:${time}`}
                              aria-label={`${DAY_NAMES[day]} ${formatDayAndMonth(date)} ${clockOf(time)}: ${said}`}
                              aria-haspopup={first ? "dialog" : undefined}
                              onPointerDown={(event) => {
                                event.preventDefault();
                                const last = { day, time, cell: event.currentTarget };
                                // The tour's one block made, a press off it does nothing.
                                if (!first && !canMake) return nudgeTour();
                                // On the tour's painting step a press on a block is nothing at all.
                                if (first && tourStepId === "paint") return nudgeTour();
                                setResting(null);
                                stroke.current = { from: here, to: here, on: first, moved: false, kind: brush, last };
                                if (!first) setDrag({ from: here, to: here });
                              }}
                              onPointerEnter={(event) => {
                                const was = stroke.current;
                                if (!was) {
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
                                // Dragged on from a block, it makes a new one from there — when one may be made.
                                if (!canMake) return;
                                was.moved = true;
                                was.to = here;
                                was.last = { day, time, cell: event.currentTarget };
                                setDrag({ from: was.from, to: here });
                              }}
                              onPointerLeave={() => setResting((now) => (now?.day === day && now.time === time ? null : now))}
                              onClick={(event) => {
                                // Enter or Space on a cell: the pointer acts on press, the keyboard here.
                                if (event.detail !== 0) return;
                                const cell = event.currentTarget;
                                if (first) {
                                  if (tourStepId === "paint") return nudgeTour();
                                  if (tourStepId === "open") setTourClicked({ id: first.id, cell });
                                  else openAt(first.id, cell);
                                  return;
                                }
                                make({ kind: brush, days: [day], from: time, to: time + fineness, repeat: "all", week: "" }, cell);
                              }}
                              className="flex w-full flex-col overflow-hidden bg-white disabled:cursor-default"
                              style={
                                holiday
                                  ? { height: rowHeight, backgroundColor: "#f2f4f7", backgroundImage: stripes("rgba(152, 162, 179, 0.25)") }
                                  : { height: rowHeight }
                              }
                            >
                              {quarters.map((quarter) => {
                                const tone = holiday ? undefined : previewing ? PREVIEW[brush] : quarter.block ? toneOf(quarter.block) : undefined;
                                const lit = Boolean(quarter.block) && quarter.block?.id === litId && !previewing;
                                return (
                                  <span
                                    key={quarter.hour}
                                    data-quarter={quarter.hour}
                                    className={`block min-h-0 w-full flex-1 ${tone || holiday || quarter.hour !== time ? "" : ruleOf(quarter.hour)} ${lit ? "brightness-[0.82]" : ""}`}
                                    style={tone}
                                  />
                                );
                              })}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tapOn && demo ? (
              // Where to click: a hand tapping on the block made.
              <div
                aria-hidden="true"
                data-tour-demo="tap"
                className="pointer-events-none absolute z-10"
                style={{ left: demo.left, top: demo.top, width: demo.width, height: demo.height }}
              >
                <span className="absolute left-1/2 top-1/2 -ml-4 -mt-4 h-8 w-8">
                  <span className="tour-tap-press block h-8 w-8 rounded-full border-2 border-[#1f4e79]" />
                </span>
                <span className="absolute left-1/2 top-1/2 -ml-[9px] -mt-[3px]">
                  <span className="tour-tap-hand block">
                    <Pointer size={24} strokeWidth={1.75} className="fill-white text-[#171717] drop-shadow-[0_1px_2px_rgba(16,24,40,0.35)]" />
                  </span>
                </span>
              </div>
            ) : null}
            {showDemo && demo ? (
              // How to paint, shown and not told: a hand presses, drags down, and the stroke fills behind it.
              <div
                aria-hidden="true"
                data-tour-demo
                className="pointer-events-none absolute z-10"
                style={{ left: demo.left, top: demo.top, width: demo.width, height: demo.height, ["--tour-drag" as string]: `${demo.height - 6}px` }}
              >
                {/* In the colour a new block takes: a constraint's, until its box says otherwise. */}
                <span className="tour-paint-stroke absolute inset-x-1 top-0 h-full rounded-sm" style={{ backgroundColor: "rgba(217, 100, 106, 0.6)" }} />
                <span className="absolute left-1/2 top-0 -ml-3 -mt-3 h-6 w-6">
                  <span className="tour-paint-press block h-6 w-6 rounded-full border-2 border-[#a6292f]" />
                </span>
                <span className="absolute left-1/2 top-0 -ml-[9px] -mt-[3px]">
                  <span className="tour-paint-hand block">
                    <Pointer size={24} strokeWidth={1.75} className="fill-white text-[#171717] drop-shadow-[0_1px_2px_rgba(16,24,40,0.35)]" />
                  </span>
                </span>
              </div>
            ) : null}
            {/*
             * One bubble for the whole grid, beside the cell the pointer rests on: a bubble on
             * every cell made a week of quarter hours slow to draw, and only one is ever open.
             */}
            {resting ? (
              <Tip
                // Not on the tour's painting step: the bubble says to click, which comes next.
                open={Boolean(restingBlock) && !open && tourStepId !== "paint"}
                side="right"
                wide={false}
                title={restingBlock ? describeBlock(restingBlock, grid) : undefined}
                content={
                  restingBlock ? (
                    <>
                      {restingBlock.comment ? <span className="mb-1.5 block">&ldquo;{restingBlock.comment}&rdquo;</span> : null}
                      <TipDo>Click to choose how it repeats, comment or remove</TipDo>
                    </>
                  ) : null
                }
              >
                <span aria-hidden="true" className="pointer-events-none absolute" style={resting.box} />
              </Tip>
            ) : null}
            {open && openBlock ? (
              <div
                ref={popover}
                role="dialog"
                aria-label={describeBlock(openBlock, grid)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  // This pop-over only, not the window round it.
                  event.stopPropagation();
                  closeBox();
                }}
                className={`absolute z-20 grid w-[300px] gap-3 rounded-lg border border-[#d9dee7] bg-white p-3 shadow-lg ${popFromTour ? "tour-pop-in" : ""}`}
                style={{ left: open.left, top: open.top }}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-[#171717]">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={toneOf(openBlock)} />
                    {whenWords(openBlock, grid)}
                  </p>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={closeBox}
                    className="-mr-1 -mt-1 rounded p-1 text-[#98a2b3] hover:bg-[#f2f4f7] hover:text-[#344054]"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
                <KindToggle name="Constraint or preference" kind={openBlock.kind} onChange={(kind) => change(openBlock.id, { kind })} />
                <div role="radiogroup" aria-label="How it repeats" className="grid gap-1">
                  <span className="text-xs font-semibold text-[#344054]">How it repeats</span>
                  {repeatChoices(openBlock).map((choice) => {
                    const on = openBlock.repeat === choice.value;
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        data-first={on ? "" : undefined}
                        onClick={() => setRepeat(openBlock, choice.value)}
                        className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left ${
                          on ? "border-[#1f4e79] bg-[#eef4fa]" : "border-[#e3e8ef] bg-white hover:bg-[#f8fafc]"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${on ? "border-[#1f4e79]" : "border-[#c8d0db]"}`}
                        >
                          {on ? <span className="h-1.5 w-1.5 rounded-full bg-[#1f4e79]" /> : null}
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-xs font-semibold ${on ? "text-[#1f4e79]" : "text-[#344054]"}`}>{choice.label}</span>
                          <span className="block text-[11px] text-[#667085]">{choice.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <label className="grid gap-1">
                  {openBlock.kind === "constraint" ? (
                    <span className="text-xs font-semibold text-[#344054]">
                      Why, for the coordinator <span className="font-normal text-[#a6292f]">· required</span>
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#344054]">
                      Comment, for the coordinator <span className="font-normal text-[#98a2b3]">· optional</span>
                    </span>
                  )}
                  <input
                    data-why
                    value={openBlock.comment}
                    maxLength={COMMENT_LENGTH}
                    aria-required={openBlock.kind === "constraint"}
                    aria-invalid={askWhy && openBlock.kind === "constraint" && !openBlock.comment.trim()}
                    onChange={(event) => change(openBlock.id, { comment: event.target.value.slice(0, COMMENT_LENGTH) })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        // Not to reach the cell the focus goes back to, and press it.
                        event.preventDefault();
                        finishBox();
                      }
                    }}
                    placeholder={openBlock.kind === "constraint" ? "School run, lab day, another job…" : "Why it suits (optional)"}
                    className={`${field} aria-[invalid=true]:border-[#d9646a] aria-[invalid=true]:bg-[#fdf3f3]`}
                  />
                  {askWhy && openBlock.kind === "constraint" && !openBlock.comment.trim() ? (
                    <span role="alert" className="text-xs text-[#a6292f]">
                      A constraint needs a reason.
                    </span>
                  ) : null}
                </label>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    // Not while the tour is on: the block is what its steps are about.
                    disabled={tourAt !== null}
                    title={tourAt !== null ? "Not during the guided tour" : undefined}
                    onClick={() => remove(openBlock.id)}
                    className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:text-[#d0a5a8] disabled:hover:bg-transparent"
                  >
                    <Trash2 size={13} aria-hidden="true" /> Remove
                  </button>
                  <button type="button" onClick={finishBox} className="rounded-md bg-[#1f4e79] px-3 py-1 text-xs font-semibold text-white">
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="mt-2">
            <WishesLegend voice={voice} />
          </div>
          {overCap ? (
            <label className="mt-3 block">
              <span className="text-xs font-semibold text-[#a6292f]">
                {cant} hours a week of constraints, over the {collection.cantCap}: say why, for the coordinator
              </span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className={`mt-1 ${field}`} />
            </label>
          ) : null}
          <div data-tour="summary" aria-label="Summary of constraints and preferences" className="mt-4 rounded-lg border border-[#d9dee7] bg-[#f8fafc] p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">
              <MessageSquare size={12} aria-hidden="true" /> Summary of constraints and preferences
            </p>
            <BlockList
              blocks={blocks}
              grid={grid}
              voice={voice}
              onPick={pick}
              onRemove={(block) => remove(block.id)}
              flagMissing
              removeOff={tourAt !== null ? "Not during the guided tour" : ""}
              onHover={setHovered}
            />
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- limits */}
      {page === 1 ? (
        <section data-tour="limits" aria-label={`Limits on ${yours} week`} className={section}>
          <h3 className="text-sm font-semibold text-[#171717]">Limits on {yours} week</h3>
          <p className={hint}>
            Only those that matter. Each one set is a preference unless you make it a constraint; a constraint is held to, a preference only if it can be.
          </p>
          <div className="mt-3 grid gap-2">
            {limitBlock("maxDays", "Most days on campus", counts(1, Math.max(1, collection.days.length - 1), "day"))}
            {limitBlock("maxHoursDay", "Most hours in a day", counts(2, 10, "hour"))}
            {limitBlock("maxInRow", "Most hours in a row", counts(1, 8, "hour"))}
            {limitBlock(
              "freeDay",
              voice === "you" ? "A day you'd like free" : "A day they'd like free",
              collection.days.map((day) => ({ value: String(day), label: DAY_NAMES[day] })),
            )}
          </div>
        </section>
      ) : null}

      {/* -------------------------------------------------------------- needs */}
      {page === 2 ? (
        <section data-tour="needs" aria-label="Needs and a note" className={section}>
          <h3 className="text-sm font-semibold text-[#171717]">Needs and a note</h3>
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-[#344054]">Room or equipment needs</span>
            <input value={needs} onChange={(event) => setNeeds(event.target.value)} placeholder="Lab, PC room, ground floor…" className={`mt-1 ${field}`} />
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-[#344054]">Note</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} className={`mt-1 ${field}`} />
          </label>
        </section>
      ) : null}

      <div data-tour="nav" className="flex flex-wrap items-center gap-3 pt-1">
        {page > 0 ? (
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f2f4f7]"
          >
            <ArrowLeft size={14} aria-hidden="true" /> Back
          </button>
        ) : null}
        {problem || error ? (
          <span role="alert" className="text-sm text-[#a6292f]">
            {problem || error}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-3">
          {onCancel ? (
            <button type="button" onClick={onCancel} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            data-tour="save"
            disabled={busy || tourRequired}
            onClick={() => submit(false)}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-50"
          >
            Save draft
          </button>
          {page < PAGES.length - 1 ? (
            <button
              type="button"
              data-tour="next"
              onClick={() => goTo(page + 1)}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
            >
              Next: {PAGES[page + 1]} <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              data-tour="save"
              disabled={busy || tourRequired}
              onClick={() => submit(true)}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {busy ? "Saving…" : "Submit"}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}
