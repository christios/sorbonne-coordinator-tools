import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DateField } from "@/components/DateField";
import { Modal } from "@/components/Modal";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { TimeField } from "@/components/TimeField";
import {
  WEEKDAY_NAMES,
  weeksSaid,
  type Holiday,
  type Plan,
  type PlanSection,
  type PlanSettings,
  type Scope,
  type Slot,
} from "@/services/semesterPlans";
import { formatDayAndMonth, toIsoDate, weekStartOf } from "@/services/weekSchedule";

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

/** A shared menu with its name above it, as the fields beside it have. */
function Titled({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">{title}</span>
      {children}
    </div>
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
              chosen.has(week) ? "bg-[#1f4e79] text-white" : "border border-[#d0d5dd] bg-white text-[#667085] hover:bg-[#f2f7fb]"
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
    label: `${section.courseCode} · ${section.title}`,
    badge: section.crn ? `CRN ${section.crn}` : undefined,
    badgeTone: "muted",
    searchText: `${section.crn} ${section.teacherName} ${section.programmes.join(" ")} ${section.groupLabel}`,
  };
}

/**
 * A class on the calendar: which class it is, when, where, who teaches it, and — for a new
 * one or a whole series — the weeks it repeats in.
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
}: {
  open: boolean;
  plan: Plan;
  rooms: string[];
  initial: ClassDraft;
  /** Present when an existing class was opened: its week, date and who last changed it. */
  editing?: { week: number; meetsOn: string; seriesWeeks: number; updatedBy: string; updatedAt: string };
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
  const sectionOptions = useMemo(() => plan.sections.map(sectionOption), [plan.sections]);
  const roomOptions = useMemo(() => {
    const known = [...new Set([...rooms, ...(draft.room ? [draft.room] : [])])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    return [{ value: "", label: "No room yet" }, ...known.map((room) => ({ value: room, label: room }))];
  }, [rooms, draft.room]);
  const calendar = { weekOne: plan.weekOne, without: plan.without };
  const dateOf = (week: number) => formatDayAndMonth(toIsoDate(weekStartOf(week, calendar)));
  const ready = Boolean(draft.sectionId) && draft.startsAt < draft.endsAt && draft.weeks.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "Class" : "Place a class"}
      description={
        editing
          ? `Week ${editing.week}, ${WEEKDAY_NAMES[draft.weekday - 1]} ${formatDayAndMonth(editing.meetsOn)}${
              editing.seriesWeeks > 1 ? ` · one of ${editing.seriesWeeks} in its series` : ""
            }`
          : "Which class, when it meets, and the weeks it repeats in."
      }
      footer={
        <div className="flex items-center justify-between gap-3">
          <div>
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
              >
                <Trash2 size={15} /> Delete
              </button>
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
      <div className="grid gap-4">
        <Titled title="Class">
          <SelectMenu
            label="Class"
            value={draft.sectionId}
            // The teacher is the class's own: choosing another class brings its teacher with it,
            // rather than carrying over whatever was typed for the last one.
            onChange={(sectionId) =>
              set({ sectionId, teacherName: plan.sections.find((entry) => entry.id === sectionId)?.teacherName ?? "" })
            }
            options={sectionOptions}
            placeholder="Choose the class to place"
            searchable
            searchPlaceholder="Course, name, CRN or teacher"
            disabled={Boolean(editing)}
          />
        </Titled>
        {section ? (
          <p className="-mt-2 text-xs text-[#667085]">
            {[section.component, section.programmes.join(", "), section.groupLabel, section.hoursSaid || (section.hours ? `${section.hours} h` : "")]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Titled title="Day">
            <SelectMenu
              label="Day"
              value={String(draft.weekday)}
              onChange={(value) => set({ weekday: Number(value) })}
              options={WEEKDAY_NAMES.slice(0, 6).map((name, index) => ({ value: String(index + 1), label: name }))}
            />
          </Titled>
          <TimeField label="Starts" value={draft.startsAt} onChange={(startsAt) => set({ startsAt })} />
          <TimeField label="Ends" value={draft.endsAt} onChange={(endsAt) => set({ endsAt })} />
        </div>
        {draft.startsAt >= draft.endsAt ? <p className="-mt-2 text-xs text-[#a6292f]">A class ends after it starts.</p> : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Titled title="Room">
            <SelectMenu
              label="Room"
              value={draft.room}
              onChange={(room) => set({ room })}
              options={roomOptions}
              searchable
              searchPlaceholder="Search rooms"
            />
          </Titled>
          <Field label="Teacher" hint={section?.crn ? `Teaches every class of CRN ${section.crn}, as on the portal.` : "Teaches every class of this section."}>
            <input
              value={draft.teacherName}
              onChange={(event) => set({ teacherName: event.target.value })}
              placeholder={section?.teacherName || "Nobody named yet"}
              className={INPUT}
            />
          </Field>
        </div>
        <div className="grid gap-1">
          <span className="text-sm font-medium text-[#344054]">Weeks</span>
          <WeekPicker count={plan.weeks} value={draft.weeks} onChange={(weeks) => set({ weeks })} dateOf={dateOf} />
          {editing && editing.seriesWeeks > 1 ? (
            <span className="text-xs text-[#8a6116]">Changing the weeks or the note changes every class of the series.</span>
          ) : null}
        </div>
        <Field label="Note">
          <input value={draft.note} onChange={(event) => set({ note: event.target.value })} placeholder="For the timetabling team, if anything" className={INPUT} />
        </Field>
        {editing?.updatedBy ? (
          <p className="text-xs text-[#98a2b3]">
            Last changed by {editing.updatedBy}
            {editing.updatedAt ? ` on ${new Date(editing.updatedAt).toLocaleString()}` : ""}
          </p>
        ) : null}
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

/** The semester being planned: its name, Week 1, how many teaching weeks, its breaks and holidays. */
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
    () => ({ name: plan.name, weekOne: plan.weekOne, weeks: plan.weeks, without: plan.without, holidays: plan.holidays }),
    [plan.name, plan.weekOne, plan.weeks, plan.without, plan.holidays],
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
  const ready = draft.weekOne !== "" && draft.weeks >= 1 && draft.without.every(Boolean) && draft.holidays.every((each) => each.date);

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
          <button type="button" disabled={!ready || busy} onClick={() => onSave(draft)} className={PRIMARY}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Name">
          <input value={draft.name} onChange={(event) => set({ name: event.target.value })} className={INPUT} />
        </Field>
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
        {error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** A new plan, kept under the portal's term code. */
export function NewPlanDialog({
  open,
  busy,
  error,
  onCreate,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  error: string;
  onCreate: (termCode: string, name: string) => void;
  onClose: () => void;
}) {
  const [termCode, setTermCode] = useState("");
  const [name, setName] = useState("");
  const ready = /^\d{6}$/.test(termCode);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New semester plan"
      description="A plan is kept under the portal's code for the semester, so it can be compared with what the registrar books."
      footer={
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="button" disabled={!ready || busy} onClick={() => onCreate(termCode, name)} className={PRIMARY}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Field label="Portal term code" hint="Six digits: 262720 is the second semester of 2026-27.">
          <input inputMode="numeric" value={termCode} onChange={(event) => setTermCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className={INPUT} />
        </Field>
        <Field label="Name">
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Semester 2 2026-27" className={INPUT} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
