import { useMemo, useState } from "react";

import { InfoTip } from "@/components/InfoTip";
import type { TeacherRef } from "@/components/TeacherRecord";
import { usePageState } from "@/components/usePageState";
import {
  BUCKETS,
  LOAD_KINDS,
  STAFF_STATUSES,
  bucketLabel,
  cohortLoads,
  departmentSplit,
  shareOf,
  splitTotal,
  type Bucket,
  type CohortLoad,
  type LoadKind,
  type Split,
  type StaffStatus,
} from "@/services/cohortLoads";
import type { Card } from "@/services/courseCards";
import type { ActiveTeacher } from "@/services/portalLists";

const DEPARTMENT = "department";
const hours = (value: number) => (value ? Math.round(value * 10) / 10 : 0).toLocaleString("en-GB");

const PILL: Record<Bucket, string> = {
  FT: "bg-[#e1f5ee] text-[#085041]",
  PHD: "bg-[#f1efe8] text-[#444441]",
  VP: "bg-[#faece7] text-[#712b13]",
  PT: "bg-[#eeedfe] text-[#3c3489]",
  UNSET: "bg-[#faeeda] text-[#633806]",
  NOBODY: "bg-[#fcebeb] text-[#a6292f]",
};

/** A teacher's status as the sheet writes it, coloured the same everywhere on the page. */
function StatusPill({ status }: { status: StaffStatus | "" }) {
  const bucket: Bucket = status || "UNSET";
  const long = STAFF_STATUSES.find((entry) => entry.status === status)?.long ?? "No status yet: set it on the teacher's record";
  return (
    <span title={long} className={`ml-1.5 inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ${PILL[bucket]}`}>
      {status ? bucketLabel(bucket) : "?"}
    </span>
  );
}

/**
 * Who teaches the hours: the sheet's table of FT, PhD/Pdoc, VP and PT, with each one's
 * share, semester by semester and for the year. A line for hours whose teacher has no
 * status, and one for hours nobody teaches yet, only when there are any — so the total
 * is always the hours planned, and the shares say what is still open.
 */
