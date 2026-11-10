import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import {
  DAY_NAMES,
  DAY_SHORT,
  cantHours,
  describeLine,
  wishLines,
  type WishAway,
  type WishCell,
  type WishCollection,
  type WishKind,
  type WishLevel,
  type WishLimits,
  type Wishes,
  type WishesInput,
} from "@/services/teacherWishes";

type Brush = WishKind | "erase";

const BRUSHES: { value: Brush; label: string; on: string; swatch: string }[] = [
  { value: "cant", label: "Can't teach", on: "border-[#a6292f] bg-[#fdf3f3] text-[#a6292f]", swatch: "bg-[#e9a3a6]" },
  { value: "prefer", label: "Would rather", on: "border-[#2e7d55] bg-[#f2f9f4] text-[#2e7d55]", swatch: "bg-[#9fd0b4]" },
  { value: "erase", label: "Clear", on: "border-[#667085] bg-[#f2f4f7] text-[#344054]", swatch: "bg-white border border-[#d0d5dd]" },
];

const CELL: Record<WishKind | "none", string> = {
  cant: "bg-[#e9a3a6] hover:bg-[#df8a8e]",
  prefer: "bg-[#9fd0b4] hover:bg-[#87c3a1]",
  none: "bg-white hover:bg-[#f2f4f7]",
};

const section = "border-t border-[#eef1f5] pt-4";
const heading = "text-sm font-semibold text-[#171717]";
const hint = "mt-0.5 text-xs text-[#667085]";
const field = "w-full rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm";

const NONE = "";

/**
 * One teacher's timetable wishes for a semester: the week painted, limits, dates away,
 * needs, and which wishes are a Must.
 *
 * The same four parts wherever a teacher answers — here for a coordinator answering for
 * them, and on the page an invited teacher opens. The Must quota is enforced as the teacher
 * chooses, not after: past it, the other Must buttons wait until one is let go.
 */
