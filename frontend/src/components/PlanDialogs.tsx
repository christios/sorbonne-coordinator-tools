import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { TimeField } from "@/components/TimeField";
import {
  WEEKDAY_NAMES,
  weeksSaid,
  type Holiday,
  type Period,
  type Plan,
  type PlanSection,
  type PlanSettings,
  type Scope,
  type Slot,
} from "@/services/semesterPlans";
import { fetchSemesterShortNames, setSemesterShortName } from "@/services/portalLists";
import { cycleLabel, opensOnFor, periodContaining, periodLabel, PERIOD_OPENS_ON } from "@/services/payPeriods";
import { fetchPayCycles, setPayCycle } from "@/services/teachers";
import { judgeSlot } from "@/services/planJudge";
import { awayWords, describeLine, lengthWords, type WishTeacher } from "@/services/teacherWishes";
import { formatDayAndMonth, minutesOf, toIsoDate, weekStartOf } from "@/services/weekSchedule";

export const INPUT =
  "w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm text-[#171717] focus:border-[#1f4e79] focus:outline-none";
const PRIMARY =
  "rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]";
const SECONDARY =
  "rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]";

/** Every day a pay period may open on. Later than the 28th and February would have none. */
const PAY_DAYS = Array.from({ length: 28 }, (_, at) => at + 1);

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#667085]">{hint}</span> : null}
    </label>
  );
}

/** The teaching weeks, one button each: pressed is a week the class meets in. */
export function WeekPicker({
  count,
  value,
  onChange,
  dateOf,
}: {
  count: number;
  value: number[];
  onChange: (weeks: number[]) => void;
  /** The Monday of a week, for its title. */
  dateOf: (week: number) => string;
}) {
  const all = Array.from({ length: count }, (_, index) => index + 1);
  const chosen = new Set(value);
  const toggle = (week: number) =>
    onChange(chosen.has(week) ? value.filter((each) => each !== week) : [...value, week].sort((a, b) => a - b));
  const preset = (label: string, weeks: number[]) => (
    <button
      type="button"
      onClick={() => onChange(weeks)}
      className="rounded-full border border-[#d0d5dd] px-2.5 py-0.5 text-xs font-semibold text-[#344054] hover:bg-[#f2f7fb]"
    >
      {label}
    </button>
  );
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {preset("Every week", all)}
        {preset("Odd weeks", all.filter((week) => week % 2 === 1))}
        {preset("Even weeks", all.filter((week) => week % 2 === 0))}
        {preset("First half", all.slice(0, Math.ceil(count / 2)))}
        {preset("Second half", all.slice(Math.ceil(count / 2)))}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Teaching weeks">
        {all.map((week) => (
          <button
            key={week}
            type="button"
            aria-pressed={chosen.has(week)}
            title={`Week ${week}, from ${dateOf(week)}`}
            onClick={() => toggle(week)}
            className={`h-8 w-8 rounded-md text-xs font-semibold tabular-nums ${
              chosen.has(week)
                ? "bg-[#e3ecf5] text-[#1f4e79] ring-1 ring-inset ring-[#1f4e79]/25 hover:bg-[#d6e3f0]"
                : "border border-[#e4e8ef] bg-white text-[#98a2b3] hover:bg-[#f8fafc]"
            }`}
          >
            {week}
          </button>
        ))}
      </div>
      <span className="text-xs text-[#667085]">
        {weeksSaid(value)} · {value.length} class{value.length === 1 ? "" : "es"}
      </span>
    </div>
  );
}

export type ClassDraft = Slot & { sectionId: string; weeks: number[]; note: string };

function sectionOption(section: PlanSection): SelectOption {
  return {
    value: section.id,
    // Every group of a course is a class of its own, so the group is what tells them apart.
    label: [section.courseCode, section.title, section.groupLabel].filter(Boolean).join(" · "),
    badge: section.crn ? `CRN ${section.crn}` : undefined,
    badgeTone: "muted",
    searchText: `${section.crn} ${section.teacherName} ${section.programmes.join(" ")} ${section.groupLabel}`,
  };
}

