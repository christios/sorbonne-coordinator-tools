import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { Popover } from "radix-ui";
import { type FormEvent, useRef, useState } from "react";

import { Modal } from "@/components/Modal";
import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";
import { LabelledFigure, RECORD_CARD, RecordList, RecordRow, RecordToolbar } from "@/components/RecordList";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TeacherAvatar } from "@/components/TeacherDatabase";
import {
  type ReductionInput,
  type ReductionItem,
  type ReductionRule,
  type ReductionState,
  type ReductionYear,
  fetchReductionYear,
  hoursOf,
  saveDepartmentReductions,
  saveReductionRules,
  yearWords,
} from "@/services/hourReductions";

/** The sheet's own column heads, as the department's table had them. */
const SHORT: Record<string, string> = {
  phd: "PhD",
  masters: "Master's",
  project: "Project",
  hdr: "HDR",
  irg: "IRG",
  internships: "Internships",
  committees: "Committees",
  hop: "HoP",
  hod: "HoD",
  new_joiner: "New joiner",
  accreditation: "Accred.",
  innovation: "Pedag. innov.",
};

/** Each column's width, so a figure's label has room under it and the list lines up. */
const WIDTH: Record<string, string> = {
  phd: "4rem",
  masters: "4.2rem",
  project: "3.4rem",
  hdr: "2.8rem",
  irg: "2.8rem",
  internships: "4.8rem",
  committees: "4.8rem",
  hop: "4rem",
  hod: "4rem",
  new_joiner: "3.2rem",
  accreditation: "3.2rem",
  innovation: "3.2rem",
};

/** An option as the line under a figure has room for it; the editor gives it in full. */
const SHORT_OPTION: Record<string, string> = {
  master: "Master's",
  bachelor: "Bachelor's",
  foundation: "Foundation",
  "foundation-200": "FY 200+",
  "foundation-500": "FY 500+",
  hod: "Up to 200",
  "hod-200": "Over 200",
  "hod-500": "Over 500",
};

type Teacher = ReductionYear["teachers"][number];
/** One save: some of one teacher's kinds. */
type Edit = { teacherId: string; name: string; items: Record<string, ReductionInput> };
type Draft = { amount: number; detail: string; validated: boolean };

const SAVE_KEY = ["hour-reductions", "save"];

