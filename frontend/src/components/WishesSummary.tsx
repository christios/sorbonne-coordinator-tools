import { Pencil } from "lucide-react";

import { AWAY_TONE, CELL_TONES, RowTime, WishesLegend, finenessOf, ruleOf } from "@/components/WishesForm";
import { DAY_NAMES, DAY_SHORT, STEP, awayWords, clockOf, describeLine, lineOfCell, wishLines, type WishCollection, type Wishes } from "@/services/teacherWishes";

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

/** Who gave an answer and when: the teacher themself, or a coordinator for them. To the teacher, only when. */
export function answeredBy(name: string, wishes: Wishes, voice: "they" | "you" = "they"): string {
  if (voice === "you") {
    return wishes.status === "submitted"
      ? `Submitted${wishes.submittedAt ? ` ${when(wishes.submittedAt)}` : ""}`
      : `A draft, saved${wishes.updatedAt ? ` ${when(wishes.updatedAt)}` : ""}`;
  }
  const by = wishes.source === "coordinator" ? `by ${wishes.updatedBy || "a coordinator"} for ${name}` : `by ${name}`;
  return wishes.status === "submitted"
    ? `Submitted ${by}${wishes.submittedAt ? `, ${when(wishes.submittedAt)}` : ""}`
    : `A draft, saved ${by}${wishes.updatedAt ? `, ${when(wishes.updatedAt)}` : ""}`;
}

/**
 * A teacher's answer, read and not changed: their week shaded as they painted it, each
 * preference with how much it matters and why, their time away, needs and note, and who gave it when.
 * Changing it is a step of its own (`onEdit`), so an answer is not altered by a stray click.
 */
export function WishesSummary({
  name,
  collection,
  wishes,
  onEdit,
  editLabel = "Edit their answer",
  voice = "they",
}: {
  name: string;
  collection: WishCollection;
  wishes: Wishes;
  /** Left out where the answer can no longer be changed. */
  onEdit?: () => void;
  editLabel?: string;
  voice?: "they" | "you";
}) {
  const lines = wishLines(wishes.cells, wishes.limits);
  const levelOf = (key: string) => wishes.levels[key] ?? "would";
  const ranked = [...lines].sort((left, right) => Number(levelOf(left.key) !== "must") - Number(levelOf(right.key) !== "must"));
  const kinds = new Map(wishes.cells.map((cell) => [`${cell.day}:${cell.hour}`, cell.kind]));
  // As finely as the answer needs: hours, unless something starts on the half or a quarter.
  const size = finenessOf(wishes.cells);
  const rows = Array.from({ length: Math.round((collection.lastHour - collection.firstHour) / size) }, (_, index) => collection.firstHour + index * size);
  const quartersOf = (time: number) => Array.from({ length: Math.round(size / STEP) }, (_, index) => time + index * STEP);

  return (
    <div className="grid gap-5">
      <p className="text-sm text-[#667085]">{answeredBy(name, wishes, voice)}</p>

      <section className="grid gap-2" aria-label="Their week">
        <h3 className="text-sm font-semibold text-[#171717]">{voice === "you" ? "Your" : "Their"} week</h3>
        {wishes.cells.length ? (
          <>
            <table className="mt-1.5 w-full table-fixed border-collapse text-[11px]" aria-label="The week as painted">
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
                    <th className="pr-1.5 text-right align-top font-normal tabular-nums leading-none">
                      <RowTime time={time} size={size} />
                    </th>
                    {collection.days.map((day) => {
                      const quarters = quartersOf(time).map((hour) => {
                        const kind = kinds.get(`${day}:${hour}`);
                        const line = kind ? lineOfCell(lines, day, hour, kind) : null;
                        return { hour, kind, line, level: line ? levelOf(line.key) : "would" };
                      });
                      const line = quarters.find((quarter) => quarter.line)?.line ?? null;
                      const comment = line ? wishes.comments?.[line.key] : "";
                      const kind = quarters.find((quarter) => quarter.kind)?.kind;
                      return (
                        <td key={day} className={`border-x border-[#c8d0db] p-0 ${row === rows.length - 1 ? "border-b" : ""}`}>
                          <div
                            title={line ? `${describeLine(line)} · ${levelOf(line.key) === "must" ? "Must" : "Would like"}${comment ? ` — ${comment}` : ""}` : undefined}
                            aria-label={`${DAY_NAMES[day]} ${clockOf(time)}: ${kind === "cant" ? "can't teach" : kind === "prefer" ? "would rather" : "fine"}`}
                            className="flex flex-col overflow-hidden bg-white"
                            style={{ height: size === 1 ? 20 : size === 0.5 ? 14 : 10 }}
                          >
                            {quarters.map((quarter) => (
                              <span
                                key={quarter.hour}
                                className={`block min-h-0 flex-1 ${quarter.kind || quarter.hour !== time ? "" : ruleOf(quarter.hour)}`}
                                style={quarter.kind ? CELL_TONES[quarter.kind][quarter.level] : undefined}
                              />
                            ))}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <WishesLegend />
          </>
        ) : (
          <p className="text-sm text-[#98a2b3]">Nothing painted: every hour is fine.</p>
        )}
      </section>

      <section className="grid gap-2" aria-label="Their preferences">
        <h3 className="text-sm font-semibold text-[#171717]">
          Preferences{" "}
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
          <p className="text-sm text-[#98a2b3]">No preferences.</p>
        )}
        {wishes.overCapReason ? (
          <p className="text-xs text-[#667085]">
            <span className="font-semibold text-[#344054]">Why so many hours can&rsquo;t be taught:</span> {wishes.overCapReason}
          </p>
        ) : null}
      </section>

      {wishes.away.length || wishes.needs || wishes.note ? (
        <section className="grid gap-2 text-sm" aria-label="Time away and needs">
          <h3 className="text-sm font-semibold text-[#171717]">Time away and needs</h3>
          {wishes.away.length ? (
            <ul className="grid gap-1">
              {wishes.away.map((entry) => (
                <li key={`${entry.from}-${entry.to}-${entry.start ?? ""}`} className="flex items-baseline gap-2 text-[#344054]">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={AWAY_TONE} />
                  <span>
                    Away {awayWords(entry)}
                    {entry.reason ? <span className="text-[#667085]"> · {entry.reason}</span> : null}
                  </span>
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

      {onEdit ? (
        <div className="border-t border-[#eef1f5] pt-3">
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline">
            <Pencil size={14} aria-hidden="true" /> {editLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
