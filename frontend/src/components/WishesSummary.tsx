import { Pencil } from "lucide-react";

import { BlockList, KindTag, RowTime, WishesLegend, finenessOf, ruleOf, toneOf } from "@/components/WishesForm";
import { DAY_NAMES, DAY_SHORT, STEP, clockOf, describeLine, weekOf, type WishCollection, type WishLimits, type Wishes } from "@/services/teacherWishes";

/** "10 Nov 2026, 14:05". */
const when = (value: string) =>
  value ? new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

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

const LIMIT_NAMES: (keyof WishLimits)[] = ["maxDays", "maxHoursDay", "maxInRow", "freeDay"];

/**
 * A teacher's answer, read and not changed: every block in words — how it repeats and why —
 * their usual week shaded, their limits, needs and note, and who gave it when. Changing it is
 * a step of its own (`onEdit`), so an answer is not altered by a stray click.
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
  const grid = { firstHour: collection.firstHour, lastHour: collection.lastHour };
  // The usual week: the blocks that repeat every week, as any week of the semester shows them.
  const usual = wishes.blocks.filter((block) => block.repeat === "all");
  const held = weekOf(usual, "");
  // As finely as the answer needs: hours, unless something starts on the half or a quarter.
  const size = finenessOf(usual);
  const rows = Array.from({ length: Math.round((collection.lastHour - collection.firstHour) / size) }, (_, index) => collection.firstHour + index * size);
  const quartersOf = (time: number) => Array.from({ length: Math.round(size / STEP) }, (_, index) => time + index * STEP);
  const limits = LIMIT_NAMES.filter((limit) => wishes.limits[limit]);
  const Yours = voice === "you" ? "Your" : "Their";

  return (
    <div className="grid gap-5">
      <p className="text-sm text-[#667085]">{answeredBy(name, wishes, voice)}</p>

      <section className="grid gap-2" aria-label={`${Yours} week`}>
        <h3 className="text-sm font-semibold text-[#171717]">{Yours} week</h3>
        <BlockList blocks={wishes.blocks} grid={grid} voice={voice} />
        {usual.length ? (
          <>
            <p className="mt-2 text-xs font-semibold text-[#667085]">Every week</p>
            <table className="w-full table-fixed border-collapse text-[11px]" aria-label="The usual week">
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
                      const quarters = quartersOf(time).map((hour) => ({ hour, block: held.get(`${day}:${hour}`) ?? null }));
                      const block = quarters.find((quarter) => quarter.block)?.block ?? null;
                      return (
                        <td key={day} className={`border-x border-[#c8d0db] p-0 ${row === rows.length - 1 ? "border-b" : ""}`}>
                          <div
                            title={block ? `${block.kind === "constraint" ? "Constraint" : "Preference"}${block.comment ? ` — ${block.comment}` : ""}` : undefined}
                            aria-label={`${DAY_NAMES[day]} ${clockOf(time)}: ${block ? block.kind : "fine"}`}
                            className="flex flex-col overflow-hidden bg-white"
                            style={{ height: size === 1 ? 20 : size === 0.5 ? 14 : 10 }}
                          >
                            {quarters.map((quarter) => (
                              <span
                                key={quarter.hour}
                                className={`block min-h-0 flex-1 ${quarter.block || quarter.hour !== time ? "" : ruleOf(quarter.hour)}`}
                                style={quarter.block ? toneOf(quarter.block) : undefined}
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
        ) : null}
        {wishes.overCapReason ? (
          <p className="text-xs text-[#667085]">
            <span className="font-semibold text-[#344054]">Why so many hours of constraints:</span> {wishes.overCapReason}
          </p>
        ) : null}
      </section>

      <section className="grid gap-2" aria-label="Limits">
        <h3 className="text-sm font-semibold text-[#171717]">Limits</h3>
        {limits.length ? (
          <ul className="grid gap-2">
            {limits.map((limit) => (
              <li key={limit} className="flex items-start gap-2 text-sm">
                <KindTag kind={wishes.limitKinds[limit] ?? "preference"} />
                <span className="min-w-0">
                  <span className="text-[#344054]">{describeLine({ key: limit, kind: limit, value: wishes.limits[limit]! })}</span>
                  {wishes.comments?.[limit] ? <span className="block text-xs text-[#667085]">&ldquo;{wishes.comments[limit]}&rdquo;</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#98a2b3]">No limits.</p>
        )}
      </section>

      {wishes.needs || wishes.note ? (
        <section className="grid gap-2 text-sm" aria-label="Needs and a note">
          <h3 className="text-sm font-semibold text-[#171717]">Needs and a note</h3>
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
