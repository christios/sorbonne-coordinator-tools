import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { fetchTermWeeks, setWeekOne } from "@/services/termWeeks";
import { fetchTimetableTerms } from "@/services/timetables";
import { MONTH_NAMES, isoToday, mondayOf, parseIsoDate, weekNumber } from "@/services/weekSchedule";

/** "Mon 31 Aug 2026" — the Monday Week 1 is counted from. */
function mondayWords(day: string): string {
  const monday = mondayOf(parseIsoDate(day));
  return `Mon ${monday.getDate()} ${MONTH_NAMES[monday.getMonth()]} ${monday.getFullYear()}`;
}

/**
 * Each semester's Week 1, which the semester timetable counts its weeks from.
 *
 * Any day of the first teaching week will do; the week it falls in is Week 1. Everybody can
 * see it, so a coordinator knows what "Week 5" is counted from; an administrator sets it,
 * since it changes the week numbers everybody sees.
 */
export function TermWeeksPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const weeks = useQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks, retry: false });
  const save = useMutation({
    mutationFn: ({ termId, day }: { termId: string; day: string }) => setWeekOne(termId, day),
    onSuccess: (next) => client.setQueryData(["term-weeks"], next),
  });
  const today = isoToday();

  if (terms.isLoading || weeks.isLoading) return <p className="text-sm text-[#667085]">Reading the semesters…</p>;
  if (terms.isError) {
    return <p className="text-sm text-[#a6292f]">The semesters could not be read from the Student Hub.</p>;
  }
  return (
    <div>
      <ul aria-label="Semesters" className="divide-y divide-[#eef1f5] rounded-lg border border-[#d9dee7] bg-white">
        {(terms.data ?? []).map((term) => {
          const day = weeks.data?.[term.id] ?? "";
          const now = day ? weekNumber(parseIsoDate(today), day) : 0;
          return (
            <li key={term.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="min-w-40 font-semibold text-[#171717]">{term.name}</span>
              {canChange ? (
                <label className="inline-flex items-center gap-2 text-xs text-[#667085]">
                  Week 1 starts
                  <input
                    type="date"
                    aria-label={`Week 1 of ${term.name}`}
                    value={day}
                    disabled={save.isPending}
                    onChange={(event) => save.mutate({ termId: term.id, day: event.target.value })}
                    className="rounded-md border border-[#cbd5e1] px-2 py-1 text-sm text-[#344054]"
                  />
                </label>
              ) : (
                <span className="text-xs text-[#667085]">{day ? "Week 1 starts" : "No Week 1 set"}</span>
              )}
              {day ? (
                <span className="text-xs text-[#98a2b3]">
                  counted from {mondayWords(day)}
                  {now >= 1 ? ` · this is Week ${now}` : " · not started yet"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canChange ? null : <p className="mt-4 text-xs text-[#98a2b3]">Only an administrator can set where a semester&apos;s weeks start.</p>}
      {save.error ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">
          {(save.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