export function WishesForm({
  collection,
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  collection: WishCollection;
  initial: Wishes | null;
  busy?: boolean;
  error?: string;
  onSave: (input: WishesInput) => void;
  onCancel?: () => void;
}) {
  const [cells, setCells] = useState<Map<string, WishKind>>(
    () => new Map((initial?.cells ?? []).map((cell) => [`${cell.day}:${cell.hour}`, cell.kind])),
  );
  const [limits, setLimits] = useState<WishLimits>(initial?.limits ?? {});
  const [away, setAway] = useState<WishAway[]>(initial?.away ?? []);
  const [needs, setNeeds] = useState(initial?.needs ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
  const [levels, setLevels] = useState<Record<string, WishLevel>>(initial?.levels ?? {});
  const [reason, setReason] = useState(initial?.overCapReason ?? "");
  const [brush, setBrush] = useState<Brush>("cant");
  // The stroke under way: its colour and the cell it last reached.
  const stroke = useRef<{ with_: Brush; at: [number, number] } | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    const stop = () => {
      stroke.current = null;
    };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

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
  const cant = cantHours(asList);
  const overCap = cant > collection.cantCap;

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

  const limitMenu = (name: keyof WishLimits, label: string, options: { value: string; label: string }[]) => (
    <label className="block">
      <span className="text-xs font-semibold text-[#344054]">{label}</span>
      <div className="mt-1">
        <SelectMenu
          label={label}
          value={limits[name] ? String(limits[name]) : NONE}
          onChange={(value) => setLimits((current) => ({ ...current, [name]: value ? Number(value) : null }))}
          options={[{ value: NONE, label: "No limit" }, ...options]}
        />
      </div>
    </label>
  );
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
      overCapReason: overCap ? reason : "",
      submit: finished,
    });
  };

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------------- their week */}
      <div>
        <p className={heading}>1 · Their week</p>
        <p className={hint}>Choose a colour, then click or drag across the hours. Hours left white are fine.</p>
        <div role="radiogroup" aria-label="Paint with" className="mt-2 flex flex-wrap gap-1.5">
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
              <span className={`inline-block h-2.5 w-2.5 rounded-sm ${option.swatch}`} /> {option.label}
            </button>
          ))}
          <span className={`ml-auto self-center text-xs tabular-nums ${overCap ? "font-semibold text-[#a6292f]" : "text-[#667085]"}`}>
            Can&rsquo;t teach: {cant} of {collection.cantCap} h a week
          </span>
        </div>
        <div className="mt-2 overflow-x-auto">
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
                    // Painting a cell already that colour clears it: the one stroke takes it back.
                    const brushHere = brush !== "erase" && kind === brush ? "erase" : brush;
                    return (
                      <td key={day} className="p-0">
                        <button
                          type="button"
                          aria-label={`${DAY_NAMES[day]} ${hour}:00: ${kind === "cant" ? "can't teach" : kind === "prefer" ? "would rather" : "fine"}`}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            stroke.current = { with_: brushHere, at: here };
                            paint(here, here, brushHere);
                          }}
                          onPointerEnter={() => {
                            const held = stroke.current;
                            if (!held) return;
                            paint(held.at, here, held.with_);
                            held.at = here;
                          }}
                          onClick={(event) => {
                            // Enter or Space on a cell: the pointer paints on press, the keyboard here.
                            if (event.detail === 0) paint(here, here, brushHere);
                          }}
                          className={`block h-6 w-full border border-[#eef1f5] ${CELL[kind ?? "none"]}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* -------------------------------------------------------------- limits */}
      <div className={section}>
        <p className={heading}>2 · Limits on their week</p>
        <p className={hint}>Only those that matter: each one set is a wish to rank below.</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {limitMenu("maxDays", "Most days on campus", counts(1, Math.max(1, collection.days.length - 1), "day"))}
          {limitMenu("maxHoursDay", "Most hours in a day", counts(2, 10, "hour"))}
          {limitMenu("maxInRow", "Most hours in a row", counts(1, 8, "hour"))}
          {limitMenu(
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
                placeholder="Conference, leave…"
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

      {/* -------------------------------------------------------------- what matters most */}
      <div className={section}>
        <p className={heading}>4 · What matters most</p>
        <p className={hint}>
          Mark at most {collection.mustQuota} as a <b>Must</b>; the rest are <b>Would like</b>. Musts are kept first.
        </p>
        {lines.length ? (
          <>
            <p className={`mt-1 text-xs tabular-nums ${musts >= collection.mustQuota ? "font-semibold text-[#1f4e79]" : "text-[#667085]"}`}>
              {musts} of {collection.mustQuota} Musts used
            </p>
            <ul className="mt-2 divide-y divide-[#f2f4f7] rounded-md border border-[#e4e8ef]" aria-label="Wishes">
              {lines.map((line) => {
                const level = levelOf(line.key);
                const full = level !== "must" && musts >= collection.mustQuota;
                return (
                  <li key={line.key} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm text-[#344054]">{describeLine(line)}</span>
                    <div role="radiogroup" aria-label={describeLine(line)} className="inline-flex rounded-md border border-[#d0d5dd] p-0.5 text-xs font-semibold">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={level === "must"}
                        disabled={full}
                        title={full ? `Choose which ${collection.mustQuota} matter most: let another Must go first` : undefined}
                        onClick={() => setLevels((current) => ({ ...current, [line.key]: "must" }))}
                        className={`rounded px-2 py-0.5 ${level === "must" ? "bg-[#a6292f] text-white" : "text-[#344054] disabled:text-[#c8d0da]"}`}
                      >
                        Must
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={level === "would"}
                        onClick={() => setLevels((current) => ({ ...current, [line.key]: "would" }))}
                        className={`rounded px-2 py-0.5 ${level === "would" ? "bg-[#d99b1c] text-white" : "text-[#344054]"}`}
                      >
                        Would like
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <p className="mt-2 text-xs text-[#98a2b3]">Paint the week or set a limit, and each wish appears here to rank.</p>
        )}
        {overCap ? (
          <label className="mt-3 block">
            <span className="text-xs font-semibold text-[#a6292f]">
              {cant} hours can&rsquo;t be taught, over the {collection.cantCap} a week: say why, for the coordinator
            </span>
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className={`mt-1 ${field}`} />
          </label>
        ) : null}
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
