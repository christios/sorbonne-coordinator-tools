import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { CourseRecord } from "@/components/CourseRecord";
import { InfoTip, TipDo, TipPage, TipPoint } from "@/components/InfoTip";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { usePortalSemester } from "@/components/PortalSemesterMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { useCoursePrograms } from "@/components/useCoursePrograms";
import { withProgrammeColumn } from "@/services/coursePrograms";
import {
  COMPONENTS,
  fetchCoursePlans,
  figure,
  planStanding,
  unevenComponents,
  type Component,
  type CoursePlan,
} from "@/services/coursePlans";
import type { GridColumn } from "@/services/studentColumns";

/** "21 h · 1.5": a component's hours and one session's length, as a cell says them. */
const hoursCell = (plan: CoursePlan, component: Component) => {
  const held = plan.components[component];
  if (!held.hours) return held.issue ?? "";
  return held.length ? `${figure(held.hours)} h · ${figure(held.length)}` : `${figure(held.hours)} h · no session length`;
};

const STANDING_WORDS = { "no-lead": "No lead yet", waiting: "Waiting for the lead", answered: "Laid out" } as const;

/** Where a course's weeks stand, as the filter lists it: "Laid out, uneven" among them (23 Nov 2026). */
const standingWords = (plan: CoursePlan, weeks: number[]) => {
  const { state, offTarget } = planStanding(plan);
  const said = offTarget.length ? `Laid out, ${offTarget.join(", ")} off the hours` : STANDING_WORDS[state];
  return state === "answered" && unevenComponents(plan, weeks).length ? `${said}, uneven` : said;
};

/** The pill beside "Laid out" for weeks that run unevenly, with the lead's reason on hover. */
function UnevenPill({ plan, weeks }: { plan: CoursePlan; weeks: number[] }) {
  const uneven = unevenComponents(plan, weeks);
  if (!uneven.length) return null;
  return (
    <span
      title={plan.paceReason ? `Why the ${uneven.join(" and ")} weeks are uneven: ${plan.paceReason}` : "Uneven, with no reason given"}
      className="inline-flex shrink-0 items-center rounded-full border border-[#e5b454] bg-[#fdf6e3] px-2 py-0.5 text-[11px] font-semibold text-[#8a6116]"
    >
      Uneven
    </span>
  );
}

const columnsFor = (weeks: number[]): GridColumn<CoursePlan>[] => [
  { id: "courseCode", displayName: "Course", type: "text", accessor: (row) => row.courseCode, required: true, defaultWidth: 110 },
  { id: "title", displayName: "Title", type: "text", accessor: (row) => row.title, defaultWidth: 200 },
  { id: "coefficient", displayName: "Coefficient", type: "text", accessor: (row) => row.coefficient, defaultWidth: 95 },
  ...COMPONENTS.map(
    (component): GridColumn<CoursePlan> => ({
      id: `hours-${component}`,
      displayName: component === "CM" ? "CM" : `${component}, each group`,
      type: "text",
      accessor: (row) => hoursCell(row, component),
      defaultWidth: component === "TP" ? 125 : 140,
    }),
  ),
  { id: "lead", displayName: "Course lead", type: "option", accessor: (row) => row.leadName, defaultWidth: 170 },
  { id: "standing", displayName: "Week by week", type: "option", accessor: (row) => standingWords(row, weeks), defaultWidth: 190 },
  { id: "note", displayName: "Lead's note", type: "text", accessor: (row) => row.note, defaultWidth: 240 },
  { id: "paceReason", displayName: "Why uneven", type: "text", accessor: (row) => row.paceReason ?? "", defaultWidth: 240 },
];
const SHOWN = ["courseCode", "title", "coefficient", "hours-CM", "hours-TD", "hours-TP", "lead", "standing"];

/**
 * The department's courses for the header's semester, one row each: its program and
 * coefficient, the CM, TD and TP hours coordinators set, its lead, and where the lead's weeks
 * stand. A row opens the course's plan, where the hours and the lead are set.
 *
 * Active CRNs lists the register a CRN at a time; this is the course, once.
 */
