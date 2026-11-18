import { Check, Wand2 } from "lucide-react";
import { Popover } from "radix-ui";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import {
  COMPONENT_WORDS,
  componentsOf,
  figure,
  hoursLaidOut,
  lengthIn,
  sessionsOf,
  spreadEvenly,
  type Component,
  type CoursePlan,
  type Layout,
  type Lengths,
  type TeachingWeek,
} from "@/services/coursePlans";
import { formatDayAndMonth } from "@/services/weekSchedule";

/** The most sessions of one component a week can hold, and one session's longest, as the server allows. */
const MOST_SESSIONS = 7;
const LONGEST_SESSION = 8;

/** A course's weeks as the grid edits them: the sessions in each week, and the weeks of another length. */
export type ScheduleDraft = { weeks: Layout; lengths: Lengths };

/**
 * One course's sessions, week by week: a row for each of CM, TD and TP the coordinators gave
 * hours to, a column for each teaching week, and in each cell how many sessions fall that week.
 *
 * Under a box, the hours its sessions make. A week whose sessions last longer or shorter than
 * usual — a three-hour exam — is said by pressing those hours (18 Nov 2026), and shows them in
 * amber. Each row says how its hours add up against the target the coordinators set — "24 of
 * 24 h", green once it does — and, while editable, spreads the target evenly over the weeks at a
 * press. The targets are not the lead's to change: a lead who disagrees says so in the note.
 */
