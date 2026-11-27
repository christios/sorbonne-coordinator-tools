import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { SelectMenu } from "@/components/SelectMenu";
import { TimeField } from "@/components/TimeField";
import { cycleLabel, opensOnFor, periodContaining, periodLabel, PERIOD_OPENS_ON } from "@/services/payPeriods";
import { fetchSemesterShortNames, setSemesterShortName } from "@/services/portalLists";
import { WEEKDAY_NAMES, type Period, type Plan, type PlanSettings } from "@/services/semesterPlans";
import {
  breaksOutside,
  daysWords,
  holidayDays,
  holidayRanges,
  mondayOfDay,
  periodDates,
  rangeDays,
  rangeProblem,
  rulesShort,
  semesterWeeks,
  semesterWords,
  toggleBreak,
  type HolidayRange,
} from "@/services/semesterSettings";
import { isoPlus, lengthWords } from "@/services/teacherWishes";
import { fetchPayCycles, setPayCycle } from "@/services/teachers";
import { formatDayAndMonth } from "@/services/weekSchedule";

/*
 * The Semester plan's settings as a page of their own (27 Nov 2026), in place of the dialog they
 * were: the user asked for a page with Back, holidays of several days, weeks without classes
 * picked as weeks, and the periods for everybody compact and folding, "as I will be adding
 * plenty". What is stored is unchanged.
 */

const INPUT =
  "w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm text-[#171717] focus:border-[#1f4e79] focus:outline-none";
const PRIMARY =
  "rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]";
const SECONDARY =
  "rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]";
const ADD = "inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline";
const ICON_BUTTON = "rounded-md p-1.5 text-[#667085] hover:bg-[#f2f4f7] hover:text-[#344054]";
const REMOVE = "rounded-md p-1.5 text-[#a6292f] hover:bg-[#fdf3f3]";

/** Every day a pay period may open on. Later than the 28th and February would have none. */
const PAY_DAYS = Array.from({ length: 28 }, (_, at) => at + 1);

/** A new period: the working week, its day ending at three in the afternoon, as in Ramadan. */
const NEW_PERIOD: Period = { label: "", from: "", to: "", days: [1, 2, 3, 4, 5], endsBy: "15:00", longest: null, blockFrom: "", blockTo: "", dailyMax: null };

/** Lengths to choose from, every quarter of an hour: for the longest class, and a teacher's day. */
const lengths = (from: number, to: number) =>
  Array.from({ length: (to - from) / 15 + 1 }, (_, at) => from + at * 15).map((minutes) => ({
    value: String(minutes),
    label: lengthWords(minutes),
  }));
const LONGEST_CLASS = lengths(30, 240);
const TEACHER_DAY = lengths(60, 600);

/** A period's four rules, each ticked on with the value it starts at. */
const RULES: { rule: "endsBy" | "longest" | "block" | "dailyMax"; label: string; on: Partial<Period>; off: Partial<Period> }[] = [
  { rule: "endsBy", label: "Day ends by", on: { endsBy: "15:00" }, off: { endsBy: "" } },
  { rule: "longest", label: "Longest class", on: { longest: 90 }, off: { longest: null } },
  { rule: "block", label: "No classes between", on: { blockFrom: "12:15", blockTo: "12:45" }, off: { blockFrom: "", blockTo: "" } },
  { rule: "dailyMax", label: "Most hours a day for a teacher", on: { dailyMax: 240 }, off: { dailyMax: null } },
];
const ruleOn = (period: Period, rule: (typeof RULES)[number]["rule"]) =>
  rule === "endsBy"
    ? Boolean(period.endsBy)
    : rule === "longest"
      ? Boolean(period.longest)
      : rule === "block"
        ? Boolean(period.blockFrom || period.blockTo)
        : Boolean(period.dailyMax);

