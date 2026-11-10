import { Flag } from "lucide-react";

import type { Breach, WishCheck, WishCollection } from "@/services/teacherWishes";

export type WishView = "week" | "all" | "teachers";

const VIEWS: { value: WishView; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "all", label: "All weeks" },
  { value: "teachers", label: "By teacher" },
];

function Level({ breach }: { breach: Pick<Breach, "about" | "level"> }) {
  if (breach.about === "period") {
    return <span className="shrink-0 rounded bg-[#fdf6e3] px-1.5 text-[11px] font-semibold text-[#8a6116]">Everybody</span>;
  }
  return breach.level === "must" ? (
    <span className="shrink-0 rounded bg-[#fdf3f3] px-1.5 text-[11px] font-semibold text-[#a6292f]">Must</span>
  ) : (
    <span className="shrink-0 rounded bg-[#fdf6e3] px-1.5 text-[11px] font-semibold text-[#8a6116]">Would like</span>
  );
}

/** "Weeks 1–3, 5": the weeks a wish is broken in, said as runs. */
function weeksSaid(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let index = 0; index < sorted.length; index += 1) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    runs.push(end > index ? `${sorted[index]}–${sorted[end]}` : `${sorted[index]}`);
    index = end;
  }
  return `${sorted.length === 1 ? "Week" : "Weeks"} ${runs.join(", ")}`;
}

/**
 * The teachers' wishes the plan breaks, beside the week: this week's, every week's, or how
 * well each teacher is served — the least served first, so broken wishes are spread rather
 * than always landing on the same people. A line is pressed to show that teacher's week.
 */
export function PlanWishesPanel({
  check,
  collection,
  week,
  view,
  onView,
  onFocus,
  failed,
}: {
  check: WishCheck | null;
  collection: WishCollection | null;
  /** The teaching week on screen, or null between weeks. */
  week: number | null;
  view: WishView;
  onView: (view: WishView) => void;
  /** Show this teacher's wishes on the grid. */
  onFocus: (teacherId: string) => void;
  failed?: string;
}) {
  const breaches = check?.breaches ?? [];
  const thisWeek = breaches.filter((breach) => breach.week === week);
  const order = (left: Breach, right: Breach) =>
    Number(left.level !== "must") - Number(right.level !== "must") || left.teacherName.localeCompare(right.teacherName);

  // Every week's, one line per wish broken, with the weeks it is broken in.
  const grouped = new Map<string, { breach: Breach; weeks: number[]; classes: number }>();
  for (const breach of breaches) {
    const key = `${breach.about}|${breach.teacherId}|${breach.key}`;
    const held = grouped.get(key) ?? { breach, weeks: [], classes: 0 };
    held.weeks.push(breach.week);
    held.classes += breach.classes.length;
    grouped.set(key, held);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 gap-2 border-b border-[#eef1f5] px-3 py-2.5">
        <div role="group" aria-label="Which wishes" className="flex flex-wrap gap-1.5">
          {VIEWS.map((option) => {
            const on = view === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => onView(option.value)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                  on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        {failed ? <p className="text-xs text-[#a6292f]">{failed}</p> : null}
        {!collection && !failed ? (
          <p className="text-xs text-[#667085]">
            No wishes collected for this semester yet. Open the collection on the Timetable wishes page, under Teachers.
          </p>
        ) : null}
        {check?.unanswered.length ? (
          <p className="text-xs text-[#667085]" title={check.unanswered.join(", ")}>
            {check.unanswered.length} teacher{check.unanswered.length === 1 ? " hasn't" : "s haven't"} answered yet.
          </p>
        ) : null}
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-[#f2f4f7] overflow-y-auto" aria-label="Broken wishes">
        {view === "week"
          ? [...thisWeek].sort(order).map((breach, index) => (
              <li key={`${breach.key}-${breach.teacherId}-${index}`}>
                <button
                  type="button"
                  onClick={() => breach.teacherId && onFocus(breach.teacherId)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]"
                >
                  <Level breach={breach} />
                  <span className="min-w-0 flex-1 text-xs">
                    <span className="block font-semibold text-[#344054]">
                      {breach.about === "period" ? breach.wish : `${breach.teacherName} · ${breach.wish}`}
                    </span>
                    <span className="block text-[#667085]">{breach.how}</span>
                  </span>
                </button>
              </li>
            ))
          : null}
        {view === "all"
          ? [...grouped.values()]
              .sort((left, right) => order(left.breach, right.breach))
              .map(({ breach, weeks, classes }) => (
                <li key={`${breach.about}|${breach.teacherId}|${breach.key}`}>
                  <button
                    type="button"
                    onClick={() => breach.teacherId && onFocus(breach.teacherId)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-[#f8fafc]"
                  >
                    <Level breach={breach} />
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block font-semibold text-[#344054]">
                        {breach.about === "period" ? breach.wish : `${breach.teacherName} · ${breach.wish}`}
                      </span>
                      <span className="block text-[#667085]">
                        {weeksSaid(weeks)} · {classes} class{classes === 1 ? "" : "es"}
                      </span>
                    </span>
                  </button>
                </li>
              ))
          : null}
        {view === "teachers"
          ? (check?.tallies ?? []).map((tally) => {
              const lostMust = tally.musts - tally.mustsKept;
              return (
                <li key={tally.teacherId}>
                  <button
                    type="button"
                    onClick={() => onFocus(tally.teacherId)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-[#f8fafc]"
                  >
                    <Flag
                      size={11}
                      aria-hidden="true"
                      className={lostMust ? "text-[#a6292f]" : tally.woulds - tally.wouldsKept ? "text-[#d99b1c]" : "text-[#cfd8e3]"}
                      fill="currentColor"
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-[#344054]">
                      {tally.teacherName}
                      {tally.status === "draft" ? <span className="ml-1 font-normal text-[#98a2b3]">(draft)</span> : null}
                    </span>
                    <span className="shrink-0 tabular-nums text-[#667085]">
                      {tally.musts ? `${tally.mustsKept} of ${tally.musts} Musts` : "no Musts"} ·{" "}
                      {tally.woulds ? `${tally.wouldsKept} of ${tally.woulds} wishes` : "no wishes"}
                    </span>
                  </button>
                </li>
              );
            })
          : null}
        {(view === "week" && !thisWeek.length) || (view === "all" && !grouped.size) ? (
          <li className="px-3 py-6 text-center text-xs text-[#98a2b3]">
            {collection || breaches.length ? "Nothing broken." : ""}
          </li>
        ) : null}
        {view === "teachers" && !(check?.tallies ?? []).length ? (
          <li className="px-3 py-6 text-center text-xs text-[#98a2b3]">No teacher with classes here has answered yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
