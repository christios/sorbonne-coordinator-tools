import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";

import { fetchTermWeeks, setWeekOne, setWeeksWithout } from "@/services/termWeeks";
import { fetchTimetableTerms } from "@/services/timetables";
import { MONTH_NAMES, isoToday, mondayOf, parseIsoDate, weekNumber } from "@/services/weekSchedule";

/** "Mon 31 Aug 2026" — the Monday Week 1 is counted from. */
function mondayWords(day: string): string {
  const monday = mondayOf(parseIsoDate(day));
  return `Mon ${monday.getDate()} ${MONTH_NAMES[monday.getMonth()]} ${monday.getFullYear()}`;
}

/** "12 – 16 Oct 2026": a week without classes, Monday to Friday. */
function weekWords(monday: string): string {
  const from = parseIsoDate(monday);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 4);
  const start = from.getMonth() === to.getMonth() ? `${from.getDate()}` : `${from.getDate()} ${MONTH_NAMES[from.getMonth()]}`;
  return `${start} – ${to.getDate()} ${MONTH_NAMES[to.getMonth()]} ${to.getFullYear()}`;
}

/**
 * Each semester's Week 1, which the semester timetable counts its weeks from, and the weeks
 * it has no classes in, which the count skips.
 *
 * Any day of the first teaching week will do; the week it falls in is Week 1. A week without
 * classes — a break, 12 to 16 October — is not counted, as the timetable does not count it:
 * the week after it is the next number. Everybody can see both, so a coordinator knows what
 * "Week 5" is counted from; an administrator sets them, since they change the week numbers
 * everybody sees.
 */
export function TermWeeksPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const weeks = useQuery({ queryKey: ["term-weeks"], queryFn: fetchTermWeeks, retry: false });
  const save = useMutation({
    mutationFn: ({ termId, day }: { termId: string; day: string }) => setWeekOne(termId, day),
    onSuccess: (next) => client.setQueryData(["term-weeks"], next),
  });
  const saveWithout = useMutation({
    mutationFn: ({ termId, days }: { termId: string; days: string[] }) => setWeeksWithout(termId, days),
    onSuccess: (next) => client.setQueryData(["term-weeks"], next),
  });
  const today = isoToday();

  if (terms.isLoading || weeks.isLoading) return <p className="text-sm text-[#667085]">Reading the semesters…</p>;
  if (terms.isError) {
    return <p className="text-sm text-[#a6292f]">The semesters could not be read from the Student Hub.</p>;
  }
  const failed = save.error || saveWithout.error;
  return (
    <div>
      <ul aria-label="Semesters" className="divide-y divide-[#eef1f5] rounded-lg border border-[#d9dee7] bg-white">
        {(terms.data ?? []).map((term) => {
          const calendar = weeks.data?.[term.id];
          const day = calendar?.weekOne ?? "";
          const without = calendar?.without ?? [];
          const now = calendar ? weekNumber(parseIsoDate(today), calendar) : 0;
          return (
            <li key={term.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
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
                    {now === null ? " · this week has no classes" : now >= 1 ? ` · this is Week ${now}` : " · not started yet"}
                  </span>
                ) : null}
              </div>
              {/*
                * The weeks the count skips, once there is a Week 1 to count from: a chip each,
                * and any day of another week to add it.
                */}
              {day && (canChange || without.length) ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:ml-[10.75rem]">
                  <span className="text-xs text-[#667085]">Weeks without classes</span>
                  {without.length === 0 ? <span className="text-xs text-[#98a2b3]">none</span> : null}
                  {without.map((monday) => (
                    <span
                      key={monday}
                      className="inline-flex items-center gap-1 rounded-full bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#344054]"
                    >
                      {weekWords(monday)}
                      {canChange ? (
                        <button
                          type="button"
                          aria-label={`Count the week of ${weekWords(monday)} again`}
                          disabled={saveWithout.isPending}
                          onClick={() => saveWithout.mutate({ termId: term.id, days: without.filter((other) => other !== monday) })}
                          className="-mr-1 rounded-full p-0.5 text-[#98a2b3] hover:bg-white hover:text-[#a6292f]"
                        >
                          <X size={11} aria-hidden="true" />
                        </button>
                      ) : null}
                    </span>
                  ))}
                  {canChange ? (
                    <input
                      type="date"
                      aria-label={`Add a week without classes to ${term.name}`}
                      value=""
                      disabled={saveWithout.isPending}
                      onChange={(event) =>
                        event.target.value && saveWithout.mutate({ termId: term.id, days: [...without, event.target.value] })
                      }
                      className="rounded-md border border-[#cbd5e1] px-2 py-0.5 text-xs text-[#344054]"
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-[#98a2b3]">
        A week without classes is not counted: the week after it takes the next number, and the timetable says &ldquo;No
        classes&rdquo; for it.
      </p>
      {canChange ? null : <p className="mt-2 text-xs text-[#98a2b3]">Only an administrator can set where a semester&apos;s weeks start.</p>}
      {failed ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">
          {(failed as Error).message}
        </p>
      ) : null}
    </div>
  );
}
