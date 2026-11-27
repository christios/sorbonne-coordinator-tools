import { ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { TimeField } from "@/components/TimeField";
import {
  WEEKDAY_NAMES,
  weeksSaid,
  type Plan,
  type PlanSection,
  type Scope,
  type Slot,
} from "@/services/semesterPlans";
import { judgeSlot } from "@/services/planJudge";
import { sessionsWords } from "@/services/coursePlans";
import { KIND_PREFIX, LEVEL_NAME, activeIn, describeLine, type WishTeacher } from "@/services/teacherWishes";
import { formatDayAndMonth, minutesOf, toIsoDate, weekStartOf } from "@/services/weekSchedule";

export const INPUT =
  "w-full rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm text-[#171717] focus:border-[#1f4e79] focus:outline-none";
const PRIMARY =
  "rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]";
const SECONDARY =
  "rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">{label}</span>
      {children}
      {hint ? <span className="text-xs text-[#667085]">{hint}</span> : null}
    </label>
  );
}

/**
 * What the course plan says of this class, under its weeks — and, amber, where the chosen
 * weeks or length are not what it says. Nothing is refused: it is the coordinator's call.
 */
function CoursePlanNote({
  plan,
  weeks,
  minutes,
}: {
  plan: {
    words: string;
    weeks: number[] | null;
    length: number;
    lengths?: Record<string, number[]>;
    uneven?: { words: string; reason: string } | null;
    /** The weeks holding an exam, each the exam's place among the week's sessions (26 Nov 2026). */
    exams?: Record<string, number[]>;
    /** The order of a week's kinds the lead asks for: "CM before TD/TP". */
    order?: string[];
  };
  weeks: number[];
  minutes: number;
}) {
  const examWeeks = Object.keys(plan.exams ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const extra = plan.weeks ? weeks.filter((week) => !plan.weeks?.includes(week)) : [];
  // Weeks whose sessions last other than usual: a series has one length, so those weeks are changed on their own.
  const odd = weeks.filter((week) => String(week) in (plan.lengths ?? {}));
  const longer = minutes > 0 && Math.abs(minutes - plan.length * 60) > 0.5;
  return (
    <span className="text-xs text-[#475467]">
      Course plan: {plan.words}
      {plan.uneven ? (
        // The weeks proposed are the lead's, and they run unevenly: said, with why, before they are taken.
        <span className="block font-semibold text-[#8a6116]">
          Laid out unevenly by the lead — {plan.uneven.words.charAt(0).toLowerCase()}
          {plan.uneven.words.slice(1)}.
          <span className="block font-normal italic">
            {plan.uneven.reason ? `Why: “${plan.uneven.reason}”` : "No reason given."}
          </span>
        </span>
      ) : null}
      {examWeeks.length ? (
        <span className="block font-semibold text-[#53389e]">
          Exam in {weeksSaid(examWeeks).toLowerCase()}: that week&rsquo;s class is tagged Exam once placed.
        </span>
      ) : null}
      {plan.order?.length ? (
        <span className="block font-semibold text-[#1f4e79]">In the same week, the lead asks for {plan.order.join(" and ")}.</span>
      ) : null}
      {extra.length ? <span className="block font-semibold text-[#8a6116]">{weeksSaid(extra)} {extra.length === 1 ? "is" : "are"} not among them.</span> : null}
      {longer ? (
        <span className="block font-semibold text-[#8a6116]">
          This class is {Math.round((minutes / 60) * 100) / 100} h; the course plan&rsquo;s sessions are {plan.length} h.
        </span>
      ) : null}
      {odd.length ? (
        <span className="block font-semibold text-[#8a6116]">
          {odd.map((week) => `Week ${week}: ${sessionsWords(plan.lengths?.[String(week)] ?? [])}`).join("; ")}. Once placed, change
          that week&rsquo;s class on its own.
        </span>
      ) : null}
    </span>
  );
}

/** The teaching weeks, one button each: pressed is a week the class meets in. */
export function WeekPicker({
  count,
  value,
  onChange,
  dateOf,
  planned,
}: {
  count: number;
  value: number[];
  onChange: (weeks: number[]) => void;
  /** The Monday of a week, for its title. */
  dateOf: (week: number) => string;
  /** The weeks the course plan has sessions for, offered first, and marked under their buttons. */
  planned?: number[] | null;
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
        {planned?.length ? preset("Course plan", planned) : null}
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
            title={`Week ${week}, from ${dateOf(week)}${planned?.includes(week) ? " · in the course plan" : ""}`}
            onClick={() => toggle(week)}
            className={`h-8 w-8 rounded-md text-xs font-semibold tabular-nums ${planned?.includes(week) ? "underline decoration-[#d99b1c] decoration-2 underline-offset-2" : ""} ${
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
 * The preferences of the teacher of a class, folded to one line: how many, and whether the
 * time chosen keeps them. Opened, the whole list — constraints first, each with why it matters,
 * the ones this time breaks marked — and their needs and note.
 */
function WishesStrip({
  teacher,
  weekday,
  startsAt,
  endsAt,
  mondays,
}: {
  teacher: WishTeacher;
  weekday: number;
  startsAt: string;
  endsAt: string;
  /** The weeks the class meets in, by their Mondays: a block for some weeks counts only in them. */
  mondays: string[];
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
    (line.kind === "constraint" &&
      line.days.includes(weekday) &&
      start < line.to * 60 &&
      end > line.from * 60 &&
      mondays.some((monday) => activeIn({ ...line, id: line.key, comment: "" }, monday))) ||
    (line.kind === "freeDay" && line.value === weekday);
  const constraints = lines.filter((line) => line.level === "must").length;
  const broken = lines.filter(brokenHere).length;
  const extras = (wishes.needs ? 1 : 0) + (wishes.note ? 1 : 0);
  return (
    <div className="grid gap-2 pt-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[#344054]">
          {lines.length
            ? `${constraints} hard constraint${constraints === 1 ? "" : "s"} · ${lines.length - constraints} soft`
            : "No constraints on the week"}
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
                    {LEVEL_NAME[line.level ?? "would"]}
                  </span>
                  <span className="min-w-0">
                    <span className="text-[#344054]">{describeLine(line).replace(KIND_PREFIX, "")}</span>
                    {brokenHere(line) ? <span className="font-medium text-[#a6292f]"> — this time breaks it</span> : null}
                    {line.comment ? <span className="block text-xs text-[#667085]">&ldquo;{line.comment}&rdquo;</span> : null}
                  </span>
                </li>
              ))}
            </ul>
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
  coursePlan,
}: {
  open: boolean;
  plan: Plan;
  /**
   * The class's share of its course's plan: what it says in words, the weeks it still has
   * sessions for, and one session's length. Offered and compared, never enforced.
   */
  coursePlan?: {
    words: string;
    weeks: number[] | null;
    length: number;
    lengths?: Record<string, number[]>;
    uneven?: { words: string; reason: string } | null;
    exams?: Record<string, number[]>;
    order?: string[];
  } | null;
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
              <WeekPicker count={plan.weeks} value={draft.weeks} onChange={(weeks) => set({ weeks })} dateOf={dateOf} planned={coursePlan?.weeks} />
              {coursePlan ? <CoursePlanNote plan={coursePlan} weeks={draft.weeks} minutes={length} /> : null}
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
            <WishesStrip
              teacher={teacherWishes}
              weekday={draft.weekday}
              startsAt={draft.startsAt}
              endsAt={draft.endsAt}
              mondays={draft.weeks.map((week) => toIsoDate(weekStartOf(week, calendar)))}
            />
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
