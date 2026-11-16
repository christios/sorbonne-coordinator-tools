import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, SlidersHorizontal } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";

import { Modal } from "@/components/Modal";
import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
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

/** An option as a table cell has room for it; the open list adds its hours. */
const SHORT_OPTION: Record<string, string> = {
  master: "Master's",
  bachelor: "Bachelor's",
  foundation: "FY",
  "foundation-200": "FY 200+",
  "foundation-500": "FY 500+",
  hod: "Up to 200",
  "hod-200": "200+",
  "hod-500": "500+",
};

/** What a column takes, under its head, so nobody types hours where students are counted. */
function takes(rule: ReductionRule): string {
  if (rule.unit === "students") return "students";
  if (rule.unit === "hours") return "hours";
  if (rule.unit === "yes") return `${rule.per ?? 0} h`;
  if (rule.unit === "committees") return (rule.options ?? []).map((option) => option.label[0]).join(" · ");
  return "";
}

type Teacher = ReductionYear["teachers"][number];
/** One save: some of one teacher's kinds. */
type Edit = { teacherId: string; name: string; items: Record<string, ReductionInput> };

// Each cell draws its own right and bottom edge, the frame the rest: with the table's borders
// collapsed, a stuck header would leave its lines behind as it scrolls.
const cell = "border-b border-r border-[#d0d5dd] px-1.5 py-1.5";
const SAVE_KEY = ["hour-reductions", "save"];

