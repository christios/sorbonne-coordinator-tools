import { CalendarDays, Check, ClipboardList, Pencil } from "lucide-react";
import type { ReactNode } from "react";

import {
  figure,
  hoursLaidOut,
  laidOut,
  layoutWords,
  sessionLengths,
  sessionsWords,
  lengthWords,
  planStanding,
  rowsOf,
  rowWords,
  type CoursePlan,
  type CoursePlanSemester,
  type TeachingWeek,
  unevenComponents,
  withWeeksOff,
} from "@/services/coursePlans";
import { Tip } from "@/components/InfoTip";
import { heldWords, yearWords, type ReductionSheet } from "@/services/hourReductions";
import { formatDayAndMonth } from "@/services/weekSchedule";

/**
 * The teacher's request as sent, read back: said at the top to be a summary of what they sent,
 * part by part (18 Nov 2026: the cards read as loose notes, and the page as something else).
 * Each part is a card numbered as its step was, with its own Change.
 */
export function SummaryIntro({ semesterName, open }: { semesterName: string; open: boolean }) {
  return (
    <div data-summary-intro className="mb-4 flex items-start gap-3 rounded-xl border border-[#d7e3ef] bg-[#f2f7fb] px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#1f4e79] text-white">
        <ClipboardList size={18} aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-base font-semibold text-[#171717]">
          Summary of your requests{semesterName ? ` for ${semesterName}` : ""}
        </h2>
        <p className="mt-0.5 text-sm text-[#475467]">
          {open
            ? "What you sent, part by part, as the coordinators see it. To change a part, press Change on it."
            : "What you sent, part by part, as the coordinators see it. It can no longer be changed here."}
        </p>
      </div>
    </div>
  );
}

/** One part of the request, read back: its step's number and name, and Change. */
export function SummaryCard({
  number,
  title,
  aside,
  onChange,
  children,
}: {
  number: number;
  title: string;
  /** A word beside the title: the year, how many are laid out. */
  aside?: ReactNode;
  onChange?: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 overflow-hidden rounded-xl border border-[#d0d5dd] bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#e4e8ef] bg-[#f8fafc] px-4 py-2.5">
        <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#1f4e79] text-xs font-bold text-white">
          {number}
        </span>
        <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
        {aside ? <span className="text-xs text-[#667085]">{aside}</span> : null}
        {onChange ? (
          <button
            type="button"
            onClick={onChange}
            aria-label={`Change ${title.toLowerCase()}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#eef4fa]"
          >
            <Pencil size={12} aria-hidden="true" /> Change
          </button>
        ) : null}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** A figure over its word, as the tiles of a summary show them. */
function Tile({ label, value, of }: { label: string; value: string; of?: string }) {
  return (
    <div className="rounded-lg border border-[#e4e8ef] bg-[#f8fafc] px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-[#171717]">
        {value}
        {of ? <span className="ml-1 text-sm font-normal text-[#667085]">{of}</span> : null}
      </p>
    </div>
  );
}

/** A full-timer's hour reductions for the year, read back: the two totals, then each reduction held. */
export function ReductionsSummaryBody({ sheet }: { sheet: ReductionSheet }) {
  const held = sheet.items.filter((item) => item.hours > 0);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Tile label="Reductions" value={`${figure(sheet.total)} h`} />
        <Tile label="Teaching owed" value={`${figure(sheet.owed)} h`} of={`of ${sheet.service} h`} />
      </div>
      {held.length ? (
        <ul className="divide-y divide-[#eef1f5] rounded-lg border border-[#e4e8ef]">
          {held.map((item) => (
            <li key={item.kind} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="font-medium text-[#171717]">{item.label}</span>
              <span className="text-[#667085]">{heldWords(item)}</span>
              {item.state === "declared" ? (
                <span className="rounded-full bg-[#fdf6e3] px-2 text-[11px] font-semibold text-[#8a6116]">to be validated</span>
              ) : null}
              {item.group === "department" ? (
                <span className="rounded-full bg-[#f2f4f7] px-2 text-[11px] font-semibold text-[#475467]">set by the Head of Department</span>
              ) : null}
              <b className="ml-auto tabular-nums text-[#171717]">{figure(item.hours)} h</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#475467]">No reductions for {yearWords(sheet.year)}.</p>
      )}
      {sheet.note ? <Note>{sheet.note}</Note> : null}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border-l-[3px] border-[#b7c6d8] bg-[#f8fafc] px-3 py-2 text-sm text-[#344054]">
      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#667085]">Your note</span>
      {children}
    </p>
  );
}

/** Where a course's weeks stand, as a pill: laid out, off the hours, or not yet. */
function StandingPill({ course }: { course: CoursePlan }) {
  const { state, offTarget } = planStanding(course);
  const [look, words] =
    state !== "answered"
      ? ["bg-[#f2f4f7] text-[#475467]", "Not laid out yet"]
      : offTarget.length
        ? ["bg-[#fdf6e3] text-[#8a6116]", `${offTarget.map(rowWords).join(", ")} off the hours`]
        : ["bg-[#e7f4ec] text-[#2e7d55]", "Laid out"];
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${look}`}>{words}</span>;
}

/**
 * A course's weeks at a glance: a strip per component, a block per teaching week — filled where
 * it has sessions, with the hours taught that week in it (18 Nov 2026: blocks without hours were
 * hard to read), amber for a week whose sessions last other than usual — and the hours against
 * the target.
 */
export function CourseWeeks({ course, weeks }: { course: CoursePlan; weeks: TeachingWeek[] }) {
  // A strip per component, and per part of its groups taught in parts (25 Nov 2026).
  const components = rowsOf(course);
  const lengths = course.lengths ?? {};
  // The weeks off between teaching weeks: a dashed block, as in the grid the lead filled in.
  const columns = withWeeksOff(weeks);
  if (!components.length) return <p className="text-sm text-[#667085]">No hours set yet.</p>;
  return (
    <div>
    {/* Never narrower than the hours in a block can be read: on a phone the strips scroll sideways. */}
    <div className="overflow-x-auto pb-1">
    <div className="grid min-w-[40rem] grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
      <span aria-hidden="true" className="text-[9px] font-semibold uppercase tracking-wide text-[#98a2b3]">Week</span>
      {/* Each week's number, and the date it starts, as the grid the lead filled in heads them. */}
      <div aria-hidden="true" className="flex gap-[3px]">
        {columns.map(({ week, off }) =>
          week ? (
            <span key={week.week} className="min-w-0 flex-1 text-center tabular-nums leading-none">
              <span className="block text-[10px] font-semibold text-[#475467]">{week.week}</span>
              {week.monday ? (
                <span className="mt-0.5 block whitespace-nowrap text-[8.5px] text-[#98a2b3]">{formatDayAndMonth(week.monday)}</span>
              ) : null}
            </span>
          ) : (
            <span key={`off-${off}`} className="min-w-0 flex-1 text-center leading-none">
              <span className="block text-[9px] font-semibold uppercase text-[#98a2b3]">Off</span>
              <span className="mt-0.5 block whitespace-nowrap text-[8.5px] text-[#98a2b3]">{formatDayAndMonth(off)}</span>
            </span>
          ),
        )}
      </div>
      <span aria-hidden="true" className="text-[9px] font-semibold uppercase tracking-wide text-[#98a2b3]">Total</span>
      {components.map((row) => {
        const component = row.key;
        const words = rowWords(row.key);
        const done = hoursLaidOut(course, course.weeks, component, lengths);
        const target = row.held.hours ?? 0;
        const usual = row.held.length ?? 0;
        const met = Math.abs(done - target) < 0.01;
        const own = lengths[component] ?? {};
        return (
          <div key={component} className="contents">
            <span className="justify-self-start whitespace-nowrap rounded bg-[#e8edf3] px-1.5 text-xs font-bold text-[#1f4e79]" title={row.teachers.join(", ") || undefined}>
              {row.part ? `${row.component} ${row.part}` : component}
            </span>
            <div
              role="group"
              aria-label={`${words}: ${layoutWords(course.weeks[component])}${Object.keys(own).length ? `, ${lengthWords(own)}` : ""}`}
              className="flex gap-[3px]"
            >
              {columns.map(({ week, off }) => {
                if (!week) {
                  return (
                    <span key={`off-${off}`} role="img" aria-label={`Week of ${formatDayAndMonth(off)}: no classes`} className="flex min-w-0 flex-1 flex-col">
                      <span className="h-6 rounded-[3px] border-[1.5px] border-dashed border-[#98a2b3]" />
                      <span className="mt-0.5 h-3" />
                    </span>
                  );
                }
                const count = course.weeks[component]?.[String(week.week)] ?? 0;
                const each = sessionLengths(usual, own[String(week.week)], count);
                const hours = each.reduce((sum, one) => sum + one, 0);
                const odd = String(week.week) in own;
                // As the lead filled it in: the sessions in the block, the hours they make under it;
                // the week in full on hover, in the app's own bubble.
                const said = count
                  ? `Week ${week.week}: ${count} ${words} session${count === 1 ? "" : "s"} of ${sessionsWords(each)}`
                  : `Week ${week.week}: no ${words} session`;
                return (
                  <Tip
                    key={week.week}
                    side="top"
                    wide={false}
                    delay={80}
                    icon={CalendarDays}
                    title={`Week ${week.week}${week.monday ? ` · ${formatDayAndMonth(week.monday)}` : ""}`}
                    content={<WeekDetail component={words} lengths={each} usual={usual} holidays={week.holidays} />}
                  >
                  <span role="img" aria-label={said} className="flex min-w-0 flex-1 cursor-default flex-col items-stretch">
                    <span
                      className={`grid h-6 place-items-center rounded-[3px] text-[11px] font-bold tabular-nums leading-none ${
                        !count ? "bg-[#eef1f5] text-transparent" : odd ? "bg-[#c98a12] text-white" : "bg-[#3b6a97] text-white"
                      }`}
                    >
                      {count || ""}
                    </span>
                    <span
                      className={`mt-0.5 h-3 overflow-hidden text-center text-[9px] tabular-nums leading-3 ${odd ? "font-bold text-[#8a6116]" : "text-[#667085]"}`}
                    >
                      {count ? `${figure(hours)} h` : ""}
                    </span>
                  </span>
                  </Tip>
                );
              })}
            </div>
            <span className={`flex items-center gap-1 whitespace-nowrap text-sm font-semibold tabular-nums ${met ? "text-[#2e7d55]" : "text-[#8a6116]"}`}>
              {met ? <Check size={13} aria-hidden="true" /> : null}
              {figure(done)} of {figure(target)} h
            </span>
          </div>
        );
      })}
    </div>
    </div>
      {/* The key, once: what a number in a block is, and what amber means. */}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#667085] sm:pl-[3.25rem]">
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="grid h-3.5 w-3.5 place-items-center rounded-[2px] bg-[#3b6a97] text-[9px] font-bold text-white">
            1
          </span>
          sessions that week, the hours they make under it
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-[#c98a12]" /> sessions longer or shorter than usual
        </span>
      </p>
    </div>
  );
}

/** One week of a strip, on hover: its sessions and how long each lasts, what they make, a holiday. */
function WeekDetail({
  component,
  lengths,
  usual,
  holidays,
}: {
  component: string;
  /** Each session's length this week. */
  lengths: number[];
  usual: number;
  holidays: TeachingWeek["holidays"];
}) {
  const count = lengths.length;
  const total = lengths.reduce((sum, one) => sum + one, 0);
  const same = new Set(lengths).size === 1;
  const odd = lengths.filter((one) => Math.abs(one - usual) > 0.001);
  return (
    <span className="block space-y-0.5">
      {count ? (
        <span className="block text-[#171717]">
          <b>
            {count} {component} session{count === 1 ? "" : "s"}
          </b>
          {same ? ` of ${figure(lengths[0])} h` : `: ${lengths.map((one) => `${figure(one)} h`).join(", ")}`}
          {count > 1 ? ` · ${figure(total)} h in all` : ""}
        </span>
      ) : (
        <span className="block">No {component} session this week.</span>
      )}
      {odd.length ? (
        <span className="block font-semibold text-[#8a6116]">
          {same ? `${lengths[0] > usual ? "Longer" : "Shorter"} than the usual ${figure(usual)} h` : `Usually ${figure(usual)} h each`}
        </span>
      ) : null}
      {holidays.map((day) => (
        <span key={day.date} className="block text-[#8a6116]">
          Holiday {formatDayAndMonth(day.date)}
          {day.label ? `: ${day.label}` : ""}
        </span>
      ))}
    </span>
  );
}

/** The courses a lead laid out, read back: one block per course, its weeks at a glance and its note. */
export function CourseScheduleSummaryBody({ step }: { step: CoursePlanSemester }) {
  return (
    // One column that never grows past the card: the week strips scroll inside it on a phone.
    <ul className="grid grid-cols-1 gap-3">
      {step.courses.map((course) => (
        <li key={course.courseCode} className="min-w-0 rounded-lg border border-[#e4e8ef] px-3 py-2.5">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm">
              <span className="font-semibold tabular-nums text-[#171717]">{course.courseCode}</span>
              {course.title ? <span className="text-[#475467]"> · {course.title}</span> : null}
            </p>
            <StandingPill course={course} />
          </div>
          {laidOut(course.weeks) ? (
            <CourseWeeks course={course} weeks={step.weeks} />
          ) : (
            <p className="text-sm text-[#667085]">Its weeks are not laid out yet.</p>
          )}
          {course.paceReason && unevenComponents(course, step.weeks.map((week) => week.week)).length ? (
            // Why the weeks run unevenly, as the lead said when the step asked.
            <p className="mt-2 rounded-md border-l-[3px] border-[#e5b454] bg-[#fdf9ee] px-3 py-2 text-sm text-[#344054]">
              <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#8a6116]">Why uneven</span>
              {course.paceReason}
            </p>
          ) : null}
          {course.note ? (
            <div className="mt-2">
              <Note>{course.note}</Note>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
