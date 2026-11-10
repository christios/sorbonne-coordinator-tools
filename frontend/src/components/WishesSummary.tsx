import { Pencil } from "lucide-react";

import { CELL_TONES } from "@/components/WishesForm";
import { DAY_NAMES, DAY_SHORT, describeLine, lineOfCell, wishLines, type WishCollection, type Wishes } from "@/services/teacherWishes";
import { formatDayAndMonth } from "@/services/weekSchedule";

/** "10 Nov 2026, 14:05". */
const when = (value: string) =>
  value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

function Level({ must }: { must: boolean }) {
  return must ? (
    <span className="shrink-0 rounded bg-[#fdf3f3] px-1.5 text-[11px] font-semibold text-[#a6292f]">Must</span>
  ) : (
    <span className="shrink-0 rounded bg-[#fdf6e3] px-1.5 text-[11px] font-semibold text-[#8a6116]">Would like</span>
  );
}

/** Who gave an answer and when: the teacher themself, or a coordinator for them. */
export function answeredBy(name: string, wishes: Wishes): string {
  const by = wishes.source === "coordinator" ? `by ${wishes.updatedBy || "a coordinator"} for ${name}` : `by ${name}`;
  return wishes.status === "submitted"
    ? `Submitted ${by}${wishes.submittedAt ? `, ${when(wishes.submittedAt)}` : ""}`
    : `A draft, saved ${by}${wishes.updatedAt ? `, ${when(wishes.updatedAt)}` : ""}`;
}

/**
 * A teacher's answer, read and not changed: their week shaded as they painted it, each wish
 * with how much it matters and why, their dates away, needs and note, and who gave it when.
 * Changing it is a step of its own (`onEdit`), so an answer is not altered by a stray click.
 */
export function WishesSummary({
  name,
  collection,
  wishes,
  onEdit,
}: {
  name: string;
  collection: WishCollection;
  wishes: Wishes;
  onEdit: () => void;
}) {
  const lines = wishLines(wishes.cells, wishes.limits);
  const levelOf = (key: string) => wishes.levels[key] ?? "would";
  const ranked = [...lines].sort((left, right) => Number(levelOf(left.key) !== "must") - Number(levelOf(right.key) !== "must"));
  const kinds = new Map(wishes.cells.map((cell) => [`${cell.day}:${cell.hour}`, cell.kind]));
  const hours = Array.from({ length: collection.lastHour - collection.firstHour }, (_, index) => collection.firstHour + index);

  return (
    <div className="grid gap-5">
      <p className="text-sm text-[#667085]">{answeredBy(name, wishes)}</p>

      <section className="grid gap-2" aria-label="Their week">
        <h3 className="text-sm font-semibold text-[#171717]">Their week</h3>
        {wishes.cells.length ? (
          <>
            <table className="w-full table-fixed border-collapse text-[11px]" aria-label="The week as painted">
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
                    {collection.days.map((day) => {
                      const kind = kinds.get(`${day}:${hour}`);
                      const line = kind ? lineOfCell(lines, day, hour, kind) : null;
                      const level = line ? levelOf(line.key) : "would";
                      const comment = line ? wishes.comments?.[line.key] : "";
                      return (
                        <td key={day} className="p-0">
                          <div
                            title={line ? `${describeLine(line)} · ${level === "must" ? "Must" : "Would like"}${comment ? ` — ${comment}` : ""}` : undefined}
                            aria-label={`${DAY_NAMES[day]} ${hour}:00: ${kind === "cant" ? "can't teach" : kind === "prefer" ? "would rather" : "fine"}`}
                            className="h-5 border border-[#eef1f5] bg-white"
                            style={kind ? CELL_TONES[kind][level] : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#667085]">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.cant.must} />
                <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.cant.would} /> Can&rsquo;t teach
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.prefer.must} />
                <span className="inline-block h-3 w-3 rounded-sm" style={CELL_TONES.prefer.would} /> Would rather
              </span>
              <span>Solid is a Must, hatched a Would like.</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-[#98a2b3]">Nothing painted: every hour is fine.</p>
        )}
      </section>

      <section className="grid gap-2" aria-label="Their wishes">
        <h3 className="text-sm font-semibold text-[#171717]">
          Wishes{" "}
          <span className="font-normal text-[#98a2b3]">
            · {lines.filter((line) => levelOf(line.key) === "must").length} of {collection.mustQuota} Musts
          </span>
        </h3>
        {ranked.length ? (
          <ul className="grid gap-2">
            {ranked.map((line) => (
              <li key={line.key} className="flex items-start gap-2 text-sm">
                <Level must={levelOf(line.key) === "must"} />
                <span className="min-w-0">
                  <span className="text-[#344054]">{describeLine(line)}</span>
                  {wishes.comments?.[line.key] ? (
                    <span className="block text-xs text-[#667085]">&ldquo;{wishes.comments[line.key]}&rdquo;</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#98a2b3]">No wishes.</p>
        )}
        {wishes.overCapReason ? (
          <p className="text-xs text-[#667085]">
            <span className="font-semibold text-[#344054]">Why so many hours can&rsquo;t be taught:</span> {wishes.overCapReason}
          </p>
        ) : null}
      </section>

      {wishes.away.length || wishes.needs || wishes.note ? (
        <section className="grid gap-2 text-sm" aria-label="Dates away and needs">
          <h3 className="text-sm font-semibold text-[#171717]">Dates away and needs</h3>
          {wishes.away.length ? (
            <ul className="grid gap-1">
              {wishes.away.map((entry) => (
                <li key={`${entry.from}-${entry.to}`} className="text-[#344054]">
                  Away {entry.from === entry.to ? formatDayAndMonth(entry.from) : `${formatDayAndMonth(entry.from)}–${formatDayAndMonth(entry.to)}`}
                  {entry.reason ? <span className="text-[#667085]"> · {entry.reason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {wishes.needs ? (
            <p className="text-[#344054]">
              <span className="text-[#667085]">Needs:</span> {wishes.needs}
            </p>
          ) : null}
          {wishes.note ? (
            <p className="whitespace-pre-line text-[#344054]">
              <span className="text-[#667085]">Note:</span> {wishes.note}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="border-t border-[#eef1f5] pt-3">
        <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline">
          <Pencil size={14} aria-hidden="true" /> Edit their answer
        </button>
      </div>
    </div>
  );
}