const hoursText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} h`;

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
function input(item: ReductionItem, change: Partial<{ amount: number; detail: string; validated: boolean }>): ReductionInput {
  return {
    amount: change.amount ?? item.amount,
    detail: change.detail ?? item.detail,
    ...(item.group === "safir" ? { validated: change.validated ?? item.state === "validated" } : {}),
  };
}

/**
 * Hour reductions: every full-timer's year, as the department's table had it.
 *
 * A column per kind — research through SAFIR, then the department's own — the total, and the
 * teaching each still owes of the year's service. The Head of Department and the
 * administrators change the figures in the table itself, a cell at a time, and each change is
 * saved as they leave the cell: the department's table was a spreadsheet, and opening a
 * window per teacher to change one figure was not how anybody worked in it. A research
 * figure a teacher declared and nobody has checked with SAFIR yet is amber, with its tick
 * beside it. An administrator changes the rules' figures; everybody else reads.
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
  const waiting = year.teachers.reduce(
    (count, teacher) => count + teacher.items.filter((item) => item.state === "declared").length,
    0,
  );
  const change = (teacher: Teacher, items: Record<string, ReductionInput>) =>
    save.mutate({ teacherId: teacher.teacherId, name: teacher.name, items });

  return (
    <div className="space-y-4">
      {menu}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#344054]">
          <b className="text-[#171717]">{yearWords(year.year)}</b> · yearly service {year.service} h ·{" "}
          {year.teachers.length} full-time teacher{year.teachers.length === 1 ? "" : "s"}
          {waiting ? <span className="text-[#7a5410]"> · {waiting} research figure{waiting === 1 ? "" : "s"} to validate</span> : null}
        </p>
        <div className="flex items-center gap-3">
          {year.canChange ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-[#667085]">
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
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054]"
            >
              <SlidersHorizontal size={14} aria-hidden="true" /> Rules
            </button>
          ) : null}
        </div>
      </div>
      {problem ? (
        <p role="alert" className="rounded-md border border-[#f3c5c5] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
          {problem}
        </p>
      ) : null}

      {year.teachers.length === 0 ? (
        <p className="text-sm text-[#667085]">No full-time teacher teaches this year yet.</p>
      ) : (
        <div className="always-scrollbar max-h-[min(78vh,64rem)] overflow-auto overscroll-x-none rounded-lg border border-[#d0d5dd]">
          <table className="w-full border-separate border-spacing-0 text-sm [&_tbody_tr:last-child_td]:border-b-0">
            {/* Stuck to the top of the table's own scroll, so a column keeps its name down the list. */}
            <thead className="sticky top-0 z-20 bg-[#f2f4f7] text-xs font-semibold text-[#344054]">
              <tr>
                <th rowSpan={2} className={`${cell} sticky left-0 z-10 bg-[#f2f4f7] text-left`}>Teacher</th>
                <th colSpan={research.length} className={cell}>Research, through SAFIR</th>
                <th colSpan={department.length} className={cell}>Set by the Head of Department</th>
                <th rowSpan={2} className={cell}>Total</th>
                <th rowSpan={2} className={`${cell} border-r-0`}>Teaching owed</th>
              </tr>
              <tr>
                {[...research, ...department].map((rule) => (
                  <th key={rule.kind} title={`${rule.label}: ${rule.rule}`} className={`${cell} leading-tight`}>
                    {SHORT[rule.kind] ?? rule.label}
                    {year.canChange && takes(rule) ? (
                      <span className="block text-[10px] font-normal text-[#667085]">{takes(rule)}</span>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {year.teachers.map((teacher, row) => (
                <TeacherRow
                  key={teacher.teacherId}
                  teacher={teacher}
                  row={row}
                  canChange={year.canChange}
                  onChange={(items) => change(teacher, items)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[#475467]">
        <span className="rounded bg-[#fff8e6] px-1 font-semibold text-[#7a5410]">Amber</span> figures were declared by the
        teacher and are still to be validated with SAFIR
        {year.canChange ? (
          <>
            : tick ✓ beside one once SAFIR has confirmed it. Every change is saved as you leave the cell; Enter goes to the next teacher.
          </>
        ) : (
          "."
        )}{" "}
        Full-time teachers declare theirs as the first step of the timetable preferences request.
      </p>

      {rules ? <RulesDialog year={year} term={term} onClose={() => setRules(false)} /> : null}
    </div>
  );
}

/** One full-timer's row: their name and where they stand, a cell per kind, and the sums. */
function TeacherRow({
  teacher,
  row,
  canChange,
  onChange,
}: {
  teacher: Teacher;
  row: number;
  canChange: boolean;
  onChange: (items: Record<string, ReductionInput>) => void;
}) {
  const declared = teacher.items.filter((item) => item.state === "declared");
  return (
    <tr className="hover:bg-[#f8fafc]">
      <td className={`${cell} sticky left-0 z-10 min-w-[10.5rem] bg-white text-left`}>
        <span className="font-semibold text-[#171717]">{teacher.name}</span>
        {teacher.head ? <span className="ml-1.5 rounded border border-[#1f4e79] px-1 text-[10px] font-semibold text-[#1f4e79]">HoD</span> : null}
        {!teacher.fullTime ? <span className="ml-1.5 text-[11px] text-[#7a5410]">not full time now</span> : null}
        <span className="block text-[11px] text-[#667085]">
          {teacher.declaredAt ? `Declared ${teacher.declaredAt.slice(0, 10)}` : "Not declared yet"}
        </span>
        {teacher.note ? (
          <span title={teacher.note} className="block max-w-[12rem] truncate text-[11px] italic text-[#475467]">
            “{teacher.note}”
          </span>
        ) : null}
        {canChange && declared.length > 1 ? (
          <button
            type="button"
            onClick={() => onChange(Object.fromEntries(declared.map((item) => [item.kind, input(item, { validated: true })])))}
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1f5c3d] underline-offset-2 hover:underline"
          >
            <Check size={11} aria-hidden="true" /> Validate all {declared.length}
          </button>
        ) : null}
      </td>
      {teacher.items.map((item) =>
        canChange ? (
          <EditCell key={item.kind} teacher={teacher} item={item} row={row} onChange={(change) => onChange({ [item.kind]: input(item, change) })} />
        ) : (
          <td
            key={item.kind}
            title={item.state === "declared" ? "Declared, to be validated with SAFIR" : undefined}
            className={`${cell} text-center tabular-nums ${
              item.state === "declared" ? "bg-[#fff8e6] font-semibold text-[#7a5410]" : item.hours ? "text-[#171717]" : "text-[#98a2b3]"
            }`}
          >
            {item.hours || "·"}
          </td>
        ),
      )}
      <td className={`${cell} text-center font-semibold tabular-nums`}>{teacher.total}</td>
      <td className={`${cell} border-r-0 text-center font-semibold tabular-nums`}>{teacher.owed}</td>
    </tr>
  );
}

type Change = Partial<{ amount: number; detail: string; validated: boolean }>;

/** One kind for one teacher, changed where it stands. */
function EditCell({ teacher, item, row, onChange }: { teacher: Teacher; item: ReductionItem; row: number; onChange: (change: Change) => void }) {
  const label = `${item.label}, ${teacher.name}`;
  const declared = item.state === "declared";
  const tone = declared ? "bg-[#fff8e6]" : "";
  const under = (text: string) => <span className="block text-[11px] tabular-nums text-[#667085]">{text}</span>;

  let control: ReactNode;
  if (item.unit === "students" || item.unit === "hours") {
    control = <FigureInput item={item} label={label} row={row} onCommit={(amount) => onChange({ amount })} />;
  } else if (item.unit === "yes") {
    control = (
      <input
        type="checkbox"
        aria-label={label}
        checked={Boolean(item.amount)}
        onChange={(event) => onChange({ amount: event.target.checked ? 1 : 0 })}
        className="h-4 w-4 accent-[#1f4e79]"
      />
    );
  } else if (item.unit === "committees") {
    const chosen = item.detail.split(",").filter(Boolean);
    control = (
      <span className="inline-flex gap-1">
        {(item.options ?? []).map((option) => {
          const on = chosen.includes(option.key);
          return (
            <button
              key={option.key}
              type="button"
              aria-pressed={on}
              aria-label={`${option.label} committee, ${teacher.name}`}
              title={`${option.label} committee`}
              onClick={() => {
                const next = (item.options ?? []).map((entry) => entry.key).filter((key) => (key === option.key ? !on : chosen.includes(key)));
                onChange({ detail: next.join(","), amount: next.length });
              }}
              className={`h-6 w-6 rounded border text-[11px] font-semibold ${
                on ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#b7bec8] bg-white text-[#667085] hover:border-[#1f4e79]"
              }`}
            >
              {option.label[0]}
            </button>
          );
        })}
      </span>
    );
  } else {
    control = (
      <div className="w-[6.25rem]">
        <SelectMenu
          size="small"
          label={label}
          value={item.detail}
          placeholder="None"
          align="start"
          onChange={(detail) => onChange({ detail, amount: detail ? 1 : 0 })}
          options={[
            { value: "", label: "None" },
            ...(item.options ?? []).map((option) => ({
              value: option.key,
              label: SHORT_OPTION[option.key] ?? option.label,
              detail: `${option.hours} h`,
            })),
          ]}
        />
      </div>
    );
  }

  return (
    <td title={declared ? "Declared by the teacher, to be validated with SAFIR" : undefined} className={`${cell} text-center align-middle ${tone}`}>
      <span className="inline-flex items-center gap-1">
        {control}
        {item.group === "safir" && item.hours ? (
          <button
            type="button"
            aria-pressed={item.state === "validated"}
            aria-label={`${item.label} validated with SAFIR, ${teacher.name}`}
            title={item.state === "validated" ? "Validated with SAFIR. Click to take it back." : "Click once SAFIR has confirmed it."}
            onClick={() => onChange({ validated: item.state !== "validated" })}
            className={`inline-flex h-5 w-5 items-center justify-center rounded border ${
              item.state === "validated"
                ? "border-[#2e7d55] bg-[#2e7d55] text-white"
                : "border-[#d99b1c] bg-white text-[#d99b1c] hover:bg-[#fff1cc]"
            }`}
          >
            <Check size={12} aria-hidden="true" />
          </button>
        ) : null}
      </span>
      {item.hours && item.unit !== "hours" ? under(hoursText(item.hours)) : null}
    </td>
  );
}

/**
 * A count or some hours, typed into the cell. It is saved when the cell is left — Tab, a
 * click elsewhere, or Enter, which goes on to the same column's next teacher, as in a
 * spreadsheet. Escape puts back what is saved.
 */
function FigureInput({ item, label, row, onCommit }: { item: ReductionItem; label: string; row: number; onCommit: (amount: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  // The same, read at once: leaving by Enter moves the focus before the state is drawn again.
  const typed = useRef<string | null>(null);
  const edit = (value: string | null) => {
    typed.current = value;
    setText(value);
  };
  const shown = text ?? (item.amount ? String(item.amount) : "");
  const commit = () => {
    const value = typed.current;
    if (value === null) return;
    edit(null);
    const amount = Math.max(0, Number(value.trim().replace(",", ".")) || 0);
    if (amount !== item.amount) onCommit(amount);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      data-reduction-kind={item.kind}
      data-reduction-row={row}
      value={shown}
      placeholder="·"
      onFocus={(event) => {
        edit(shown);
        event.target.select();
      }}
      onChange={(event) => edit(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          edit(null);
        } else if (event.key === "Enter") {
          event.preventDefault();
          commit();
          const next = document.querySelector<HTMLInputElement>(
            `input[data-reduction-kind="${item.kind}"][data-reduction-row="${row + 1}"]`,
          );
          if (next) next.focus();
          else event.currentTarget.blur();
        }
      }}
      className="h-7 w-11 rounded-md border border-[#b7bec8] bg-white px-1.5 text-center text-sm tabular-nums text-[#171717] placeholder:text-[#98a2b3] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
    />
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