const hoursText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} h`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a kind's hours are made of, in the few words under its figure: "12 students", "Ethics". */
function madeOf(item: Pick<ReductionItem, "unit" | "amount" | "detail" | "options">): string {
  if (item.unit === "students") return item.amount ? plural(item.amount, "student") : "";
  if (item.unit === "committees" || item.unit === "choice") {
    return item.detail
      .split(",")
      .filter(Boolean)
      .map((key) => SHORT_OPTION[key] ?? item.options?.find((option) => option.key === key)?.label ?? key)
      .join(", ");
  }
  return "";
}

/** Where a figure stands, said in words for a screen reader and a pointer's hover. */
function standing(state: ReductionState): string {
  if (state === "declared") return "declared by the teacher, to validate with SAFIR";
  if (state === "validated") return "validated with SAFIR";
  return "";
}

/**
 * A teacher's year with some kinds changed, worked out as the server will: shown at once,
 * and replaced by what the server says when it answers.
 */
function applied(teacher: Teacher, items: Record<string, ReductionInput>): Teacher {
  const next = teacher.items.map((item) => {
    const given = items[item.kind];
    if (!given) return item;
    const amount = given.amount ?? item.amount;
    const detail = Array.isArray(given.detail) ? given.detail.join(",") : (given.detail ?? item.detail);
    const state: ReductionState =
      !amount && !detail ? "" : item.group === "department" ? "set" : given.validated ? "validated" : "declared";
    return { ...item, amount, detail, hours: hoursOf(item, amount, detail), state };
  });
  const total = next.reduce((sum, item) => sum + item.hours, 0);
  return { ...teacher, items: next, total, owed: Math.max(0, teacher.service - total) };
}

/** What a kind is given, keeping a research figure's validation as it stands unless said. */
function input(item: ReductionItem, change: Partial<Draft>): ReductionInput {
  return {
    amount: change.amount ?? item.amount,
    detail: change.detail ?? item.detail,
    ...(item.group === "safir" ? { validated: change.validated ?? item.state === "validated" } : {}),
  };
}

/** "16 Nov", as a row says when a teacher declared. */
function dayWords(iso: string): string {
  const day = new Date(iso);
  return Number.isNaN(day.getTime()) ? iso.slice(0, 10) : day.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Hour reductions: every full-timer's year, on the department's record list.
 *
 * The list the Part-time Teachers page uses, one full-timer a row, with a column per kind
 * as the department's table had them — research through SAFIR, then the department's own —
 * the total, and the teaching each still owes of the year's service.
 *
 * Every figure is in hours, with what makes it under it: "6 h" over 12 STUDENTS. A count
 * and its hours side by side, both bare, read as two numbers nobody could place. A research
 * figure the teacher declared and nobody has checked with SAFIR yet is amber, marked "!".
 *
 * The Head of Department and the administrators change a figure where it stands: clicking
 * it opens it in place, with the rule it is worked out by and, for research, the SAFIR
 * tick. It is saved when it closes; Escape leaves it as it was. Nobody opens a teacher to
 * change one figure. An administrator changes the rules' figures; everybody else reads.
 */
export function HourReductionsPage({ header }: { header?: HTMLElement | null }) {
  const client = useQueryClient();
  const { semesters, semester, setTermId, term } = usePortalSemester();
  const key = ["hour-reductions", term];
  const held = useQuery({
    queryKey: key,
    queryFn: () => fetchReductionYear(term),
    enabled: Boolean(term),
    retry: false,
  });
  const [rules, setRules] = useState(false);
  const [problem, setProblem] = useState("");
  const [savedOnce, setSavedOnce] = useState(false);
  // Saves still on their way, per teacher: only the last one's answer is shown, so an
  // earlier answer never undoes a later change for a moment.
  const inFlight = useRef(new Map<string, number>());
  const saving = useIsMutating({ mutationKey: SAVE_KEY });

  const replace = (teacherId: string, change: (teacher: Teacher) => Teacher) =>
    client.setQueryData<ReductionYear>(key, (year) =>
      year ? { ...year, teachers: year.teachers.map((teacher) => (teacher.teacherId === teacherId ? change(teacher) : teacher)) } : year,
    );

  const save = useMutation({
    mutationKey: SAVE_KEY,
    mutationFn: ({ teacherId, items }: Edit) => saveDepartmentReductions(held.data?.year ?? "", teacherId, items),
    onMutate: async ({ teacherId, items }) => {
      setProblem("");
      inFlight.current.set(teacherId, (inFlight.current.get(teacherId) ?? 0) + 1);
      await client.cancelQueries({ queryKey: key });
      replace(teacherId, (teacher) => applied(teacher, items));
    },
    onSuccess: (sheet, { teacherId }) => {
      setSavedOnce(true);
      if ((inFlight.current.get(teacherId) ?? 0) <= 1) replace(teacherId, (teacher) => ({ ...teacher, ...sheet }));
    },
    onError: (error, { name }) => {
      setProblem(`${name}: ${(error as Error).message}`);
      // What the server holds, rather than the change it refused.
      void client.invalidateQueries({ queryKey: key });
    },
    onSettled: (_sheet, _error, { teacherId }) => {
      inFlight.current.set(teacherId, Math.max(0, (inFlight.current.get(teacherId) ?? 1) - 1));
      // Teaching loads reads the same year under another semester's term.
      void client.invalidateQueries({ queryKey: ["hour-reductions"], predicate: (query) => query.queryKey[1] !== term });
    },
  });

  const menu = <PortalSemesterMenu semesters={semesters} semester={semester} onChange={setTermId} header={header} />;

  if (!term) return <>{menu}<p className="text-sm text-[#667085]">Choose a semester linked to a portal term.</p></>;
  if (held.isLoading) return <>{menu}<ScreenLoading label="Reading the hour reductions…" /></>;
  if (held.isError || !held.data) {
    return (
      <>
        {menu}
        <p role="alert" className="text-sm text-[#a6292f]">{(held.error as Error | null)?.message}</p>
      </>
    );
  }
  const year = held.data;
  const research = year.rules.filter((rule) => rule.group === "safir");
  const department = year.rules.filter((rule) => rule.group === "department");
  const kinds = [...research, ...department];
  const waiting = year.teachers.reduce(
    (count, teacher) => count + teacher.items.filter((item) => item.state === "declared").length,
    0,
  );
  // The teacher, a column per kind, the total and what is owed: fixed widths, the same on
  // the heading and on every row. Never narrower than they add up to: a narrow screen
  // scrolls the list sideways instead.
  const widths = [...kinds.map((rule) => WIDTH[rule.kind] ?? "3.4rem"), "3rem", "3.4rem"];
  const least = 13 + widths.reduce((sum, width) => sum + Number.parseFloat(width), 0) + widths.length * 0.375 + 2;
  const columns = "gap-x-1.5 gap-y-1 px-4 items-center";
  const grid = { gridTemplateColumns: `minmax(13rem,1fr) ${widths.join(" ")}`, minWidth: `${least}rem` };
  const change = (teacher: Teacher, items: Record<string, ReductionInput>) =>
    save.mutate({ teacherId: teacher.teacherId, name: teacher.name, items });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {menu}
      {problem ? (
        <p role="alert" className="rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">
          {problem}
        </p>
      ) : null}
      <section className={RECORD_CARD}>
        <RecordToolbar>
          <p className="min-w-0 flex-1 text-sm text-[#344054]">
            <b className="text-[#171717]">{yearWords(year.year)}</b> · yearly service {year.service} h
            {waiting ? <span className="text-[#8a6116]"> · {plural(waiting, "research figure")} to validate</span> : null}
          </p>
          {year.canChange ? (
            <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[#667085]">
              {saving ? (
                <>
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Saving…
                </>
              ) : savedOnce && !problem ? (
                <>
                  <Check size={13} className="text-[#2e7d55]" aria-hidden="true" /> Saved
                </>
              ) : null}
            </span>
          ) : null}
          {year.canChangeRules ? (
            <button
              type="button"
              onClick={() => setRules(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-sm font-semibold text-[#344054]"
            >
              <SlidersHorizontal size={14} aria-hidden="true" /> Rules
            </button>
          ) : null}
          <span className="shrink-0 text-xs tabular-nums text-[#98a2b3]">{year.teachers.length}</span>
        </RecordToolbar>
        <RecordList
          label="Full-time teachers"
          columns={columns}
          grid={grid}
          scrollX
          isEmpty={!year.teachers.length}
          empty="No full-time teacher teaches this year yet."
          head={
            <>
              {/* Which kinds are the teacher's to declare and which the Head of Department's. */}
              <span />
              <span style={{ gridColumn: `span ${research.length}` }} className="border-b border-[#e5e7eb] pb-0.5 text-[#667085]">
                Research, through SAFIR
              </span>
              <span style={{ gridColumn: `span ${department.length}` }} className="border-b border-[#e5e7eb] pb-0.5 text-[#667085]">
                Set by the Head of Department
              </span>
              <span />
              <span />
              <span>Teacher</span>
              {kinds.map((rule) => (
                <span key={rule.kind} title={`${rule.label}: ${rule.rule}`} className="leading-tight">
                  {SHORT[rule.kind] ?? rule.label}
                </span>
              ))}
              <span>Total</span>
              <span>Owes</span>
            </>
          }
        >
          {year.teachers.map((teacher) => (
            <RecordRow key={teacher.teacherId} columns={columns} grid={grid}>
              <TeacherCell teacher={teacher} canChange={year.canChange} onChange={(items) => change(teacher, items)} />
              {teacher.items.map((item) =>
                year.canChange ? (
                  <FigureEditor
                    key={item.kind}
                    teacher={teacher}
                    item={item}
                    onChange={(draft) => change(teacher, { [item.kind]: input(item, draft) })}
                  />
                ) : (
                  <ReductionFigure key={item.kind} teacher={teacher} item={item} />
                ),
              )}
              <LabelledFigure value={hoursText(teacher.total)} faint={!teacher.total} />
              <LabelledFigure value={hoursText(teacher.owed)} label={`of ${teacher.service}`} tone="text-[#1f4e79]" />
            </RecordRow>
          ))}
        </RecordList>
      </section>
      <p className="text-xs text-[#475467]">
        Every figure is in hours, with what it is made of under it.{" "}
        <span className="font-semibold text-[#8a6116]">Amber, marked !</span>: declared by the teacher, still to validate with
        SAFIR. <Check size={11} className="inline align-[-1px] text-[#2e7d55]" aria-hidden="true" /> validated.
        {year.canChange ? " Click a figure to change it: it is saved when it closes, and Escape leaves it as it was." : ""}{" "}
        Full-time teachers declare theirs as the first step of the timetable preferences request.
      </p>

      {rules ? <RulesDialog year={year} term={term} onClose={() => setRules(false)} /> : null}
    </div>
  );
}

/** Who, and where their year stands: declared or not, their note, and what is left to validate. */
function TeacherCell({
  teacher,
  canChange,
  onChange,
}: {
  teacher: Teacher;
  canChange: boolean;
  onChange: (items: Record<string, ReductionInput>) => void;
}) {
  const declared = teacher.items.filter((item) => item.state === "declared");
  return (
    // Stays in view when a narrow screen scrolls the list sideways.
    <div className="sticky left-0 z-10 flex min-w-0 items-center gap-3 bg-white group-hover:bg-[#fafbfd]">
      <TeacherAvatar fullName={teacher.name} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span title={teacher.name} className="truncate font-semibold text-[#171717]">
            {teacher.name}
          </span>
          {teacher.head ? <span className="shrink-0 rounded border border-[#1f4e79] px-1 text-[10px] font-semibold text-[#1f4e79]">HoD</span> : null}
        </span>
        <span className="block truncate text-xs text-[#667085]" title={teacher.note || undefined}>
          {teacher.declaredAt ? `Declared ${dayWords(teacher.declaredAt)}` : <span className="italic text-[#98a2b3]">Not declared yet</span>}
          {teacher.note ? <span className="italic"> · “{teacher.note}”</span> : null}
          {!teacher.fullTime ? <span className="text-[#8a6116]"> · not full time now</span> : null}
        </span>
        {canChange && declared.length ? (
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(declared.map((item) => [item.kind, input(item, { validated: true })])))}
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f5c3d] underline-offset-2 hover:underline"
          >
            <Check size={12} aria-hidden="true" /> Validate {declared.length === 1 ? "it" : `all ${declared.length}`} with SAFIR
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** A kind's hours, with what makes them under it, and where a research figure stands. */
function ReductionFigure({ teacher, item }: { teacher: Teacher; item: ReductionItem }) {
  return (
    <span
      title={standing(item.state) || undefined}
      aria-label={`${item.label}, ${teacher.name}: ${figureWords(item)}`}
      className="flex min-w-0"
    >
      <FigureFace item={item} />
    </span>
  );
}

/** The figure itself: its hours and their mark on the first line, what makes them under. */
function FigureFace({ item }: { item: ReductionItem }) {
  return (
    <LabelledFigure
      value={
        <span className="inline-flex items-center gap-1">
          {item.hours ? hoursText(item.hours) : "—"}
          <StateMark state={item.state} />
        </span>
      }
      label={madeOf(item)}
      faint={!item.hours}
      tone={item.state === "declared" ? "text-[#8a6116]" : "text-[#171717]"}
    />
  );
}

function figureWords(item: ReductionItem): string {
  return [item.hours ? hoursText(item.hours) : "none", madeOf(item), standing(item.state)].filter(Boolean).join(", ");
}

function StateMark({ state }: { state: ReductionState }) {
  if (state === "declared") {
    return (
      <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#f5c451] text-[9px] font-bold text-[#5c3d00]">
        !
      </span>
    );
  }
  if (state === "validated") return <Check size={13} aria-hidden="true" className="shrink-0 text-[#2e7d55]" />;
  return null;
}

/**
 * A figure the Head of Department may change, opened where it stands: the count or the
 * choice, what it comes to, the rule, and the SAFIR tick for research. Closing it saves —
 * Done, Enter, or a click elsewhere, as leaving a cell does — and Escape or Cancel leaves it
 * as it was.
 */
function FigureEditor({ teacher, item, onChange }: { teacher: Teacher; item: ReductionItem; onChange: (draft: Draft) => void }) {
  const fromItem = (): Draft => ({ amount: item.amount, detail: item.detail, validated: item.state === "validated" });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(fromItem);
  const keep = useRef(true);
  const hours = hoursOf(item, draft.amount, draft.detail);

  const openChange = (next: boolean) => {
    if (next) {
      setDraft(fromItem());
      keep.current = true;
      setOpen(true);
      return;
    }
    const changed =
      draft.amount !== item.amount ||
      draft.detail !== item.detail ||
      (item.group === "safir" && draft.validated !== (item.state === "validated"));
    if (keep.current && changed) onChange(draft);
    setOpen(false);
  };
  const cancel = () => {
    keep.current = false;
    openChange(false);
  };
  const done = (event: FormEvent) => {
    event.preventDefault();
    openChange(false);
  };
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const number = (value: string) => Math.max(0, Number(value.replace(",", ".")) || 0);
  const field = "h-8 w-20 rounded-md border border-[#b7bec8] bg-white px-2 text-sm tabular-nums text-[#171717] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";

  let control;
  if (item.unit === "students" || item.unit === "hours") {
    control = (
      <label className="flex items-center gap-2 text-sm text-[#344054]">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={item.unit === "students" ? 1 : 0.5}
          aria-label={item.unit === "students" ? "Students" : "Hours"}
          value={draft.amount || ""}
          placeholder="0"
          onChange={(event) => set({ amount: number(event.target.value) })}
          className={field}
        />
        {item.unit === "students" ? (
          <span>
            students = <b className="tabular-nums text-[#171717]">{hoursText(hours)}</b>
          </span>
        ) : (
          "h"
        )}
      </label>
    );
  } else if (item.unit === "yes") {
    control = (
      <label className="flex items-center gap-2 text-sm text-[#344054]">
        <input type="checkbox" checked={Boolean(draft.amount)} onChange={(event) => set({ amount: event.target.checked ? 1 : 0 })} />
        Yes = <b className="tabular-nums text-[#171717]">{hoursText(item.per ?? 0)}</b>
      </label>
    );
  } else if (item.unit === "committees") {
    const chosen = draft.detail.split(",").filter(Boolean);
    control = (
      <div className="space-y-1.5">
        {(item.options ?? []).map((option) => (
          <label key={option.key} className="flex items-center gap-2 text-sm text-[#344054]">
            <input
              type="checkbox"
              checked={chosen.includes(option.key)}
              onChange={(event) => {
                const next = (item.options ?? [])
                  .map((entry) => entry.key)
                  .filter((key) => (key === option.key ? event.target.checked : chosen.includes(key)));
                set({ detail: next.join(","), amount: next.length });
              }}
            />
            {option.label}
          </label>
        ))}
        <p className="text-sm text-[#344054]">
          = <b className="tabular-nums text-[#171717]">{hoursText(hours)}</b>
        </p>
      </div>
    );
  } else {
    control = (
      <div role="radiogroup" aria-label={item.label} className="space-y-1.5">
        {[{ key: "", label: "None", hours: 0 }, ...(item.options ?? [])].map((option) => (
          <label key={option.key || "none"} className="flex items-center gap-2 text-sm text-[#344054]">
            <input
              type="radio"
              name={`${teacher.teacherId}-${item.kind}`}
              checked={draft.detail === option.key}
              onChange={() => set({ detail: option.key, amount: option.key ? 1 : 0 })}
            />
            <span className="min-w-0 flex-1">{option.label}</span>
            {option.key ? <span className="tabular-nums text-[#667085]">{hoursText(option.hours)}</span> : null}
          </label>
        ))}
      </div>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={openChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`${item.label}, ${teacher.name}: ${figureWords(item)}`}
          title={standing(item.state) || "Click to change"}
          className={`-mx-1 flex min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#eef4fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7e5f3] ${
            open ? "bg-[#eef4fa]" : ""
          }`}
        >
          <FigureFace item={item} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onEscapeKeyDown={() => {
            keep.current = false;
          }}
          aria-label={`${item.label}, ${teacher.name}`}
          className="z-[100] isolate w-72 rounded-lg border border-[#d9dee7] bg-white p-3 opacity-100 shadow-lg outline-none"
        >
          <form onSubmit={done}>
            <p className="text-sm font-semibold text-[#171717]">{item.label}</p>
            <p className="text-xs text-[#667085]">{teacher.name}</p>
            <div className="mt-3">{control}</div>
            <p className="mt-2 text-xs text-[#475467]">{item.rule}</p>
            {item.kind === "irg" && item.available !== undefined ? (
              <p className="text-xs text-[#475467]">This year: {hoursText(item.available)} left of the project&rsquo;s hours.</p>
            ) : null}
            {item.group === "safir" && hours ? (
              <label className="mt-3 flex items-center gap-2 rounded-md bg-[#f2f7f4] px-2 py-1.5 text-sm font-semibold text-[#1f5c3d]">
                <input type="checkbox" checked={draft.validated} onChange={(event) => set({ validated: event.target.checked })} />
                Validated with SAFIR
              </label>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={cancel} className="rounded-md border border-[#b7bec8] px-3 py-1.5 text-sm font-semibold text-[#344054]">
                Cancel
              </button>
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

/** The figures each rule works with, an administrator's to change for everybody at once. */
function RulesDialog({ year, term, onClose }: { year: ReductionYear; term: string; onClose: () => void }) {
  const client = useQueryClient();
  const [service, setService] = useState(year.service);
  const [figures, setFigures] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(
      year.rules.map((rule) => [
        rule.kind,
        {
          ...(rule.per !== null ? { per: rule.per } : {}),
          ...(rule.cap !== null ? { cap: rule.cap } : {}),
          ...(rule.threeYears !== undefined ? { threeYears: rule.threeYears } : {}),
          ...Object.fromEntries((rule.unit === "choice" ? (rule.options ?? []) : []).map((option) => [`option:${option.key}`, option.hours])),
        },
      ]),
    ),
  );
  const save = useMutation({
    mutationFn: () =>
      saveReductionRules({
        service,
        rules: Object.fromEntries(
          Object.entries(figures).map(([kind, values]) => {
            const options = Object.fromEntries(
              Object.entries(values)
                .filter(([name]) => name.startsWith("option:"))
                .map(([name, hours]) => [name.slice("option:".length), hours]),
            );
            const plain = Object.fromEntries(Object.entries(values).filter(([name]) => !name.startsWith("option:")));
            return [kind, { ...plain, ...(Object.keys(options).length ? { options } : {}) }];
          }),
        ),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["hour-reductions", term] });
      onClose();
    },
  });
  const number = (kind: string, name: string, label: string) => (
    <label key={name} className="inline-flex items-center gap-1.5 text-xs text-[#475467]">
      {label}
      <input
        type="number"
        min={0}
        step={0.5}
        aria-label={`${kind} ${label}`}
        value={figures[kind]?.[name] ?? 0}
        onChange={(event) => setFigures((current) => ({ ...current, [kind]: { ...current[kind], [name]: Number(event.target.value) || 0 } }))}
        className="w-16 rounded-md border border-[#b7bec8] px-1.5 py-1 text-sm text-[#171717]"
      />
    </label>
  );
  const editable = (rule: ReductionRule) => {
    if (rule.unit === "students") return [number(rule.kind, "per", "h each"), number(rule.kind, "cap", "up to h")];
    if (rule.unit === "hours") {
      return rule.cap === null
        ? [<span key="none" className="text-xs text-[#667085]">As validated</span>]
        : [number(rule.kind, "cap", "up to h"), ...(rule.threeYears !== undefined ? [number(rule.kind, "threeYears", "over 3 years h")] : [])];
    }
    if (rule.unit === "choice") return (rule.options ?? []).map((option) => number(rule.kind, `option:${option.key}`, `${option.label} h`));
    return [number(rule.kind, "per", rule.unit === "committees" ? "h each" : "h")];
  };
  return (
    <Modal
      open
      size="wide"
      title="Rules for hour reductions"
      description="The figures every teacher's hours are worked out from. A change applies to every year at once."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          {save.isError ? <p role="alert" className="mr-auto text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
          <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#344054]">
            Cancel
          </button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Save
          </button>
        </div>
      }
    >
      <label className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#344054]">
        Yearly service
        <input
          type="number"
          aria-label="Yearly service in hours"
          min={1}
          value={service}
          onChange={(event) => setService(Number(event.target.value) || 0)}
          className="w-20 rounded-md border border-[#b7bec8] px-2 py-1 text-sm"
        />
        h
      </label>
      <ul className="divide-y divide-[#e4e7ec] rounded-lg border border-[#d0d5dd]">
        {year.rules.map((rule) => (
          <li key={rule.kind} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-center">
            <p className="text-sm font-semibold text-[#171717]">{rule.label}</p>
            <div className="flex flex-wrap gap-3">{editable(rule)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
