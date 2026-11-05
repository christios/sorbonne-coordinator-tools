import { AlertTriangle, Repeat } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { formatDayAndMonth, minutesOf } from "@/services/weekSchedule";
import type { Clash, PlanClass, Slot } from "@/services/semesterPlans";

/** A quarter of an hour: what a class snaps to while it is drawn or dragged. */
const SNAP = 15;
/** A press that moves less than this is a click, not a drag. */
const STILL = 4;
/** What a click on an empty hour makes: the department's usual block. */
const USUAL = 90;
export const SECTION_DRAG = "application/x-plan-section";

export type PlanDay = { weekday: number; date: string; holiday?: string; without?: boolean };

type Drag =
  | { kind: "draw"; weekday: number; from: number; to: number; x: number; y: number; moved: boolean }
  | { kind: "move"; entry: PlanClass; weekday: number; start: number; offset: number; x: number; y: number; moved: boolean }
  | { kind: "stretch"; entry: PlanClass; end: number; x: number; y: number; moved: boolean };

function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

function snap(minutes: number): number {
  return Math.round(minutes / SNAP) * SNAP;
}

/** Side by side where classes overlap: each class's lane, and how many lanes its cluster needs. */
function lanesOf(entries: PlanClass[]): Map<PlanClass, { lane: number; of: number }> {
  const sorted = [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt) || b.endsAt.localeCompare(a.endsAt));
  const placed = new Map<PlanClass, { lane: number; of: number }>();
  let cluster: PlanClass[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const close = () => {
    for (const entry of cluster) placed.set(entry, { lane: placed.get(entry)!.lane, of: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const entry of sorted) {
    const start = minutesOf(entry.startsAt);
    const end = minutesOf(entry.endsAt);
    if (start >= clusterEnd && cluster.length) close();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    placed.set(entry, { lane, of: 0 });
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) close();
  return placed;
}

const CLASH_WORDS: Record<Clash["kind"], string> = {
  teacher: "same teacher",
  room: "same room",
  students: "may share students",
};

/**
 * One week of a plan, to be drawn on.
 *
 * Drag down an empty column to make a class at those hours, or click for the usual
 * ninety minutes. Drag a class to move it, its bottom edge to make it longer or shorter, or
 * click it to open it. A class from the tray dropped on a column is placed at that hour.
 * Nothing here saves: every gesture is handed up as a slot, and the page decides what it
 * means for the series.
 */
export function PlanWeek({
  days,
  classes,
  labelOf,
  detailOf,
  colorOf,
  clashes,
  fromHour,
  toHour,
  hourHeight = 48,
  onDraw,
  onOpen,
  onMove,
  onDropSection,
}: {
  days: PlanDay[];
  classes: PlanClass[];
  labelOf: (entry: PlanClass) => string;
  /** The smaller lines under the label: hours, room, teacher. */
  detailOf: (entry: PlanClass) => string[];
  colorOf: (entry: PlanClass) => string;
  clashes: Map<PlanClass, Clash[]>;
  fromHour: number;
  toHour: number;
  hourHeight?: number;
  onDraw: (slot: Pick<Slot, "weekday" | "startsAt" | "endsAt">) => void;
  onOpen: (entry: PlanClass) => void;
  onMove: (entry: PlanClass, slot: Pick<Slot, "weekday" | "startsAt" | "endsAt">) => void;
  onDropSection: (sectionId: string, slot: Pick<Slot, "weekday" | "startsAt" | "endsAt">) => void;
}) {
  const columns = useRef(new Map<number, HTMLDivElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const top = fromHour * 60;
  const height = (toHour - fromHour) * hourHeight;

  const minutesAt = (clientY: number, weekday: number): number => {
    const column = columns.current.get(weekday);
    if (!column) return top;
    const y = clientY - column.getBoundingClientRect().top;
    return top + (y / hourHeight) * 60;
  };
  const weekdayAt = (clientX: number, fallback: number): number => {
    for (const [weekday, column] of columns.current) {
      const box = column.getBoundingClientRect();
      if (clientX >= box.left && clientX < box.right) return weekday;
    }
    return fallback;
  };
  const inDay = (minutes: number) => Math.max(top, Math.min(toHour * 60, minutes));

  /*
   * The gesture lives in a ref as well as in state: the window's listeners read the ref,
   * and the page is told what happened once, when the pointer is let go — never from inside
   * a state update, which React may run twice.
   */
  const live = useRef<Drag | null>(null);
  const said = useRef({ onDraw, onOpen, onMove });
  useEffect(() => {
    said.current = { onDraw, onOpen, onMove };
  });
  const follow = (next: Drag | null) => {
    live.current = next;
    setDrag(next);
  };
  const active = drag !== null;

  // The gesture follows the pointer anywhere on the page, and ends wherever it is let go.
  useEffect(() => {
    if (!active) return;
    const moveTo = (event: PointerEvent) => {
      const current = live.current;
      if (!current) return;
      const moved = current.moved || Math.abs(event.clientX - current.x) > STILL || Math.abs(event.clientY - current.y) > STILL;
      if (current.kind === "draw") {
        follow({ ...current, to: inDay(snap(minutesAt(event.clientY, current.weekday))), moved });
      } else if (current.kind === "stretch") {
        const start = minutesOf(current.entry.startsAt);
        follow({ ...current, end: Math.max(start + SNAP, inDay(snap(minutesAt(event.clientY, current.entry.weekday)))), moved });
      } else {
        const weekday = weekdayAt(event.clientX, current.weekday);
        const length = minutesOf(current.entry.endsAt) - minutesOf(current.entry.startsAt);
        const start = Math.min(toHour * 60 - length, inDay(snap(minutesAt(event.clientY, weekday) - current.offset)));
        follow({ ...current, weekday, start, moved });
      }
    };
    const finish = () => {
      const current = live.current;
      follow(null);
      if (!current) return;
      const { onDraw: draw, onOpen: open, onMove: move } = said.current;
      if (current.kind === "draw") {
        const from = Math.min(current.from, current.to);
        const to = Math.max(current.from, current.to);
        const span = current.moved && to - from >= SNAP ? [from, to] : [current.from, current.from + USUAL];
        draw({ weekday: current.weekday, startsAt: timeOf(span[0]), endsAt: timeOf(Math.min(toHour * 60, span[1])) });
      } else if (!current.moved) {
        open(current.entry);
      } else if (current.kind === "stretch") {
        move(current.entry, { weekday: current.entry.weekday, startsAt: current.entry.startsAt, endsAt: timeOf(current.end) });
      } else {
        const length = minutesOf(current.entry.endsAt) - minutesOf(current.entry.startsAt);
        move(current.entry, { weekday: current.weekday, startsAt: timeOf(current.start), endsAt: timeOf(current.start + length) });
      }
    };
    const cancel = () => follow(null);
    window.addEventListener("pointermove", moveTo);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", moveTo);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
    };
    // Bound once per gesture; everything they read is in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const startDraw = (event: ReactPointerEvent, weekday: number) => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    const from = inDay(Math.floor(minutesAt(event.clientY, weekday) / SNAP) * SNAP);
    follow({ kind: "draw", weekday, from, to: from, x: event.clientX, y: event.clientY, moved: false });
  };
  const startMove = (event: ReactPointerEvent, entry: PlanClass) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const offset = minutesAt(event.clientY, entry.weekday) - minutesOf(entry.startsAt);
    follow({
      kind: "move",
      entry,
      weekday: entry.weekday,
      start: minutesOf(entry.startsAt),
      offset,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  };
  const startStretch = (event: ReactPointerEvent, entry: PlanClass) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    follow({ kind: "stretch", entry, end: minutesOf(entry.endsAt), x: event.clientX, y: event.clientY, moved: false });
  };

  /** Where a class is drawn while it is being dragged, and where it rests otherwise. */
  const shown = (entry: PlanClass): { weekday: number; start: number; end: number } => {
    if (drag && drag.kind !== "draw" && drag.entry === entry && drag.moved) {
      if (drag.kind === "stretch") return { weekday: entry.weekday, start: minutesOf(entry.startsAt), end: drag.end };
      const length = minutesOf(entry.endsAt) - minutesOf(entry.startsAt);
      return { weekday: drag.weekday, start: drag.start, end: drag.start + length };
    }
    return { weekday: entry.weekday, start: minutesOf(entry.startsAt), end: minutesOf(entry.endsAt) };
  };

  const hours = Array.from({ length: toHour - fromHour }, (_, index) => fromHour + index);

  return (
    <div className="flex min-w-0 select-none overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
      <div className="w-12 shrink-0 border-r border-[#eef1f5]">
        <div className="h-12 border-b border-[#d9dee7]" />
        <div className="relative" style={{ height }}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-1.5 -translate-y-1/2 text-[11px] tabular-nums text-[#98a2b3]"
              style={{ top: (hour - fromHour) * hourHeight }}
            >
              {hour > fromHour ? `${hour}:00` : ""}
            </span>
          ))}
        </div>
      </div>
      {days.map((day) => {
        const own = classes.filter((entry) => shown(entry).weekday === day.weekday);
        const lanes = lanesOf(own);
        const drawing = drag?.kind === "draw" && drag.weekday === day.weekday && drag.moved ? drag : null;
        return (
          <div key={day.weekday} className="min-w-[120px] flex-1 border-r border-[#eef1f5] last:border-r-0">
            <div className={`flex h-12 flex-col justify-center border-b border-[#d9dee7] px-2 ${day.holiday || day.without ? "bg-[#fbf3e4]" : ""}`}>
              <span className="text-sm font-semibold text-[#344054]">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day.weekday - 1]}{" "}
                <span className="font-normal text-[#667085]">{day.date ? formatDayAndMonth(day.date) : ""}</span>
              </span>
              {day.holiday || day.without ? (
                <span className="truncate text-[11px] font-medium text-[#8a6116]" title={day.holiday}>
                  {day.without ? "No classes this week" : `Holiday · ${day.holiday || "no classes"}`}
                </span>
              ) : null}
            </div>
            <div
              ref={(node) => {
                if (node) columns.current.set(day.weekday, node);
                else columns.current.delete(day.weekday);
              }}
              data-weekday={day.weekday}
              aria-label={`${["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][day.weekday - 1]}: drag to add a class`}
              className={`relative cursor-cell ${day.holiday || day.without ? "bg-[#fdf9f1]" : ""}`}
              style={{
                height,
                backgroundImage: `repeating-linear-gradient(to bottom, #eef1f5 0, #eef1f5 1px, transparent 1px, transparent ${hourHeight}px)`,
              }}
              onPointerDown={(event) => startDraw(event, day.weekday)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(SECTION_DRAG)) event.preventDefault();
              }}
              onDrop={(event) => {
                const sectionId = event.dataTransfer.getData(SECTION_DRAG);
                if (!sectionId) return;
                event.preventDefault();
                const start = inDay(snap(minutesAt(event.clientY, day.weekday)));
                onDropSection(sectionId, {
                  weekday: day.weekday,
                  startsAt: timeOf(start),
                  endsAt: timeOf(Math.min(toHour * 60, start + USUAL)),
                });
              }}
            >
              {drawing ? (
                <div
                  className="pointer-events-none absolute inset-x-1 rounded-md border-2 border-dashed border-[#1f4e79] bg-[#e8edf3]/70 px-1.5 text-[11px] font-semibold text-[#1f4e79]"
                  style={{
                    top: ((Math.min(drawing.from, drawing.to) - top) / 60) * hourHeight,
                    height: (Math.abs(drawing.to - drawing.from) / 60) * hourHeight,
                  }}
                >
                  {timeOf(Math.min(drawing.from, drawing.to))}–{timeOf(Math.max(drawing.from, drawing.to))}
                </div>
              ) : null}
              {own.map((entry) => {
                const where = shown(entry);
                const lane = lanes.get(entry) ?? { lane: 0, of: 1 };
                const its = clashes.get(entry) ?? [];
                const dragging = drag && drag.kind !== "draw" && drag.entry === entry && drag.moved;
                const tall = ((where.end - where.start) / 60) * hourHeight;
                const why = its.map((clash) => `${CLASH_WORDS[clash.kind]} as ${labelOf(clash.with)} (${clash.with.startsAt}–${clash.with.endsAt})`);
                return (
                  <div
                    key={`${entry.seriesId}-${entry.week}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${labelOf(entry)}, ${timeOf(where.start)} to ${timeOf(where.end)}`}
                    title={[labelOf(entry), ...detailOf(entry), entry.moved ? "Changed on its own, apart from its series" : "", ...why].filter(Boolean).join("\n")}
                    onPointerDown={(event) => startMove(event, entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpen(entry);
                      }
                    }}
                    className={`absolute overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-sm ${
                      dragging ? "z-20 cursor-grabbing opacity-90 ring-2 ring-[#1f4e79]" : "cursor-grab"
                    } ${its.length ? "ring-2 ring-[#d92d20] ring-offset-1" : ""}`}
                    style={{
                      top: ((where.start - top) / 60) * hourHeight + 1,
                      height: Math.max(14, tall - 2),
                      left: `calc(${(lane.lane / lane.of) * 100}% + 2px)`,
                      width: `calc(${100 / lane.of}% - 4px)`,
                      background: colorOf(entry),
                    }}
                  >
                    <span className="flex items-center gap-1 font-semibold">
                      {its.length ? <AlertTriangle size={11} className="shrink-0 text-[#ffd6d2]" aria-hidden="true" /> : null}
                      {entry.moved ? <Repeat size={10} className="shrink-0 opacity-80" aria-label="changed on its own" /> : null}
                      <span className="truncate">{labelOf(entry)}</span>
                    </span>
                    {tall > 26
                      ? detailOf(entry).map((line) => (
                          <span key={line} className="block truncate opacity-90">
                            {line}
                          </span>
                        ))
                      : null}
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                      onPointerDown={(event) => startStretch(event, entry)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
