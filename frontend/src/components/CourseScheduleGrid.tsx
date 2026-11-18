import { Check, Wand2 } from "lucide-react";
import type { KeyboardEvent } from "react";

import {
  COMPONENT_WORDS,
  componentsOf,
  figure,
  hoursLaidOut,
  sessionsOf,
  spreadEvenly,
  type Component,
  type CoursePlan,
  type Layout,
  type TeachingWeek,
} from "@/services/coursePlans";
import { formatDayAndMonth } from "@/services/weekSchedule";

/** The most sessions of one component a week can hold, as the server allows. */
const MOST_SESSIONS = 7;

/**
 * One course's sessions, week by week: a row for each of CM, TD and TP the coordinators gave
 * hours to, a column for each teaching week, and in each cell how many sessions fall that week.
 *
 * Each row says how its sessions add up against the target the coordinators set — "24 of
 * 24 h", green once it does — and, while editable, spreads the target evenly over the weeks
 * at a press. The targets are not the lead's to change: a lead who disagrees says so in the
 * note beside the grid.
 */
export function CourseScheduleGrid({
  plan,
  weeks,
  layout,
  onChange,
  label,
}: {
  plan: Pick<CoursePlan, "courseCode" | "components">;
  weeks: TeachingWeek[];
  layout: Layout;
  /** Absent for the grid to read only. */
  onChange?: (layout: Layout) => void;
  /** What the grid is called to a screen reader: the course. */
  label?: string;
}) {
  const components = componentsOf(plan);
  const editable = Boolean(onChange);
  const numbers = weeks.map((week) => week.week);

  const set = (component: Component, week: number, count: number) => {
    const row = { ...(layout[component] ?? {}) };
    if (count > 0) row[String(week)] = Math.min(MOST_SESSIONS, count);
    else delete row[String(week)];
    onChange?.({ ...layout, [component]: row });
  };
  const keys = (component: Component, week: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    const held = layout[component]?.[String(week)] ?? 0;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      set(component, week, held + 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      set(component, week, held - 1);
    }
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-[#d0d5dd]">
      <table aria-label={label ?? `${plan.courseCode} week by week`} className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="bg-[#f5f7fa] text-[11px] text-[#475467]">
            <th scope="col" className="sticky left-0 z-10 min-w-[13.5rem] border-b border-r border-[#d0d5dd] bg-[#f5f7fa] px-3 py-1.5 text-left font-semibold uppercase tracking-wide">
              Teaching week
            </th>
            {weeks.map((week) => {
              const holiday = week.holidays.map((day) => `${formatDayAndMonth(day.date)}${day.label ? `: ${day.label}` : ""}`).join("\n");
              return (
                <th
                  key={week.week}
                  scope="col"
                  title={holiday ? `Holiday in this week — ${holiday}` : undefined}
                  className="min-w-[2.6rem] border-b border-[#d0d5dd] px-0.5 py-1.5 text-center font-semibold"
                >
                  <span className="block text-[#171717]">{week.week}</span>
                  {week.monday ? <span className="block whitespace-nowrap text-[10px] font-normal text-[#667085]">{formatDayAndMonth(week.monday)}</span> : null}
                  {holiday ? (
                    <span className="mx-auto mt-0.5 block h-1.5 w-1.5 rounded-full bg-[#d99b1c]" aria-label="A holiday falls in this week" />
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {components.map((component) => {
            const target = plan.components[component];
            const done = hoursLaidOut(plan, layout, component);
            const sessions = sessionsOf(layout[component]);
            const met = Math.abs(done - (target.hours ?? 0)) < 0.01;
            return (
              <tr key={component}>
                <th scope="row" className="sticky left-0 z-10 border-b border-r border-[#d0d5dd] bg-white px-3 py-2 text-left align-top font-normal">
                  <span className="flex items-baseline gap-2">
                    <span className="rounded bg-[#e8edf3] px-1.5 text-xs font-bold text-[#1f4e79]">{component}</span>
                    <span className="text-xs text-[#475467]">{COMPONENT_WORDS[component].replace(` (${component})`, "")}</span>
                  </span>
                  {/* What a number in a box stands for: sessions, not hours (18 Nov 2026: "1" was not read as 1.5 h). */}
                  <span className="mt-1 block text-[11px] leading-4 text-[#475467]">
                    <b className="rounded border border-[#9fb6cf] bg-[#eef4fa] px-1 font-semibold text-[#1f4e79]">1</b> in a box = one{" "}
                    <b className="font-semibold text-[#344054]">{figure(target.length ?? 0)} h</b> session
                    {component === "CM" ? "" : ", for each group"}
                  </span>
                  {/* The running total against the locked target: green once they meet. */}
                  <span
                    data-total={component}
                    className={`mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums ${met ? "text-[#2e7d55]" : "text-[#8a6116]"}`}
                    title={`${sessions} session${sessions === 1 ? "" : "s"} of ${figure(target.length ?? 0)} h`}
                  >
                    {met ? <Check size={14} aria-hidden="true" /> : null}
                    {figure(done)} of {figure(target.hours ?? 0)} h
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => onChange?.({ ...layout, [component]: spreadEvenly(target.hours ?? 0, target.length ?? 0, numbers) })}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#1f4e79] hover:underline"
                    >
                      <Wand2 size={12} aria-hidden="true" /> Spread evenly
                    </button>
                  ) : null}
                </th>
                {weeks.map((week) => {
                  const count = layout[component]?.[String(week.week)] ?? 0;
                  // The hours a box makes, under it: the sessions times one session's length.
                  const hours = (
                    <span aria-hidden="true" className="mt-0.5 block h-3.5 whitespace-nowrap text-[10px] leading-3 tabular-nums text-[#667085]">
                      {count ? `${figure(count * (target.length ?? 0))} h` : ""}
                    </span>
                  );
                  return (
                    <td key={week.week} className={`border-b border-[#eef1f5] px-0.5 py-1 text-center align-middle ${week.holidays.length ? "bg-[#fdf9ee]" : ""}`}>
                      {editable ? (
                        <input
                          aria-label={`${component} sessions in week ${week.week}`}
                          title={`How many ${component} sessions in week ${week.week}: each is ${figure(target.length ?? 0)} h`}
                          inputMode="numeric"
                          value={count ? String(count) : ""}
                          placeholder="·"
                          onFocus={(event) => event.target.select()}
                          onKeyDown={keys(component, week.week)}
                          onChange={(event) => {
                            const typed = event.target.value.replace(/\D/g, "").slice(-1);
                            set(component, week.week, typed ? Number(typed) : 0);
                          }}
                          className={`h-8 w-9 rounded border text-center text-sm tabular-nums placeholder:text-[#c8d0da] focus:border-[#1f4e79] focus:outline-none focus:ring-1 focus:ring-[#1f4e79] ${
                            count ? "border-[#9fb6cf] bg-[#eef4fa] font-semibold text-[#1f4e79]" : "border-[#d0d5dd] bg-white"
                          }`}
                        />
                      ) : (
                        <span className={`inline-block w-7 tabular-nums ${count ? "font-semibold text-[#1f4e79]" : "text-[#c8d0da]"}`}>
                          {count || "·"}
                        </span>
                      )}
                      {hours}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