const hoursWords = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours && rest ? `${hours} h ${String(rest).padStart(2, "0")}` : hours ? `${hours} h` : `${rest} min`;
};

/**
 * The wishes of the teacher of a class, folded to one line: how many, and whether the time
 * chosen keeps them. Opened, the whole list — Musts first, each with why it matters, the ones
 * this time breaks marked — and their dates away, needs and note.
 */
function WishesStrip({
  teacher,
  weekday,
  startsAt,
  endsAt,
}: {
  teacher: WishTeacher;
  weekday: number;
  startsAt: string;
  endsAt: string;
}) {
  const [open, setOpen] = useState(false);
  const wishes = teacher.wishes;
  if (!wishes) {
    return <p className="pt-2 text-sm text-[#667085]">{teacher.name} hasn&rsquo;t given their preferences for this semester.</p>;
  }
  const start = minutesOf(startsAt);
  const end = minutesOf(endsAt);
  const lines = [...wishes.lines].sort((left, right) => Number(left.level !== "must") - Number(right.level !== "must"));
  const brokenHere = (line: (typeof lines)[number]) =>
    (line.kind === "cant" && line.days.includes(weekday) && start < line.to * 60 && end > line.from * 60) ||
    (line.kind === "freeDay" && line.value === weekday);
  const musts = lines.filter((line) => line.level === "must").length;
  const broken = lines.filter(brokenHere).length;
  const extras = wishes.away.length + (wishes.needs ? 1 : 0) + (wishes.note ? 1 : 0);
  return (
    <div className="grid gap-2 pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[#344054]">
          {lines.length
            ? `${musts} Must${musts === 1 ? "" : "s"} · ${lines.length - musts} Would like${lines.length - musts === 1 ? "" : "s"}`
            : "No preferences on the week"}
        </span>
        {lines.length ? (
          broken ? (
            <span className="font-medium text-[#a6292f]">· {broken} broken at this time</span>
          ) : (
            <span className="text-[#2e7d55]">· this time keeps them</span>
          )
        ) : null}
        {wishes.status === "draft" ? <span className="text-[#98a2b3]">(a draft)</span> : null}
        {lines.length || extras ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
            className="ml-auto inline-flex items-center gap-0.5 text-xs font-semibold text-[#1f4e79] hover:underline"
          >
            {open ? "Hide" : "Show all"}
            <ChevronDown size={13} aria-hidden="true" className={open ? "rotate-180" : ""} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="grid gap-2">
          {lines.length ? (
            <ul className="grid gap-1.5" aria-label={`${teacher.name}'s preferences`}>
              {lines.map((line) => (
                <li key={line.key} className="flex items-start gap-2">
                  <span
                    className={`mt-px shrink-0 rounded px-1.5 text-[11px] font-semibold ${
                      line.level === "must" ? "bg-[#fdf3f3] text-[#a6292f]" : "bg-[#fdf6e3] text-[#8a6116]"
                    }`}
                  >
                    {line.level === "must" ? "Must" : "Would like"}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[#344054]">{describeLine(line)}</span>
                    {brokenHere(line) ? <span className="font-medium text-[#a6292f]"> — this time breaks it</span> : null}
                    {line.comment ? <span className="block text-xs text-[#667085]">&ldquo;{line.comment}&rdquo;</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {wishes.away.length ? (
            <p className="text-[#667085]">
              Away{" "}
              {wishes.away.map((entry) => `${awayWords(entry)}${entry.reason ? ` (${entry.reason})` : ""}`).join(", ")}
            </p>
          ) : null}
          {wishes.needs ? <p className="text-[#667085]">Needs: {wishes.needs}</p> : null}
          {wishes.note ? <p className="text-[#667085]">Note: {wishes.note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** One part of the class: its name down the left, what it is beside it, on the same grid as the rest. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-5" aria-label={label}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3] sm:pt-2.5">{label}</h3>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** A field's name over it, as the time fields say theirs. */
function Small({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">{title}</span>
      {children}
    </div>
  );
}

/**
 * A class on the calendar: which class it is, when, where, who teaches it, and — for a new
 * one or a whole series — the weeks it repeats in.
 *
 * What would go wrong at the time chosen — a clash, a wish broken — is said first, in a
 * strip of its own, and the rest is quiet: one grid, one size of type, colour only where
 * something needs seeing. The teacher's wishes are a line that opens to the whole list.
 *
 * `single` is a class opened from the calendar that belongs to a series of more than one
 * week: its weeks are the series', so they are shown and can be changed, but changing them
 * (or the note) is a change to the whole series, and the dialog says so.
 */
export function PlanClassDialog({
  open,
  plan,
  rooms,
  initial,
  editing,
  busy,
  error,
  onSave,
  onDelete,
  onClose,
  wishTeachers,
}: {
  open: boolean;
  plan: Plan;
  rooms: string[];
  initial: ClassDraft;
  /** The semester's teachers and their wishes, when wishes are being collected for it. */
  wishTeachers?: WishTeacher[];
  /** Present when an existing class was opened: its week, date, series and who last changed it. */
  editing?: { week: number; meetsOn: string; seriesWeeks: number; seriesId?: string; updatedBy: string; updatedAt: string };
  busy: boolean;
  error: string;
  onSave: (draft: ClassDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  useEffect(() => setDraft(initial), [initial]);
  const set = (patch: Partial<ClassDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const section = plan.sections.find((entry) => entry.id === draft.sectionId);
  const teacherWishes = section?.teacherId ? wishTeachers?.find((row) => row.teacherId === section.teacherId) : undefined;
  // A class no longer on Groups & CRNs is not placed again; it is only shown where it already is.
  const sectionOptions = useMemo(
    () => plan.sections.filter((entry) => !entry.gone || entry.id === draft.sectionId).map(sectionOption),
    [plan.sections, draft.sectionId],
  );
  const roomOptions = useMemo(() => {
    const known = [...new Set([...rooms, ...(draft.room ? [draft.room] : [])])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    return [{ value: "", label: "No room yet" }, ...known.map((room) => ({ value: room, label: room }))];
  }, [rooms, draft.room]);
  const calendar = { weekOne: plan.weekOne, without: plan.without };
  const dateOf = (week: number) => formatDayAndMonth(toIsoDate(weekStartOf(week, calendar)));
  const ready = Boolean(draft.sectionId) && draft.startsAt < draft.endsAt && draft.weeks.length > 0;
  const length = minutesOf(draft.endsAt) - minutesOf(draft.startsAt);

  // What would go wrong at this time, in the weeks chosen: the series' own classes aside.
  const weeksKey = draft.weeks.join(",");
  const { problems } = useMemo(
    () =>
      draft.sectionId && length > 0
        ? judgeSlot(plan, wishTeachers, {
            sectionId: draft.sectionId,
            weekday: draft.weekday,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            room: draft.room,
            weeks: weeksKey ? weeksKey.split(",").map(Number) : [],
            replacing: editing?.seriesId ? { seriesId: editing.seriesId } : undefined,
          })
        : { problems: [] },
    [plan, wishTeachers, draft.sectionId, draft.weekday, draft.startsAt, draft.endsAt, draft.room, weeksKey, length, editing?.seriesId],
  );
  const serious = problems.some((problem) => problem.level === "must");

  const facts = section
    ? [
        section.component,
        length > 0 ? `${hoursWords(length)} a class` : "",
        section.hours ? `${section.hours} h in all` : section.hoursSaid,
        section.crn ? `CRN ${section.crn}` : "No CRN yet",
        section.programmes.join(", "),
      ].filter(Boolean)
    : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={section ? [section.courseCode, section.groupLabel].filter(Boolean).join(" · ") || section.title : "Place a class"}
      description={
        section
          ? [
              section.title,
              editing
                ? `Week ${editing.week}, ${WEEKDAY_NAMES[draft.weekday - 1]} ${formatDayAndMonth(editing.meetsOn)}${
                    editing.seriesWeeks > 1 ? ` · one of ${editing.seriesWeeks} in its series` : ""
                  }`
                : "",
            ]
              .filter(Boolean)
              .join(" — ")
          : "Which class, when it meets, and the weeks it repeats in."
      }
      header={
        facts.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {facts.map((fact) => (
              <span key={fact} className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs text-[#475467]">
                {fact}
              </span>
            ))}
          </div>
        ) : null
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold text-[#667085] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
              >
                <Trash2 size={15} /> Delete
              </button>
            ) : null}
            {editing?.updatedBy ? (
              <span className="hidden text-xs text-[#98a2b3] sm:inline">
                Last changed by {editing.updatedBy}
                {editing.updatedAt ? `, ${new Date(editing.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
              </span>
            ) : null}
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className={SECONDARY}>
              Cancel
            </button>
            <button type="button" disabled={!ready || busy} onClick={() => onSave(draft)} className={PRIMARY}>
              {busy ? "Saving…" : editing ? "Save" : "Place it"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 py-1">
        {problems.length ? (
          <div role="status" className={`rounded-lg px-4 py-3 ${serious ? "bg-[#fdf3f3]" : "bg-[#fdf8ec]"}`}>
            <p className={`text-sm font-semibold ${serious ? "text-[#a6292f]" : "text-[#8a6116]"}`}>
              {problems.length === 1 ? "1 problem at this time" : `${problems.length} problems at this time`}
            </p>
            <ul className="mt-1.5 grid gap-1 text-sm" aria-label="Problems at this time">
              {problems.map((problem) => (
                <li key={problem.said} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${problem.level === "must" ? "bg-[#a6292f]" : "bg-[#d99b1c]"}`}
                  />
                  <span className="text-[#344054]">{problem.said}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!editing ? (
          <Part label="Class">
            <SelectMenu
              label="Class"
              value={draft.sectionId}
              onChange={(sectionId) => set({ sectionId })}
              options={sectionOptions}
              placeholder="Choose the class to place"
              searchable
              searchPlaceholder="Course, name, CRN or teacher"
            />
          </Part>
        ) : null}

        <Part label="When">
          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Small title="Day">
                <SelectMenu
                  label="Day"
                  value={String(draft.weekday)}
                  onChange={(value) => set({ weekday: Number(value) })}
                  options={WEEKDAY_NAMES.slice(0, 6).map((name, index) => ({ value: String(index + 1), label: name }))}
                />
              </Small>
              <TimeField label="Starts" value={draft.startsAt} onChange={(startsAt) => set({ startsAt })} />
              <TimeField label="Ends" value={draft.endsAt} onChange={(endsAt) => set({ endsAt })} />
            </div>
            {draft.startsAt >= draft.endsAt ? <p className="-mt-2 text-xs text-[#a6292f]">A class ends after it starts.</p> : null}
            <Small title="Weeks">
              <WeekPicker count={plan.weeks} value={draft.weeks} onChange={(weeks) => set({ weeks })} dateOf={dateOf} />
              {editing && editing.seriesWeeks > 1 ? (
                <span className="text-xs text-[#667085]">Changing the weeks or the note changes every class of the series.</span>
              ) : null}
            </Small>
          </div>
        </Part>

        <Part label="Where">
          <SelectMenu
            label="Room"
            value={draft.room}
            onChange={(room) => set({ room })}
            options={roomOptions}
            searchable
            searchPlaceholder="Search rooms"
          />
        </Part>

        {/* The class's teacher is Groups & CRNs' to say, like the class itself. */}
        <Part label="Who">
          <p className="pt-2 text-sm">
            <span className={section?.teacherName ? "text-[#171717]" : "text-[#98a2b3]"}>{section?.teacherName || "Nobody named yet"}</span>
            <span className="block text-xs text-[#98a2b3]">Set on Groups & CRNs, for every class of this group.</span>
          </p>
        </Part>

        {teacherWishes ? (
          <Part label="Preferences">
            <WishesStrip teacher={teacherWishes} weekday={draft.weekday} startsAt={draft.startsAt} endsAt={draft.endsAt} />
          </Part>
        ) : null}

        <Part label="Note">
          <input
            aria-label="Note"
            value={draft.note}
            onChange={(event) => set({ note: event.target.value })}
            placeholder="For the timetabling team, if anything"
            className={INPUT}
          />
        </Part>

        {error ? (
          <p role="alert" className="rounded-md bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * What a change to a repeating class is for: this one, this and the following, or all.
 *
 * Asked after the gesture, as a calendar does, so moving a class is a drag and a choice
 * rather than a form. "All" says how many classes changed on their own it will put back
 * in line, because that is the part of it nobody would guess.
 */
export function ScopeDialog({
  open,
  verb,
  when,
  week,
  firstWeek,
  count,
  movedApart,
  busy,
  onChoose,
  onClose,
}: {
  open: boolean;
  verb: "change" | "delete";
  /** "Tuesday 26 Jan". */
  when: string;
  week: number;
  firstWeek: number;
  count: number;
  /** Classes of the series changed on their own, which "all" would put back in line. */
  movedApart: number;
  busy: boolean;
  onChoose: (scope: Scope) => void;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<Scope>("one");
  useEffect(() => {
    if (open) setScope("one");
  }, [open]);
  const options: { value: Scope; label: string; detail: string }[] = [
    { value: "one", label: "This class", detail: when },
    ...(week > firstWeek
      ? [{ value: "following" as Scope, label: "This and the following classes", detail: `From week ${week}` }]
      : []),
    {
      value: "all",
      label: "All classes of the series",
      detail:
        `${count} class${count === 1 ? "" : "es"}` +
        (verb === "change" && movedApart ? ` · ${movedApart} changed on their own will follow` : ""),
    },
  ];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={verb === "change" ? "Change a repeating class" : "Delete a repeating class"}
      description={`This class is one of ${count}. Which of them should ${verb === "change" ? "change" : "go"}?`}
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onChoose(scope)}
            className={verb === "delete" ? "rounded-md bg-[#a6292f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#8f1f25] disabled:bg-[#d6a5a8]" : PRIMARY}
          >
            {busy ? "Working…" : verb === "change" ? "Change" : "Delete"}
          </button>
        </div>
      }
    >
      <div className="grid gap-2" role="radiogroup" aria-label="Which classes">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={scope === option.value}
            onClick={() => setScope(option.value)}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left ${
              scope === option.value ? "border-[#1f4e79] bg-[#f2f7fb]" : "border-[#d9dee7] bg-white hover:bg-[#f8fafc]"
            }`}
          >
            <span className="text-sm font-semibold text-[#344054]">{option.label}</span>
            <span className="text-xs text-[#667085]">{option.detail}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

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

/** The semester being planned: its name, Week 1, how many teaching weeks, its breaks, holidays and periods. */
export function PlanSettingsDialog({
  open,
  plan,
  busy,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  plan: Plan;
  busy: boolean;
  error: string;
  onSave: (settings: PlanSettings) => void;
  onClose: () => void;
}) {
  const start = useMemo<PlanSettings>(
    () => ({
      name: plan.name,
      weekOne: plan.weekOne,
      weeks: plan.weeks,
      without: plan.without,
      holidays: plan.holidays,
      periods: plan.periods ?? [],
    }),
    [plan.name, plan.weekOne, plan.weeks, plan.without, plan.holidays, plan.periods],
  );
  const [draft, setDraft] = useState(start);
  useEffect(() => {
    if (open) setDraft(start);
  }, [open, start]);
  const set = (patch: Partial<PlanSettings>) => setDraft((current) => ({ ...current, ...patch }));
  const setBreak = (index: number, day: string) =>
    set({ without: draft.without.map((each, at) => (at === index ? day : each)) });
  const setHoliday = (index: number, patch: Partial<Holiday>) =>
    set({ holidays: draft.holidays.map((each, at) => (at === index ? { ...each, ...patch } : each)) });
  const periods = draft.periods ?? [];
  const setPeriod = (index: number, patch: Partial<Period>) =>
    set({ periods: periods.map((each, at) => (at === index ? { ...each, ...patch } : each)) });
  const periodProblem = (period: Period) =>
    !period.label.trim()
      ? "Give it a name."
      : !period.from || !period.to
        ? "Give it a first and a last day."
        : period.to < period.from
          ? "Its last day comes before its first."
          : !period.days.length
            ? "Choose at least one day."
            : !RULES.some((each) => ruleOn(period, each.rule))
              ? "Tick at least one rule."
              : ruleOn(period, "block") && !(period.blockFrom && period.blockTo && period.blockFrom < period.blockTo)
                ? "Its hours with no classes end after they start."
                : "";
  const ready =
    draft.weekOne !== "" &&
    draft.weeks >= 1 &&
    draft.without.every(Boolean) &&
    draft.holidays.every((each) => each.date) &&
    periods.every((period) => !periodProblem(period));
  // The plan's short name, saved with the rest — Cancel leaves it as it was.
  const client = useQueryClient();
  const shortNames = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false });
  const semesterId = `plan:${plan.termCode}`;
  const savedShort = shortNames.data?.[semesterId] ?? "";
  const [short, setShort] = useState(savedShort);
  useEffect(() => {
    if (open) setShort(savedShort);
  }, [open, savedShort]);
  // Which day its pay periods open on, saved with the rest too.
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles, retry: false });
  const savedPayDay = opensOnFor(cycles.data?.cycles ?? {}, semesterId, cycles.data?.default ?? PERIOD_OPENS_ON);
  const [payDay, setPayDay] = useState(savedPayDay);
  useEffect(() => {
    if (open) setPayDay(savedPayDay);
  }, [open, savedPayDay]);
  const save = () => {
    if (short.trim() !== savedShort) {
      void setSemesterShortName(semesterId, short.trim()).then(() => client.invalidateQueries({ queryKey: ["semester-short-names"] }));
    }
    if (payDay !== savedPayDay) {
      void setPayCycle(semesterId, payDay).then(() => client.invalidateQueries({ queryKey: ["pay-cycles"] }));
    }
    onSave(draft);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Semester settings"
      description={`The teaching weeks of ${plan.name || plan.termCode}. Every class follows them: move Week 1 or add a break, and the dates move with it.`}
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!ready || busy} onClick={save} className={PRIMARY}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Name">
            <input value={draft.name} onChange={(event) => set({ name: event.target.value })} className={INPUT} />
          </Field>
          {/* What the menus call it, in front of its name: S2. */}
          <Field label="Short name">
            <input value={short} maxLength={12} placeholder="S2" onChange={(event) => setShort(event.target.value)} className={`${INPUT} w-24`} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateField label="Week 1" value={draft.weekOne} onChange={(weekOne) => set({ weekOne })} required />
          <Field label="Teaching weeks" hint="Breaks not counted">
            <input
              inputMode="numeric"
              value={draft.weeks || ""}
              onChange={(event) => set({ weeks: Math.min(30, Number(event.target.value.replace(/\D/g, "")) || 0) })}
              className={INPUT}
            />
          </Field>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium text-[#344054]">Weeks without classes</span>
          {draft.without.map((day, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex-1">
                <DateField label={`Break ${index + 1}, any day of the week`} value={day} onChange={(value) => setBreak(index, value)} />
              </div>
              <button
                type="button"
                aria-label={`Remove break ${index + 1}`}
                onClick={() => set({ without: draft.without.filter((_, at) => at !== index) })}
                className="mb-1 rounded-md p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ without: [...draft.without, ""] })}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
          >
            <Plus size={15} /> Add a week without classes
          </button>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium text-[#344054]">Holidays</span>
          {draft.holidays.map((holiday, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="w-48 shrink-0">
                <DateField label={`Holiday ${index + 1}`} value={holiday.date} onChange={(date) => setHoliday(index, { date })} />
              </div>
              <div className="flex-1">
                <Field label="Name">
                  <input value={holiday.label} onChange={(event) => setHoliday(index, { label: event.target.value })} placeholder="Eid al-Fitr" className={INPUT} />
                </Field>
              </div>
              <button
                type="button"
                aria-label={`Remove holiday ${index + 1}`}
                onClick={() => set({ holidays: draft.holidays.filter((_, at) => at !== index) })}
                className="mb-1 rounded-md p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => set({ holidays: [...draft.holidays, { date: "", label: "" }] })}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
          >
            <Plus size={15} /> Add a holiday
          </button>
          <span className="text-xs text-[#667085]">A class that falls on a holiday is not held; the plan lists what each holiday takes away.</span>
        </div>
        <div className="grid gap-2">
          <span className="text-sm font-medium text-[#344054]">Periods for everybody</span>
          {periods.map((period, index) => {
            const problem = periodProblem(period);
            return (
              <fieldset key={index} className="grid gap-2 rounded-md border border-[#e4e8ef] p-3">
                <legend className="sr-only">{period.label || `Period ${index + 1}`}</legend>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Field label="Name">
                      <input value={period.label} onChange={(event) => setPeriod(index, { label: event.target.value })} placeholder="Ramadan" className={INPUT} />
                    </Field>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${period.label || `period ${index + 1}`}`}
                    onClick={() => set({ periods: periods.filter((_, at) => at !== index) })}
                    className="mb-1 rounded-md p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <DateField label="From" value={period.from} onChange={(from) => setPeriod(index, { from })} />
                  <DateField label="To" value={period.to} onChange={(to) => setPeriod(index, { to })} />
                </div>
                <div className="grid gap-1">
                  <span className="text-sm font-medium text-[#344054]">On</span>
                  <div role="group" aria-label="Days it covers" className="flex flex-wrap gap-1.5">
                    {WEEKDAY_NAMES.map((name, at) => {
                      const day = at + 1;
                      const on = period.days.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          aria-pressed={on}
                          aria-label={name}
                          onClick={() =>
                            setPeriod(index, {
                              days: on ? period.days.filter((each) => each !== day) : [...period.days, day].sort((a, b) => a - b),
                            })
                          }
                          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                            on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f8fafc]"
                          }`}
                        >
                          {name.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Its rules: any of the four, each ticked on and given its value. */}
                <div className="grid gap-2" role="group" aria-label="Its rules">
                  <span className="text-sm font-medium text-[#344054]">Rules</span>
                  {RULES.map((each) => {
                    const on = ruleOn(period, each.rule);
                    return (
                      <div key={each.rule} className="grid gap-2 sm:grid-cols-[16rem_minmax(0,1fr)] sm:items-end">
                        <label className="inline-flex items-center gap-2 text-sm text-[#344054] sm:min-h-10">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={(event) => setPeriod(index, event.target.checked ? each.on : each.off)}
                            className="h-4 w-4 accent-[#1f4e79]"
                          />
                          {each.label}
                        </label>
                        {!on ? (
                          <span />
                        ) : each.rule === "endsBy" ? (
                          <div className="max-w-[10rem]">
                            <TimeField label="Ends by" value={period.endsBy ?? ""} onChange={(endsBy) => setPeriod(index, { endsBy })} />
                          </div>
                        ) : each.rule === "longest" ? (
                          <div className="max-w-[10rem]">
                            <SelectMenu
                              label="Longest class"
                              value={String(period.longest ?? "")}
                              onChange={(value) => setPeriod(index, { longest: Number(value) })}
                              options={LONGEST_CLASS}
                            />
                          </div>
                        ) : each.rule === "block" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <TimeField label="From" value={period.blockFrom} onChange={(blockFrom) => setPeriod(index, { blockFrom })} />
                            <TimeField label="Until" value={period.blockTo} onChange={(blockTo) => setPeriod(index, { blockTo })} />
                          </div>
                        ) : (
                          <div className="max-w-[10rem]">
                            <SelectMenu
                              label="Most hours a day for a teacher"
                              value={String(period.dailyMax ?? "")}
                              onChange={(value) => setPeriod(index, { dailyMax: Number(value) })}
                              options={TEACHER_DAY}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {problem ? <p className="text-xs text-[#a6292f]">{problem}</p> : null}
              </fieldset>
            );
          })}
          <button
            type="button"
            onClick={() => set({ periods: [...periods, { ...NEW_PERIOD }] })}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
          >
            <Plus size={15} /> Add a period
          </button>
          <span className="text-xs text-[#667085]">
            Ramadan, an exam week: rules for everyone, checked for the classes inside the period. The hours with no
            classes and the hours after the day ends are shaded on the plan; a class that breaks any rule is flagged.
          </span>
        </div>
        <div className="grid gap-1">
          <span className="text-sm font-medium text-[#344054]">Pay periods</span>
          <div className="w-56">
            <SelectMenu
              label="Pay periods"
              value={String(payDay)}
              onChange={(chosen) => setPayDay(Number(chosen))}
              disabled={cycles.isLoading}
              options={PAY_DAYS.map((day) => ({ value: String(day), label: `Opens ${cycleLabel(day)}` }))}
            />
          </div>
          <span className="text-xs text-[#667085]">
            What a part-time claim covers: now {periodLabel(periodContaining(new Date(), payDay))}.
          </span>
        </div>
        {error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * A new semester: the portal's code for it, its name, and the short name the menus show.
 *
 * Kept under the portal's code, so its sets, its plan and its timetable can be held against
 * what the registrar books — which is also why a code another semester already goes by is
 * refused here, before anything is made.
 */
export function NewSemesterDialog({
  open,
  busy,
  error,
  taken,
  onCreate,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  /** The semesters there are, by the portal code each goes by. */
  taken: Record<string, string>;
  onCreate: (semester: { termCode: string; name: string; short: string }) => void;
  onClose: () => void;
}) {
  const [termCode, setTermCode] = useState("");
  const [name, setName] = useState("");
  const [short, setShort] = useState("");
  useEffect(() => {
    if (!open) return;
    setTermCode("");
    setName("");
    setShort("");
  }, [open]);
  const already = /^\d{6}$/.test(termCode) ? taken[termCode] : undefined;
  const ready = /^\d{6}$/.test(termCode) && !already && name.trim() !== "";
  const create = () => ready && onCreate({ termCode, name: name.trim(), short: short.trim() });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New semester"
      description="Kept under the portal's code for it, so its sets, its plan and its timetable can be held against what the registrar books."
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!ready || busy} onClick={create} className={PRIMARY}>
            {busy ? "Creating…" : "Create semester"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Portal term code" hint="Six digits: 262720 is the second semester of 2026-27.">
          <input
            inputMode="numeric"
            value={termCode}
            onChange={(event) => setTermCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            className={INPUT}
          />
        </Field>
        {already ? (
          <p role="alert" className="-mt-2 text-sm text-[#a6292f]">
            {already} is {termCode} already.
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label="Name">
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Semester 2 2026-27" className={INPUT} />
          </Field>
          {/* What the menus call it, in front of its name. */}
          <Field label="Short name">
            <input value={short} maxLength={12} placeholder="S2" onChange={(event) => setShort(event.target.value)} className={`${INPUT} w-24`} />
          </Field>
        </div>
        <p className="text-xs text-[#667085]">Its teaching weeks and holidays are set in its Settings once it is made.</p>
        {error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