export function CoursePlansPage() {
  const { semester, term } = usePortalSemester();
  const plans = useQuery({ queryKey: ["course-plans", term], queryFn: () => fetchCoursePlans(term), enabled: Boolean(term) });
  const coursePrograms = useCoursePrograms();
  const numbers = useMemo(() => (plans.data?.weeks ?? []).map((week) => week.week), [plans.data]);
  const columns = useMemo(
    () => withProgrammeColumn(columnsFor(numbers), coursePrograms, (row) => row.courseCode, "courseCode"),
    [coursePrograms, numbers],
  );
  const [openCode, setOpenCode] = useState("");
  const semesterName = semester?.name ?? "this semester";

  const rows = useMemo(() => (plans.data?.courses ?? []).filter((row) => row.active), [plans.data]);
  const opened = (plans.data?.courses ?? []).find((row) => row.courseCode === openCode) ?? null;

  const renderCell = (row: CoursePlan, column: GridColumn<CoursePlan>) => {
    if (column.id === "standing") {
      const { state, offTarget } = planStanding(row);
      if (state === "answered") {
        // Amber, not red: a lead who disagrees with a total says so in the note, and may be right.
        return (
          <span className="inline-flex max-w-full items-center gap-1">
            {offTarget.length ? (
              <span
                title={row.note ? `The lead's note: ${row.note}` : undefined}
                className="inline-flex min-w-0 items-center truncate rounded-full bg-[#fdf6e3] px-2 py-0.5 text-[11px] font-semibold text-[#8a6116]"
              >
                Laid out · {offTarget.join(", ")} off the hours
              </span>
            ) : (
              <StatePill tone="good">Laid out</StatePill>
            )}
            <UnevenPill plan={row} weeks={numbers} />
          </span>
        );
      }
      return <StatePill tone={state === "waiting" ? "accent" : "muted"}>{STANDING_WORDS[state]}</StatePill>;
    }
    if (column.id.startsWith("hours-")) {
      const component = column.id.slice(6) as Component;
      const held = row.components[component];
      // As Groups & CRNs has them; amber where it can't say: groups that disagree, no session length.
      if (!held.hours) {
        return held.issue ? (
          <span title={held.issue} className="truncate text-xs font-semibold text-[#8a6116]">
            {held.issue}
          </span>
        ) : (
          <span className="text-[#c8d0da]">—</span>
        );
      }
      return (
        <span className="tabular-nums" title={held.issue || undefined}>
          <b className="font-semibold text-[#171717]">{figure(held.hours)} h</b>
          {held.length ? (
            <span className="text-[#667085]"> · sessions of {figure(held.length)} h</span>
          ) : (
            <span className="font-semibold text-[#8a6116]"> · no session length</span>
          )}
        </span>
      );
    }
    if (column.id === "lead" && !row.leadId) return <span className="text-[#98a2b3]">Nobody yet</span>;
    if ((column.id === "coefficient" || column.id === "note" || column.id === "paceReason") && !row[column.id]) {
      return <span className="text-[#c8d0da]">—</span>;
    }
    return undefined;
  };

  if (!term) return <p className="text-sm text-[#667085]">Choose a semester with a portal term, at the top of the page.</p>;
  if (plans.isLoading) return <ScreenLoading label="Reading the courses…" />;
  if (plans.error) return <p role="alert" className="text-sm text-[#a6292f]">{(plans.error as Error).message}</p>;

  const weeks = plans.data?.weeks ?? [];
  const waiting = rows.filter((row) => planStanding(row).state === "waiting").length;
  const noLead = rows.filter((row) => !row.leadId).length;

  return (
    <section>
      <ListGrid
        columns={columns}
        rows={rows}
        idOf={(row) => row.courseCode}
        labelOf={(row) => row.courseCode}
        layoutKey="scen-columns:course-plans:v1"
        presetKey="scen-copy-presets:course-plans:v1"
        shown={SHOWN}
        initialSort={{ key: "courseCode", ascending: true }}
        searchLabel="Search active courses"
        noun="courses"
        renderCell={renderCell}
        onRowClick={(row) => setOpenCode(row.courseCode)}
        empty={`No course is active in ${semesterName} yet. Choose its courses on the Courses page.`}
        toolbar={
          <span className="flex items-center gap-2 text-sm text-[#475467]">
            <InfoTip label="How course plans work" title="Active courses">
              <TipDo>Read each course&rsquo;s plan here; set it on <TipPage name="Groups & CRNs" />.</TipDo>
              <TipPoint step={1}>
                Its CM, TD and TP hours and session lengths come from the course&rsquo;s rows and sections on{" "}
                <TipPage name="Groups & CRNs" />, where each card also picks the lead.
              </TipPoint>
              <TipPoint step={2}>
                The lead lays the sessions out week by week in their request on <TipPage name="Timetable preferences" />, or you
                fill them in under the course&rsquo;s card.
              </TipPoint>
              <TipPoint step={3}>
                On <TipPage name="Semester plan" />, placing a class proposes its weeks, and a class that doesn&rsquo;t keep to them is
                flagged amber.
              </TipPoint>
            </InfoTip>
            {rows.length ? (
              <span>
                {noLead ? `${noLead} without a lead` : "Every course has a lead"}
                {waiting ? ` · ${waiting} waiting for the lead` : ""}
              </span>
            ) : null}
          </span>
        }
      />
      {!weeks.length && rows.length ? (
        <p className="mt-2 text-xs text-[#8a6116]">
          {semesterName}&rsquo;s teaching weeks aren&rsquo;t set yet: leads can&rsquo;t lay out their weeks until Week 1 and the
          number of weeks are set in the Semester plan&rsquo;s settings.
        </p>
      ) : null}
      {opened ? (
        // The course's one record, as Active CRNs and Groups & CRNs open it (23 Nov 2026).
        <CourseRecord key={opened.courseCode} open courseCode={opened.courseCode} onClose={() => setOpenCode("")} />
      ) : null}
    </section>
  );
}