export function CourseScheduleGrid({
  plan,
  weeks,
  value,
  onChange,
  label,
}: {
  plan: Pick<CoursePlan, "courseCode" | "components">;
  weeks: TeachingWeek[];
  value: ScheduleDraft;
  /** Absent for the grid to read only. */
  onChange?: (value: ScheduleDraft) => void;
  /** What the grid is called to a screen reader: the course. */
  label?: string;
}) {
  const components = componentsOf(plan);
  const editable = Boolean(onChange);
  const numbers = weeks.map((week) => week.week);
  const { weeks: layout, lengths } = value;

  /** A week's own length for a component, or back to the usual one with null; nothing empty kept. */
  const withLength = (current: Lengths, component: Component, week: number, hours: number | null): Lengths => {
    const row = { ...(current[component] ?? {}) };
    if (hours === null) delete row[String(week)];
    else row[String(week)] = hours;
    const next = { ...current, [component]: row };
    if (!Object.keys(row).length) delete next[component];
    return next;
  };
  const set = (component: Component, week: number, count: number) => {
    const row = { ...(layout[component] ?? {}) };
    if (count > 0) row[String(week)] = Math.min(MOST_SESSIONS, count);
    else delete row[String(week)];
    // A week with no sessions left keeps no length of its own.
    onChange?.({ weeks: { ...layout, [component]: row }, lengths: count > 0 ? lengths : withLength(lengths, component, week, null) });
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
    <div>
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
              const usual = target.length ?? 0;
              const done = hoursLaidOut(plan, layout, component, lengths);
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
                      <b className="font-semibold text-[#344054]">{figure(usual)} h</b> session
                      {component === "CM" ? "" : ", for each group"}
                    </span>
                    {/* The running total against the locked target: green once they meet. */}
                    <span
                      data-total={component}
                      className={`mt-1 flex items-center gap-1 text-sm font-semibold tabular-nums ${met ? "text-[#2e7d55]" : "text-[#8a6116]"}`}
                      title={`${sessions} session${sessions === 1 ? "" : "s"}`}
                    >
                      {met ? <Check size={14} aria-hidden="true" /> : null}
                      {figure(done)} of {figure(target.hours ?? 0)} h
                    </span>
                    {editable ? (
                      <button
                        type="button"
                        // A fresh even spread, every session at the usual length.
                        onClick={() => {
                          const rest = { ...lengths };
                          delete rest[component];
                          onChange?.({ weeks: { ...layout, [component]: spreadEvenly(target.hours ?? 0, usual, numbers) }, lengths: rest });
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#1f4e79] hover:underline"
                      >
                        <Wand2 size={12} aria-hidden="true" /> Spread evenly
                      </button>
                    ) : null}
                  </th>
                  {weeks.map((week) => {
                    const count = layout[component]?.[String(week.week)] ?? 0;
                    const length = lengthIn(plan, lengths, component, week.week);
                    const own = String(week.week) in (lengths[component] ?? {});
                    return (
                      <td key={week.week} className={`border-b border-[#eef1f5] px-0.5 py-1 text-center align-middle ${week.holidays.length ? "bg-[#fdf9ee]" : ""}`}>
                        {editable ? (
                          <input
                            aria-label={`${component} sessions in week ${week.week}`}
                            title={`How many ${component} sessions in week ${week.week}: each is ${figure(length)} h`}
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
                              count
                                ? own
                                  ? "border-[#d99b1c] bg-[#fdf6e3] font-semibold text-[#8a6116]"
                                  : "border-[#9fb6cf] bg-[#eef4fa] font-semibold text-[#1f4e79]"
                                : "border-[#d0d5dd] bg-white"
                            }`}
                          />
                        ) : (
                          <span className={`inline-block w-7 tabular-nums ${count ? (own ? "font-semibold text-[#8a6116]" : "font-semibold text-[#1f4e79]") : "text-[#c8d0da]"}`}>
                            {count || "·"}
                          </span>
                        )}
                        {/* The hours the box makes; pressed, the week's own session length. */}
                        {count && editable ? (
                          <WeekLength
                            component={component}
                            week={week.week}
                            count={count}
                            length={length}
                            usual={usual}
                            own={own}
                            onChange={(hours) => onChange?.({ weeks: layout, lengths: withLength(lengths, component, week.week, hours) })}
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 block h-3.5 whitespace-nowrap text-[10px] leading-3 tabular-nums ${own ? "font-bold text-[#8a6116]" : "text-[#667085]"}`}
                          >
                            {count ? `${figure(count * length)} h` : ""}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editable && components.length ? (
        <p className="mt-1.5 text-xs text-[#667085]">
          A week&rsquo;s sessions longer or shorter than usual, like an exam? Press the hours under its box.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The hours under a filled box, pressed to say that week's sessions last other than usual:
 * "each session lasts 3 h", or back to the usual length.
 */
function WeekLength({
  component,
  week,
  count,
  length,
  usual,
  own,
  onChange,
}: {
  component: Component;
  week: number;
  count: number;
  length: number;
  usual: number;
  own: boolean;
  /** The week's own length in hours, or null for the usual one. */
  onChange: (hours: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(figure(length));
  const [problem, setProblem] = useState("");
  const openChange = (next: boolean) => {
    if (next) {
      setTyped(figure(length));
      setProblem("");
    }
    setOpen(next);
  };
  const done = (event: FormEvent) => {
    event.preventDefault();
    const hours = Number(typed.trim().replace(",", "."));
    if (!typed.trim() || !(hours > 0 && hours <= LONGEST_SESSION)) {
      setProblem(`A session lasts between 0 and ${LONGEST_SESSION} hours, like 3 or 1.5.`);
      return;
    }
    onChange(Math.abs(hours - usual) < 0.001 ? null : Math.round(hours * 100) / 100);
    setOpen(false);
  };
  return (
    <Popover.Root open={open} onOpenChange={openChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Length of each ${component} session in week ${week}: ${figure(length)} h`}
          title="Change how long this week's sessions last"
          className={`mx-auto mt-0.5 block h-3.5 whitespace-nowrap rounded px-0.5 text-[10px] leading-3 tabular-nums underline decoration-dotted underline-offset-2 hover:bg-[#eef4fa] ${
            own ? "font-bold text-[#8a6116]" : "text-[#667085] hover:text-[#1f4e79]"
          }`}
        >
          {figure(count * length)} h
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          sideOffset={6}
          collisionPadding={12}
          aria-label={`${component} sessions in week ${week}`}
          className="z-[100] isolate w-64 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg outline-none"
        >
          <form onSubmit={done}>
            <p className="text-sm font-semibold text-[#171717]">
              {component} · week {week}
            </p>
            <label className="mt-2 flex items-center gap-2 text-sm text-[#344054]">
              {count === 1 ? "The session lasts" : `Each of the ${count} sessions lasts`}
              <input
                aria-label={`Hours each ${component} session lasts in week ${week}`}
                inputMode="decimal"
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                className="w-16 rounded-md border border-[#b7bec8] px-2 py-1 text-sm tabular-nums"
              />
              h
            </label>
            <p className="mt-1 text-xs text-[#667085]">Usually {figure(usual)} h.</p>
            {problem ? (
              <p role="alert" className="mt-1 text-xs text-[#a6292f]">
                {problem}
              </p>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-2">
              {own ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="text-xs font-semibold text-[#1f4e79] underline"
                >
                  Back to {figure(usual)} h
                </button>
              ) : (
                <span />
              )}
              <button type="submit" className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white">
                Done
              </button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
