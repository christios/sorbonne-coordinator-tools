import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import { asHours, hoursTaught, minutesByTeacher } from "@/services/hoursInPeriod";
import {
  opensOnFor,
  periodContaining,
  periodEnd,
  periodLabel,
  PERIOD_OPENS_ON,
} from "@/services/payPeriods";
import { fetchActiveTeachers, fetchFacilitySections, fetchTermLinks } from "@/services/portalLists";
import { fetchSessionChanges } from "@/services/sessionChanges";
import { fetchCourseCards } from "@/services/studentDatabase";
import { buildCards } from "@/services/courseCards";
import { sectionsTaughtBy } from "@/services/teacherLoad";
import { fetchPayCycles, fetchTeacherSummary, listTeacherTimeSheets } from "@/services/teachers";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * What this teacher actually taught, period by period, against what they were contracted
 * for and the sheet filed for it.
 *
 * The semester figure elsewhere is a plan and has no dates in it. A claim is not a plan:
 * it is the classes that met in one pay period, less the ones cancelled, plus the ones
 * this teacher stood in for on somebody else's CRN. That last is why the covers are
 * fetched before the classes — an hour somebody covered is on a CRN that is not theirs,
 * and asking only for their own sections would miss it.
 *
 * The periods shown are the ones with something in them: a class that met, or a sheet
 * already filed. A semester carries no dates of its own, so there is nothing else to
 * bound them by — and a list of empty months would say nothing anyway.
 */
export function TeacherPeriods({
  teacherId,
  className = "",
}: {
  /** The part-time record. The hours are the Active teacher's, found from it. */
  teacherId: string;
  className?: string;
}) {
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const [termId, setTermId] = useState("");
  const chosen = termId || terms.data?.[0]?.id || "";

  const actives = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const mine = (actives.data ?? []).find((teacher) => teacher.partTimeTeacherId === teacherId) ?? null;

  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const termCode = links.data?.[chosen] ?? "";
  const changes = useQuery({
    queryKey: ["session-changes", termCode],
    queryFn: () => fetchSessionChanges(termCode),
    enabled: Boolean(termCode),
  });
  const cards = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles });
  const sheets = useQuery({ queryKey: ["teacher-time-sheets", teacherId], queryFn: () => listTeacherTimeSheets(teacherId) });
  const summary = useQuery({ queryKey: ["teacher-summary"], queryFn: fetchTeacherSummary });

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? id;
  /** Their own sections this semester, and any CRN they stood in on. */
  const crns = useMemo(() => {
    if (!mine) return [];
    const built = buildCards(cards.data ?? [], termName, []);
    const own = sectionsTaughtBy(built, mine.id, mine.fullName)
      .filter((section) => section.termId === chosen && section.crn)
      .map((section) => section.crn);
    const covered = (changes.data ?? [])
      .filter((change) => change.kind === "covered" && change.coverTeacherId === mine.id)
      .map((change) => change.crn);
    return [...new Set([...own, ...covered])];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards.data, changes.data, mine?.id, mine?.fullName, chosen, terms.data]);

  const sections = useQuery({
    queryKey: ["facility-sections", termCode, crns.join(",")],
    queryFn: () => fetchFacilitySections(termCode, crns),
    enabled: Boolean(termCode) && crns.length > 0,
  });

  const opensOn = opensOnFor(cycles.data?.cycles ?? {}, chosen, cycles.data?.default ?? PERIOD_OPENS_ON);

  /** Every period something happened in: a class that met, or a sheet already filed. */
  const rows = useMemo(() => {
    const met = (sections.data?.sections ?? []).flatMap((section) =>
      section.meetings.map((meeting) => periodContaining(new Date(`${meeting.meetsOn}T00:00:00`), opensOn)),
    );
    const filed = (sheets.data ?? []).map((sheet) => sheet.periodStart).filter(Boolean);
    const starts = [...new Set([...met, ...filed])].sort().reverse();
    return starts.map((start) => {
      const period = { from: start, to: periodEnd(start) };
      const { hours, stranded } = hoursTaught({
        sections: sections.data?.sections ?? [],
        changes: changes.data ?? [],
        period,
        staffing: () => ({ id: mine?.id ?? "", name: mine?.fullName ?? "" }),
      });
      return {
        start,
        minutes: minutesByTeacher(hours)[mine?.id ?? ""] ?? 0,
        classes: hours.filter((hour) => hour.teacherId === (mine?.id ?? "")).length,
        covered: hours.filter((hour) => hour.covered && hour.teacherId === (mine?.id ?? "")).length,
        stranded: stranded.length,
        sheet: (sheets.data ?? []).find((held) => held.periodStart === start) ?? null,
      };
    });
  }, [sections.data, sheets.data, changes.data, opensOn, mine?.id, mine?.fullName]);

  const contracted = summary.data?.[teacherId]?.contractedHours ?? 0;
  const waiting = actives.isLoading || cards.isLoading || sections.isLoading;

  return (
    <section className={`rounded-lg border border-[#e4e8ef] bg-white px-4 py-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#171717]">What they taught, period by period</h3>
          <p className="mt-0.5 text-xs text-[#98a2b3]">
            The classes that met, less the ones cancelled, plus any they stood in for.
            {contracted ? ` Contracted for ${contracted} h.` : ""}
          </p>
        </div>
        <div className="w-44">
          <SelectMenu
            label="Semester for the hours"
            value={chosen}
            onChange={setTermId}
            options={(terms.data ?? []).map((term) => ({ value: term.id, label: term.name }))}
            placeholder="Which semester…"
          />
        </div>
      </div>

      {!mine ? (
        <p className="mt-3 text-sm text-[#667085]">
          Not joined to an Active teacher, so there are no classes to count. Link them on Active teachers.
        </p>
      ) : waiting ? (
        <p className="mt-3 text-sm text-[#667085]">Counting…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-[#667085]">
          Nothing in {termName(chosen)}: no class of theirs met, and no sheet is filed.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[#f2f4f7] text-sm">
          {rows.map((row) => (
            <li key={row.start} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <span className="font-medium text-[#344054]">{periodLabel(row.start)}</span>
              <span className="tabular-nums text-[#1f4e79]">{asHours(row.minutes)} h</span>
              <span className="text-xs text-[#98a2b3]">
                {row.classes} class{row.classes === 1 ? "" : "es"}
                {row.covered ? ` · ${row.covered} covered for somebody` : ""}
              </span>
              {row.stranded ? (
                <span className="text-xs text-[#8a6116]">
                  {row.stranded} note{row.stranded === 1 ? "" : "s"} about an hour the registrar has moved
                </span>
              ) : null}
              <span className="ml-auto text-xs">
                {row.sheet ? (
                  <a href={row.sheet.url} target="_blank" rel="noreferrer" className="font-semibold text-[#1f4e79] hover:underline">
                    Time sheet
                  </a>
                ) : (
                  <span className="text-[#a6292f]">No sheet filed</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