function periodProblem(period: Period): string {
  if (!period.label.trim()) return "Give it a name.";
  if (!period.from || !period.to) return "Give it a first and a last day.";
  if (period.to < period.from) return "Its last day comes before its first.";
  if (!period.days.length) return "Choose at least one day.";
  if (!RULES.some((each) => ruleOn(period, each.rule))) return "Tick at least one rule.";
  if (ruleOn(period, "block") && !(period.blockFrom && period.blockTo && period.blockFrom < period.blockTo)) {
    return "Its hours with no classes end after they start.";
  }
  return "";
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#667085]">{hint}</span> : null}
    </label>
  );
}

function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid content-start gap-3 rounded-lg border border-[#e4e8ef] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="text-sm font-semibold text-[#171717]">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** A period being edited, with a key of its own so folding and removing follow it, not its place. */
type Held = { key: number; period: Period };
let nextKey = 1;
const held = (period: Period): Held => ({ key: nextKey++, period });

/** The semester being planned: its name, Week 1, how many teaching weeks, its breaks, holidays and periods. */
export function PlanSettingsPage({
  plan,
  busy,
  error,
  onSave,
  onBack,
}: {
  plan: Plan;
  busy: boolean;
  error: string;
  onSave: (settings: PlanSettings) => void;
  onBack: () => void;
}) {
  const headingId = useId();
  // Periods by their first day when the page opens, so a long list reads in order.
  const startPeriods = useMemo(
    () => [...(plan.periods ?? [])].sort((a, b) => (a.from || "9999").localeCompare(b.from || "9999")),
    [plan.periods],
  );
  const [name, setName] = useState(plan.name);
  const [weekOne, setWeekOne] = useState(plan.weekOne);
  const [weeks, setWeeks] = useState(plan.weeks);
  const [without, setWithout] = useState(plan.without);
  const [holidays, setHolidays] = useState<HolidayRange[]>(() => holidayRanges(plan.holidays));
  const [periods, setPeriods] = useState<Held[]>(() => startPeriods.map(held));
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  // The plan's short name and its pay periods' first day, saved with the rest.
  const client = useQueryClient();
  const shortNames = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false });
  const semesterId = `plan:${plan.termCode}`;
  const savedShort = shortNames.data?.[semesterId] ?? "";
  const [short, setShort] = useState(savedShort);
  useEffect(() => setShort(savedShort), [savedShort]);
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles, retry: false });
  const savedPayDay = opensOnFor(cycles.data?.cycles ?? {}, semesterId, cycles.data?.default ?? PERIOD_OPENS_ON);
  const [payDay, setPayDay] = useState(savedPayDay);
  useEffect(() => setPayDay(savedPayDay), [savedPayDay]);

  const settings: PlanSettings = {
    name,
    weekOne,
    weeks,
    without,
    holidays: holidayDays(holidays),
    periods: periods.map((each) => each.period),
  };
  const dirty =
    JSON.stringify(settings) !==
      JSON.stringify({ name: plan.name, weekOne: plan.weekOne, weeks: plan.weeks, without: plan.without, holidays: holidayDays(holidayRanges(plan.holidays)), periods: startPeriods }) ||
    short.trim() !== savedShort ||
    payDay !== savedPayDay;

  // What stands in the way of saving, the first of it said beside Save.
  const problems = [
    !weekOne ? "Set Week 1." : "",
    weeks < 1 ? "Say how many teaching weeks it has." : "",
    ...holidays.map((range, index) => {
      const problem = rangeProblem(range);
      return problem ? `Holiday ${range.label || index + 1}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` : "";
    }),
    ...periods.map(({ period }, index) => {
      const problem = periodProblem(period);
      return problem ? `${period.label || `Period ${index + 1}`}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` : "";
    }),
  ].filter(Boolean);
  const ready = problems.length === 0;

  const save = () => {
    if (short.trim() !== savedShort) {
      void setSemesterShortName(semesterId, short.trim()).then(() => client.invalidateQueries({ queryKey: ["semester-short-names"] }));
    }
    if (payDay !== savedPayDay) {
      void setPayCycle(semesterId, payDay).then(() => client.invalidateQueries({ queryKey: ["pay-cycles"] }));
    }
    onSave(settings);
  };
  const [leaving, setLeaving] = useState(false);
  const back = () => (dirty ? setLeaving(true) : onBack());

  const theWeeks = semesterWeeks(weekOne, weeks, without);
  const outside = breaksOutside(weekOne, weeks, without);
  const allDays = holidayDays(holidays);
  const holidayIn = (monday: string) => allDays.filter((day) => day.date >= monday && day.date <= isoPlus(monday, 6));
  const periodsIn = (monday: string) =>
    periods.filter(({ period }) => period.from && period.to && period.from <= isoPlus(monday, 6) && period.to >= monday);
  const holidayNote = (range: HolidayRange) => {
    if (!range.from || !theWeeks.length) return "";
    const first = theWeeks[0].monday;
    const last = isoPlus(theWeeks[theWeeks.length - 1].monday, 6);
    if ((range.to || range.from) < first || range.from > last) return "Outside the semester's weeks: it takes no class away.";
    const breaks = new Set(theWeeks.filter((week) => week.number === null).map((week) => week.monday));
    const inBreak = holidayDays([range]).every((day) => breaks.has(mondayOfDay(day.date)));
    return inBreak ? "Falls in a break: it takes no class away." : "";
  };

  const setPeriod = (key: number, patch: Partial<Period>) =>
    setPeriods((current) => current.map((each) => (each.key === key ? { ...each, period: { ...each.period, ...patch } } : each)));
  const fold = (key: number, to?: boolean) =>
    setOpen((current) => {
      const next = new Set(current);
      if (to ?? !next.has(key)) next.add(key);
      else next.delete(key);
      return next;
    });
  const addPeriod = (from: Period = NEW_PERIOD, copy = false) => {
    const fresh = held({ ...from, label: copy ? `${from.label} (copy)` : from.label, days: [...from.days] });
    setPeriods((current) => [...current, fresh]);
    fold(fresh.key, true);
  };
  const shown = search.trim()
    ? periods.filter(({ period }) => period.label.toLowerCase().includes(search.trim().toLowerCase()))
    : periods;

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-[#d9dee7] bg-[#f8fafc]">
      {/* The page's bar: back to the list, what this is, and Save — kept in sight while scrolling. */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-[#e4e8ef] bg-white px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={back} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">
            <ArrowLeft size={16} aria-hidden="true" /> Semesters
          </button>
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-[#171717]">
              Semester settings
            </h2>
            <p className="truncate text-xs text-[#667085]">{plan.name || plan.termCode}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!ready ? (
            <span role="status" className="max-w-[22rem] truncate text-xs font-medium text-[#a6292f]" title={problems.join("\n")}>
              {problems[0]}
              {problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}
            </span>
          ) : dirty ? (
            <span className="text-xs font-medium text-[#b54708]">Unsaved changes</span>
          ) : null}
          <button type="button" onClick={back} className={SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!ready || busy || !dirty} onClick={save} className={PRIMARY}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {error ? (
        <p role="alert" className="mx-5 mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-4">
          <Card title="Name">
            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field label="Name">
                <input value={name} onChange={(event) => setName(event.target.value)} className={INPUT} />
              </Field>
              {/* What the menus call it, in front of its name: S2. */}
              <Field label="Short name">
                <input value={short} maxLength={12} placeholder="S2" onChange={(event) => setShort(event.target.value)} className={`${INPUT} w-24`} />
              </Field>
            </div>
          </Card>

          <Card title="Weeks and breaks">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DateField label="Week 1" value={weekOne} onChange={setWeekOne} required />
              <Field label="Teaching weeks" hint="Breaks not counted">
                <input
                  inputMode="numeric"
                  value={weeks || ""}
                  onChange={(event) => setWeeks(Math.min(30, Number(event.target.value.replace(/\D/g, "")) || 0))}
                  className={INPUT}
                />
              </Field>
            </div>
            <p className="rounded-md bg-[#f2f7fb] px-3 py-2 text-sm font-medium text-[#1f4e79]">{semesterWords(weekOne, weeks, without)}</p>
            {theWeeks.length ? (
              <div className="grid gap-2">
                <span className="text-xs text-[#667085]">
                  Weeks without classes: press a week to make it a break, press a break to teach that week again. The weeks after
                  it move a week on.
                </span>
                <div role="group" aria-label="The semester's weeks" className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5">
                  {theWeeks.map((week) => {
                    const isBreak = week.number === null;
                    const off = holidayIn(week.monday);
                    const inPeriods = periodsIn(week.monday);
                    const date = formatDayAndMonth(week.monday);
                    const marks = [
                      ...off.map((day) => `${formatDayAndMonth(day.date)} ${day.label}`.trim()),
                      ...inPeriods.map(({ period }) => period.label),
                    ];
                    return (
                      <button
                        key={week.monday}
                        type="button"
                        disabled={week.number === 1}
                        aria-pressed={isBreak}
                        aria-label={isBreak ? `Break, week of ${date}: teach this week again` : `Week ${week.number}, ${date}${week.number === 1 ? "" : ": make it a break"}`}
                        title={marks.join("\n") || undefined}
                        onClick={() => setWithout(toggleBreak(without, week.monday))}
                        className={`relative grid rounded-md border px-1.5 py-1 text-left leading-tight ${
                          isBreak
                            ? "border-dashed border-[#98a2b3] bg-[#eef0f3] text-[#667085] hover:bg-[#e4e7ec]"
                            : week.number === 1
                              ? "cursor-default border-[#1f4e79] bg-[#f2f7fb] text-[#1f4e79]"
                              : "border-[#d9dee7] bg-white text-[#171717] hover:border-[#1f4e79] hover:bg-[#f8fafc]"
                        }`}
                      >
                        <span className="text-xs font-semibold">{isBreak ? "Break" : `Week ${week.number}`}</span>
                        <span className="text-[11px] text-[#667085]">{date}</span>
                        <span className="absolute right-1 top-1 flex gap-0.5" aria-hidden="true">
                          {off.length ? <span className="h-1.5 w-1.5 rounded-full bg-[#dc6803]" /> : null}
                          {inPeriods.length ? <span className="h-1.5 w-1.5 rounded-full bg-[#7a5af8]" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className="flex flex-wrap gap-3 text-[11px] text-[#667085]">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#dc6803]" /> a holiday that week
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#7a5af8]" /> a period for everybody that week
                  </span>
                </span>
                {outside.map((monday) => (
                  <span key={monday} className="flex items-center gap-2 text-xs text-[#b54708]">
                    A break on the week of {formatDayAndMonth(monday)} {monday.slice(0, 4)} is outside these weeks.
                    <button type="button" onClick={() => setWithout(toggleBreak(without, monday))} className="font-semibold underline">
                      Remove it
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </Card>

          <Card
            title="Holidays"
            aside={<span className="text-xs text-[#667085]">{holidays.length ? `${holidays.length} · ${allDays.length} day${allDays.length === 1 ? "" : "s"}` : ""}</span>}
          >
            {holidays.map((range, index) => {
              const problem = rangeProblem(range);
              const days = rangeDays({ from: range.from, to: range.to || range.from });
              const note = problem || holidayNote(range);
              const setRange = (patch: Partial<HolidayRange>) =>
                setHolidays((current) => current.map((each, at) => (at === index ? { ...each, ...patch } : each)));
              return (
                <div key={index} className="grid gap-1 border-b border-[#f2f4f7] pb-2 last:border-b-0 last:pb-0">
                  <div className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,9.5rem)_minmax(0,1fr)_auto] items-end gap-2">
                    <DateField label="First day" value={range.from} onChange={(from) => setRange({ from, to: !range.to || range.to < from ? from : range.to })} />
                    <DateField label="Last day" value={range.to} onChange={(to) => setRange({ to })} />
                    <Field label="Name">
                      <input value={range.label} onChange={(event) => setRange({ label: event.target.value })} placeholder="Eid al-Fitr" className={INPUT} />
                    </Field>
                    <button
                      type="button"
                      aria-label={`Remove holiday ${range.label || index + 1}`}
                      onClick={() => setHolidays((current) => current.filter((_, at) => at !== index))}
                      className={`${REMOVE} mb-1.5`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <span className={`text-xs ${problem ? "text-[#a6292f]" : "text-[#667085]"}`}>
                    {problem ? problem : `${days} day${days === 1 ? "" : "s"}`}
                    {!problem && note ? ` · ${note}` : ""}
                  </span>
                </div>
              );
            })}
            <button type="button" onClick={() => setHolidays((current) => [...current, { from: "", to: "", label: "" }])} className={ADD}>
              <Plus size={15} /> Add a holiday
            </button>
            <span className="text-xs text-[#667085]">
              A holiday may last several days: give its first and last day. A class that falls on one is not held; the plan lists what
              each holiday takes away.
            </span>
          </Card>

          <Card title="Pay periods">
            <div className="w-56">
              <SelectMenu
                label="Pay periods"
                value={String(payDay)}
                onChange={(chosen) => setPayDay(Number(chosen))}
                disabled={cycles.isLoading}
                options={PAY_DAYS.map((day) => ({ value: String(day), label: `Opens ${cycleLabel(day)}` }))}
              />
            </div>
            <span className="text-xs text-[#667085]">What a part-time claim covers: now {periodLabel(periodContaining(new Date(), payDay))}.</span>
          </Card>
        </div>

        <Card
          title="Periods for everybody"
          aside={
            periods.length ? (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#667085]">{periods.length}</span>
                <button type="button" onClick={() => setOpen(new Set())} className="font-semibold text-[#1f4e79] hover:underline">
                  Fold all
                </button>
              </div>
            ) : null
          }
        >
          <span className="text-xs text-[#667085]">
            Ramadan, an exam week: rules for everyone, checked for the classes inside the period. The hours with no classes and the
            hours after the day ends are shaded on the plan; a class that breaks any rule is flagged.
          </span>
          {periods.length > 6 ? (
            <label className="relative block">
              <span className="sr-only">Search periods</span>
              <Search size={14} className="absolute left-2.5 top-2.5 text-[#98a2b3]" aria-hidden="true" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search periods" className={`${INPUT} py-1.5 pl-8`} />
            </label>
          ) : null}
          <ul className="grid divide-y divide-[#eef0f3] rounded-md border border-[#e4e8ef]">
            {shown.map(({ key, period }) => {
              const problem = periodProblem(period);
              const isOpen = open.has(key);
              const title = period.label || "New period";
              return (
                <li key={key} className={isOpen ? "bg-[#fcfdfe]" : ""}>
                  {/* One line a period: its name, dates, days and rules; pressed, it opens to be edited. */}
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Fold" : "Edit"} ${title}`}
                      onClick={() => fold(key)}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-[#f2f4f7]"
                    >
                      {isOpen ? <ChevronDown size={15} className="shrink-0 text-[#667085]" /> : <ChevronRight size={15} className="shrink-0 text-[#667085]" />}
                      <span className="shrink-0 text-sm font-semibold text-[#171717]">{title}</span>
                      <span className="shrink-0 text-xs text-[#475467]">{periodDates(period)}</span>
                      <span className="shrink-0 text-xs text-[#98a2b3]">{period.days.length ? daysWords(period.days) : ""}</span>
                      <span className={`min-w-0 truncate text-xs ${problem ? "font-medium text-[#a6292f]" : "text-[#667085]"}`}>
                        {problem || rulesShort(period)}
                      </span>
                    </button>
                    <button type="button" aria-label={`Copy ${title}`} title="Copy it, to make another like it" onClick={() => addPeriod(period, true)} className={ICON_BUTTON}>
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${period.label || "period"}`}
                      onClick={() => setPeriods((current) => current.filter((each) => each.key !== key))}
                      className={REMOVE}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {isOpen ? (
                    <fieldset className="grid gap-3 border-t border-[#eef0f3] px-3 pb-3 pt-2">
                      <legend className="sr-only">{title}</legend>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]">
                        <Field label="Name">
                          <input value={period.label} onChange={(event) => setPeriod(key, { label: event.target.value })} placeholder="Ramadan" className={INPUT} />
                        </Field>
                        <DateField label="From" value={period.from} onChange={(from) => setPeriod(key, { from, to: !period.to || period.to < from ? from : period.to })} />
                        <DateField label="To" value={period.to} onChange={(to) => setPeriod(key, { to })} />
                      </div>
                      <div role="group" aria-label="Days it covers" className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-sm font-medium text-[#344054]">On</span>
                        {WEEKDAY_NAMES.map((dayName, at) => {
                          const day = at + 1;
                          const on = period.days.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              aria-pressed={on}
                              aria-label={dayName}
                              onClick={() =>
                                setPeriod(key, { days: on ? period.days.filter((each) => each !== day) : [...period.days, day].sort((a, b) => a - b) })
                              }
                              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                                on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
                              }`}
                            >
                              {dayName.slice(0, 3)}
                            </button>
                          );
                        })}
                      </div>
                      {/* Its rules: any of the four, each ticked on and given its value, two to a row. */}
                      <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Its rules">
                        {RULES.map((each) => {
                          const on = ruleOn(period, each.rule);
                          return (
                            <div key={each.rule} className="grid content-start gap-1.5 rounded-md border border-[#eef0f3] p-2">
                              <label className="inline-flex items-center gap-2 text-sm text-[#344054]">
                                <input
                                  type="checkbox"
                                  checked={on}
                                  onChange={(event) => setPeriod(key, event.target.checked ? each.on : each.off)}
                                  className="h-4 w-4 accent-[#1f4e79]"
                                />
                                {each.label}
                              </label>
                              {!on ? null : each.rule === "endsBy" ? (
                                <TimeField label="Ends by" value={period.endsBy ?? ""} onChange={(endsBy) => setPeriod(key, { endsBy })} />
                              ) : each.rule === "longest" ? (
                                <SelectMenu label="Longest class" value={String(period.longest ?? "")} onChange={(value) => setPeriod(key, { longest: Number(value) })} options={LONGEST_CLASS} />
                              ) : each.rule === "block" ? (
                                <div className="grid grid-cols-2 gap-2">
                                  <TimeField label="From" value={period.blockFrom} onChange={(blockFrom) => setPeriod(key, { blockFrom })} />
                                  <TimeField label="Until" value={period.blockTo} onChange={(blockTo) => setPeriod(key, { blockTo })} />
                                </div>
                              ) : (
                                <SelectMenu
                                  label="Most hours a day for a teacher"
                                  value={String(period.dailyMax ?? "")}
                                  onChange={(value) => setPeriod(key, { dailyMax: Number(value) })}
                                  options={TEACHER_DAY}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {problem ? <p className="text-xs text-[#a6292f]">{problem}</p> : null}
                      <button type="button" onClick={() => fold(key, false)} className="w-fit text-xs font-semibold text-[#1f4e79] hover:underline">
                        Done
                      </button>
                    </fieldset>
                  ) : null}
                </li>
              );
            })}
            {!shown.length ? <li className="px-3 py-3 text-sm text-[#667085]">{periods.length ? "No period by that name." : "No period yet."}</li> : null}
          </ul>
          <button type="button" onClick={() => addPeriod()} className={ADD}>
            <Plus size={15} /> Add a period
          </button>
        </Card>
      </div>

      <ConfirmDialog
        open={leaving}
        title="Discard your changes?"
        description="The settings you changed here are not saved yet."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setLeaving(false);
          onBack();
        }}
        onClose={() => setLeaving(false)}
      />
    </section>
  );
}