function SplitTable({ split, termIds, termLabel }: { split: Record<string, Split>; termIds: string[]; termLabel: (id: string) => string }) {
  const columns = [...termIds.filter((id) => split[id]), "year"];
  const shownBuckets = BUCKETS.filter((bucket) => STAFF_STATUSES.some((entry) => entry.status === bucket) || columns.some((id) => split[id][bucket] > 0));
  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-xs text-[#667085]">
          <th className="py-1.5 pr-3 text-left font-semibold" />
          {columns.map((id) => (
            <th key={id} className="whitespace-nowrap py-1.5 pl-3 text-right font-semibold">
              {id === "year" ? "Year" : termLabel(id)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {shownBuckets.map((bucket) => (
          <tr key={bucket} className="border-t border-[#eef1f5]">
            <td className="py-1.5 pr-3">
              <span className={`inline-block whitespace-nowrap rounded px-1.5 py-px text-[11px] font-semibold ${PILL[bucket]}`}>{bucketLabel(bucket)}</span>
            </td>
            {columns.map((id) => {
              const value = split[id][bucket];
              const share = shareOf(value, splitTotal(split[id]));
              return (
                <td key={id} className={`whitespace-nowrap py-1.5 pl-3 text-right ${bucket === "NOBODY" && value ? "text-[#a6292f]" : ""}`}>
                  {value ? (
                    <>
                      {hours(value)} <span className="text-[#98a2b3]">· {share}</span>
                    </>
                  ) : (
                    <span className="text-[#c0c7d1]">0</span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
        <tr className="border-t border-[#d9dee7] font-semibold">
          <td className="py-1.5 pr-3">Total</td>
          {columns.map((id) => (
            <td key={id} className="py-1.5 pl-3 text-right">
              {hours(splitTotal(split[id]))}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

const card = "rounded-lg border border-[#d9dee7] bg-white p-4";

/**
 * Teacher hours cohort by cohort, laid out as the department's teaching-load sheet: each
 * cohort's split, its CM/TD/TP hours and who teaches how many, over its courses and their
 * sections for the whole academic year. Department adds every cohort up.
 */
export function CohortLoads({
  cards,
  termIds,
  termLabel,
  teachers,
  onOpenTeacher,
}: {
  cards: Card[];
  /** The semesters of the academic year, in order. */
  termIds: string[];
  termLabel: (termId: string) => string;
  teachers: ActiveTeacher[];
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const cohorts = useMemo(() => cohortLoads(cards, termIds, teachers), [cards, termIds, teachers]);
  const [chosen, setChosen] = usePageState<string>("teacher-hours:cohort", DEPARTMENT);
  const cohort = cohorts.find((entry) => entry.cohortId === chosen) ?? null;

  if (!cohorts.length) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        Nothing is planned for this academic year yet. Groups &amp; CRNs is where sections are made.
      </p>
    );
  }
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-semibold ${
      active ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d3d9e2] bg-white text-[#475467] hover:border-[#1f4e79]"
    }`;
  return (
    <div className="space-y-4">
      <div role="group" aria-label="Cohort" className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={!cohort} onClick={() => setChosen(DEPARTMENT)} className={chip(!cohort)}>
          Department
        </button>
        {cohorts.map((entry) => (
          <button
            key={entry.cohortId}
            type="button"
            aria-pressed={cohort?.cohortId === entry.cohortId}
            onClick={() => setChosen(entry.cohortId)}
            className={chip(cohort?.cohortId === entry.cohortId)}
          >
            {entry.cohortName}
          </button>
        ))}
      </div>
      {cohort ? (
        <CohortBlock cohort={cohort} termIds={termIds} termLabel={termLabel} onOpenTeacher={onOpenTeacher} />
      ) : (
        <DepartmentBlock cohorts={cohorts} termIds={termIds} termLabel={termLabel} onChoose={setChosen} />
      )}
    </div>
  );
}

function DepartmentBlock({
  cohorts,
  termIds,
  termLabel,
  onChoose,
}: {
  cohorts: CohortLoad[];
  termIds: string[];
  termLabel: (termId: string) => string;
  onChoose: (cohortId: string) => void;
}) {
  const split = useMemo(() => departmentSplit(cohorts, termIds), [cohorts, termIds]);
  const shown = BUCKETS.filter((bucket) => STAFF_STATUSES.some((entry) => entry.status === bucket) || cohorts.some((cohort) => cohort.split.year[bucket] > 0));
  return (
    <div className="space-y-4">
      <section className={`${card} max-w-3xl`}>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-[#344054]">
          Who teaches the department&apos;s hours
          <InfoTip label="Where these hours come from">
            The hours Groups &amp; CRNs plans for every section of the year, by the status of the teacher named on it.
            A teacher&apos;s status is set on their record; until it is, the portal&apos;s type is read as one.
          </InfoTip>
        </h3>
        <SplitTable split={split} termIds={termIds} termLabel={termLabel} />
      </section>
      <section className={card}>
        <h3 className="mb-2 text-sm font-semibold text-[#344054]">Cohort by cohort, over the year</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-[#667085]">
                <th className="py-1.5 pr-3 text-left font-semibold">Cohort</th>
                <th className="py-1.5 pl-3 text-right font-semibold">Hours</th>
                {shown.map((bucket) => (
                  <th key={bucket} className="py-1.5 pl-3 text-right font-semibold">
                    {bucketLabel(bucket)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => {
                const total = splitTotal(cohort.split.year);
                return (
                  <tr key={cohort.cohortId} className="border-t border-[#eef1f5]">
                    <td className="py-1.5 pr-3">
                      <button type="button" onClick={() => onChoose(cohort.cohortId)} className="font-semibold text-[#1f4e79] hover:underline">
                        {cohort.cohortName}
                      </button>
                    </td>
                    <td className="py-1.5 pl-3 text-right font-semibold">{hours(total)}</td>
                    {shown.map((bucket) => (
                      <td key={bucket} className={`py-1.5 pl-3 text-right ${bucket === "NOBODY" && cohort.split.year[bucket] ? "text-[#a6292f]" : ""}`}>
                        {cohort.split.year[bucket] ? shareOf(cohort.split.year[bucket], total) : <span className="text-[#c0c7d1]">—</span>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

const KIND_LABEL: Record<LoadKind, string> = { CM: "CM", TD: "TD", TP: "TP", OTHER: "Other" };
const MOST_TEACHERS = 8;

function CohortBlock({
  cohort,
  termIds,
  termLabel,
  onOpenTeacher,
}: {
  cohort: CohortLoad;
  termIds: string[];
  termLabel: (termId: string) => string;
  onOpenTeacher?: (teacher: TeacherRef) => void;
}) {
  const [allTeachers, setAllTeachers] = useState(false);
  const kinds = LOAD_KINDS.filter((kind) => kind !== "OTHER" || cohort.kinds.OTHER > 0);
  const listed = allTeachers ? cohort.teachers : cohort.teachers.slice(0, MOST_TEACHERS);
  const teacherName = (teacherId: string, name: string) =>
    onOpenTeacher && teacherId ? (
      <button type="button" onClick={() => onOpenTeacher({ id: teacherId, fullName: name })} className="text-left text-[#1f4e79] hover:underline">
        {name}
      </button>
    ) : (
      <span>{name}</span>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section className={card}>
          <h3 className="mb-2 text-sm font-semibold text-[#344054]">Who teaches the hours</h3>
          <div className="overflow-x-auto">
            <SplitTable split={cohort.split} termIds={termIds} termLabel={termLabel} />
          </div>
        </section>
        <div className="space-y-4">
          <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${kinds.length}, minmax(0, 1fr))` }}>
            {kinds.map((kind) => (
              <div key={kind} className="rounded-lg bg-[#f2f4f7] px-3 py-2">
                <p className="text-xs text-[#667085]">{KIND_LABEL[kind]}</p>
                <p className="text-lg font-semibold tabular-nums text-[#171717]">{hours(cohort.kinds[kind])}</p>
              </div>
            ))}
          </div>
          <section className={card}>
            <h3 className="mb-2 text-sm font-semibold text-[#344054]">Each teacher in {cohort.cohortName}</h3>
            {cohort.teachers.length ? (
              <ul className="space-y-1 text-sm">
                {listed.map((teacher) => (
                  <li key={teacher.teacherId || teacher.teacher} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      {teacherName(teacher.teacherId, teacher.teacher)}
                      <StatusPill status={teacher.status} />
                    </span>
                    <span className="tabular-nums text-[#344054]">{hours(teacher.hours)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[#667085]">Nobody is named on its sections yet.</p>
            )}
            {cohort.teachers.length > MOST_TEACHERS ? (
              <button type="button" onClick={() => setAllTeachers((shown) => !shown)} className="mt-2 text-xs font-semibold text-[#1f4e79] hover:underline">
                {allTeachers ? "Show fewer" : `Show all ${cohort.teachers.length}`}
              </button>
            ) : null}
          </section>
        </div>
      </div>

      {cohort.semesters.map((semester) => (
        <section key={semester.termId} className={`${card} overflow-x-auto p-0`}>
          <table className="w-full min-w-[44rem] text-sm tabular-nums">
            <thead>
              <tr className="text-xs text-[#667085]">
                <th className="px-4 py-2 text-left text-sm font-semibold text-[#171717]">{termLabel(semester.termId)}</th>
                <th className="px-2 py-2 text-left font-semibold">CRN</th>
                <th className="px-2 py-2 text-left font-semibold">Teacher</th>
                {kinds.map((kind) => (
                  <th key={kind} className="px-2 py-2 text-right font-semibold">
                    {KIND_LABEL[kind]}
                  </th>
                ))}
                <th className="px-2 py-2 text-right font-semibold">Students</th>
                <th className="px-4 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {semester.courses.map((course) => {
                const byKind = (kind: LoadKind) => course.sections.filter((section) => section.kind === kind).reduce((sum, section) => sum + section.hours, 0);
                const total = course.sections.reduce((sum, section) => sum + section.hours, 0);
                return [
                  <tr key={course.card.key} className="border-t border-[#d9dee7] bg-[#f6f8fb]">
                    <td className="px-4 py-1.5 font-semibold text-[#171717]" colSpan={3}>
                      {course.card.name || course.card.code}
                      <span className="ml-2 font-normal text-[#667085]">{course.card.code}</span>
                      <span
                        className={`ml-2 font-normal ${course.coefficient ? "text-[#667085]" : "text-[#c0c7d1]"}`}
                        title={course.coefficient ? undefined : "Set on the course's record, from Active courses"}
                      >
                        · coeff. {course.coefficient || "—"}
                      </span>
                    </td>
                    {kinds.map((kind) => (
                      <td key={kind} className="px-2 py-1.5 text-right font-semibold">
                        {byKind(kind) ? hours(byKind(kind)) : ""}
                      </td>
                    ))}
                    <td className="px-2 py-1.5" />
                    <td className="px-4 py-1.5 text-right font-semibold">{hours(total)}</td>
                  </tr>,
                  ...course.sections.map((section) => (
                    <tr key={section.key} className="border-t border-[#eef1f5]">
                      <td className="py-1.5 pl-8 pr-2 text-[#475467]">{section.label}</td>
                      <td className="px-2 py-1.5 text-left">{section.crn || <span className="text-[#c0c7d1]">—</span>}</td>
                      <td className="px-2 py-1.5 text-left">
                        {section.teacher ? (
                          <>
                            {teacherName(section.teacherId, section.teacher)}
                            <StatusPill status={section.status} />
                          </>
                        ) : (
                          <span className="text-[#a6292f]">Nobody yet</span>
                        )}
                      </td>
                      {kinds.map((kind) => (
                        <td key={kind} className="px-2 py-1.5 text-right">
                          {section.kind === kind && section.hours ? hours(section.hours) : ""}
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right text-[#475467]">{section.students || ""}</td>
                      <td className="px-4 py-1.5 text-right">{hours(section.hours)}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
