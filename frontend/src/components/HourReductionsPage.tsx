import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Plus, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { Popover } from "radix-ui";
import { type CSSProperties, type FormEvent, Fragment, type ReactNode, useRef, useState } from "react";

import { Tip, TipDo, TipPoint } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { usePortalSemester } from "@/components/PortalSemesterMenu";
import { LabelledFigure, RECORD_CARD, RecordList, RecordRow, RecordToolbar } from "@/components/RecordList";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TableFilterBar } from "@/components/TableFilterBar";
import { TeacherAvatar } from "@/components/TeacherDatabase";
import { usePageState } from "@/components/usePageState";
import { type GridColumn, optionsFor } from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import {
  type ReductionInput,
  type ReductionItem,
  type ReductionRule,
  type ReductionState,
  type ReductionYear,
  fetchReductionYear,
  hoursOf,
  noneWords,
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

/**
 * Each column's width: as wide as the longest label it can hold ("20 STUDENTS",
 * "BACHELOR'S"), measured, so no label runs into its neighbour and the list lines up.
 */
const WIDTH: Record<string, string> = {
  phd: "4.5rem",
  masters: "4.9rem",
  project: "3.5rem",
  hdr: "2.8rem",
  irg: "2.8rem",
  internships: "5rem",
  committees: "5rem",
  hop: "4.6rem",
  hod: "3.8rem",
  new_joiner: "3.2rem",
  accreditation: "3.3rem",
  innovation: "3.2rem",
};

/**
 * The department's own options as the line under a figure has room for them; the editor
 * gives them in full. Only while an option keeps its first name: one an administrator has
 * renamed, or added, is shown by its own name.
 */
const SHORT_OPTION: Record<string, string> = {
  "Master's programme": "Master's",
  "Bachelor's programme": "Bachelor's",
  "Foundation Year": "FY",
  "Foundation Year, over 200 students": "FY 200+",
  "Foundation Year, over 500 students": "FY 500+",
  "Department of up to 200 students": "Up to 200",
  "Department of over 200 students": "Over 200",
  "Department of over 500 students": "Over 500",
};

type Teacher = ReductionYear["teachers"][number];
/** One save: some of one teacher's kinds. */
type Edit = { teacherId: string; name: string; items: Record<string, ReductionInput> };
/** `set` false: nobody has said anything — apart from a figure set to nothing, which is set. */
type Draft = { amount: number; detail: string; validated: boolean; set: boolean };

const SAVE_KEY = ["hour-reductions", "save"];

const hoursText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)} h`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a kind's hours are made of, in the few words under its figure: "12 students", "Ethics". */
function madeOf(item: Pick<ReductionItem, "unit" | "amount" | "detail" | "options" | "state">): string {
  // Set to nothing, said so under its "0 h", so it is not read as a figure left out.
  if (item.state && !item.amount && !item.detail) return item.unit === "hours" ? "" : noneWords(item.unit);
  if (item.unit === "students") return item.amount ? plural(item.amount, "student") : "";
  if (item.unit === "committees" && item.detail.includes(",")) {
    // Two or three committees by their initials, "B · E"; the editor names them.
    return item.detail
      .split(",")
      .filter(Boolean)
      .map((key) => (item.options?.find((option) => option.key === key)?.label ?? key)[0])
      .join(" · ");
  }
  if (item.unit === "committees" || item.unit === "choice") {
    return item.detail
      .split(",")
      .filter(Boolean)
      .map((key) => {
        const label = item.options?.find((option) => option.key === key)?.label ?? key;
        return SHORT_OPTION[label] ?? label;
      })
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
    // No amount and nothing chosen: back to not set. A zero stays, set.
    const cleared = given.amount === null && !given.detail?.length;
    const amount = cleared ? 0 : (given.amount ?? item.amount);
    const detail = cleared ? "" : Array.isArray(given.detail) ? given.detail.join(",") : (given.detail ?? item.detail);
    const state: ReductionState = cleared
      ? ""
      : (!amount && !detail) || item.group === "department"
        ? "set"
        : given.validated
          ? "validated"
          : "declared";
    return { ...item, amount, detail, hours: hoursOf(item, amount, detail), state };
  });
  const total = next.reduce((sum, item) => sum + item.hours, 0);
  return { ...teacher, items: next, total, owed: Math.max(0, teacher.service - total) };
}

/** What a kind is given, keeping a research figure's validation as it stands unless said. */
function input(item: ReductionItem, change: Partial<Draft>): ReductionInput {
  // Cleared: no amount and nothing chosen, which the server reads as not set.
  if (change.set === false) return { amount: null, detail: "" };
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
 * What the list can be filtered on, with the tables' own filter bar: whether a teacher has
 * declared, what is left to validate, and every kind — by its hours, its option, or its
 * committees — so "who heads a programme" or "who has PhD hours still to validate" is a
 * chip or two.
 */
function reductionColumns(rules: ReductionRule[]): GridColumn<Teacher>[] {
  const column = (
    id: string,
    displayName: string,
    type: GridColumn<Teacher>["type"],
    accessor: (teacher: Teacher) => unknown,
  ): GridColumn<Teacher> => ({ id, displayName, type, accessor, defaultWidth: 120 });
  const itemOf = (teacher: Teacher, kind: string) => teacher.items.find((item) => item.kind === kind);
  const named = (rule: ReductionRule, key: string) => rule.options?.find((option) => option.key === key)?.label ?? key;
  return [
    column("name", "Name", "text", (teacher) => teacher.name),
    column("declared", "Declared", "option", (teacher) => (teacher.declaredAt ? "Declared" : "Not declared yet")),
    column("validation", "Validation", "option", (teacher) =>
      teacher.items.some((item) => item.state === "declared")
        ? "To validate"
        : teacher.items.some((item) => item.state === "validated")
          ? "All validated"
          : "Nothing to validate",
    ),
    ...rules.map((rule) => {
      if (rule.unit === "choice") {
        return column(rule.kind, rule.label, "option", (teacher) => {
          const item = itemOf(teacher, rule.kind);
          return item?.detail ? named(rule, item.detail) : item?.state ? "None" : "Not set";
        });
      }
      if (rule.unit === "committees") {
        return column(rule.kind, rule.label, "multiOption", (teacher) => {
          const item = itemOf(teacher, rule.kind);
          const keys = (item?.detail ?? "").split(",").filter(Boolean);
          return keys.length ? keys.map((key) => named(rule, key)) : [item?.state ? "None" : "Not set"];
        });
      }
      if (rule.unit === "yes") {
        return column(rule.kind, rule.label, "option", (teacher) => {
          const item = itemOf(teacher, rule.kind);
          return item?.state ? (item.amount ? "Yes" : "No") : "Not set";
        });
      }
      return column(rule.kind, `${rule.label} (h)`, "number", (teacher) => itemOf(teacher, rule.kind)?.hours ?? 0);
    }),
    column("total", "Total (h)", "number", (teacher) => teacher.total),
    column("owed", "Teaching owed (h)", "number", (teacher) => teacher.owed),
  ];
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
 * The Head of Department, the admins of Students and Timetables and the administrators
 * change a figure where it stands (the server says who, in canChange): clicking
 * it opens it in place, with the rule it is worked out by and, for research, the SAFIR
 * tick. It is saved when it closes; Escape leaves it as it was. Nobody opens a teacher to
 * change one figure. An administrator changes the rules' figures; everybody else reads.
 */
/** The semester is the header's, as on every page: its academic year is the one shown. */
export function HourReductionsPage() {
  const client = useQueryClient();
  const { term } = usePortalSemester();
  const key = ["hour-reductions", term];
  const held = useQuery({
    queryKey: key,
    queryFn: () => fetchReductionYear(term),
    enabled: Boolean(term),
    retry: false,
  });
  const [rules, setRules] = useState(false);
  const [query, setQuery] = usePageState("hour-reductions:search", "");
  const [filters, setFilters] = usePageState<FilterModel[]>("hour-reductions:filters", []);
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

  if (!term) return <p className="text-sm text-[#475467]">Choose a semester linked to a portal term, top right.</p>;
  if (held.isLoading) return <ScreenLoading label="Reading the hour reductions…" />;
  if (held.isError || !held.data) {
    return (
      <p role="alert" className="text-sm text-[#a6292f]">{(held.error as Error | null)?.message}</p>
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
  const widths = [...kinds.map((rule) => WIDTH[rule.kind] ?? "3.4rem"), "3rem", "3.2rem"];
  const least = 11 + widths.reduce((sum, width) => sum + Number.parseFloat(width), 0) + widths.length * 0.25 + 2;
  const columns = "gap-x-1 gap-y-1 px-4 items-center";
  // The teacher's column is as wide as a name needs and no wider; what is left goes to the
  // figures, every kind's column growing alike.
  const grid = {
    gridTemplateColumns: `11rem ${widths.slice(0, -2).map((width) => `minmax(${width},1fr)`).join(" ")} ${widths.slice(-2).join(" ")}`,
    minWidth: `${least}rem`,
  };
  const change = (teacher: Teacher, items: Record<string, ReductionInput>) =>
    save.mutate({ teacherId: teacher.teacherId, name: teacher.name, items });
  const filterColumns = reductionColumns(year.rules);
  const sought = query.trim().toLowerCase();
  const searched = sought ? year.teachers.filter((teacher) => teacher.name.toLowerCase().includes(sought)) : year.teachers;
  const visible = applyFilters(searched, filterColumns, filters);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {problem ? (
        <p role="alert" className="rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">
          {problem}
        </p>
      ) : null}
      {/* As on Part-time Teachers: the search on the bar above the list, the filters along its top. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block min-w-40 flex-1 sm:max-w-64">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#475467]" aria-hidden="true" />
          <input
            aria-label="Search teachers"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search teachers"
            className="h-10 w-full rounded-md border border-[#98a2b3] bg-white pl-10 pr-3 text-sm text-[#171717] placeholder:text-[#667085]"
          />
        </label>
        <p className="min-w-0 text-sm text-[#344054]">
          <b className="text-[#171717]">{yearWords(year.year)}</b> · yearly service {year.service} h
          {waiting ? <span className="text-[#8a6116]"> · {plural(waiting, "research figure")} to validate</span> : null}
        </p>
        <div className="ml-auto flex items-center gap-3">
          {year.canChange ? (
            <span role="status" className="inline-flex shrink-0 items-center gap-1.5 text-xs text-[#475467]">
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
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-[#98a2b3] bg-white px-3 text-sm font-semibold text-[#344054]"
            >
              <SlidersHorizontal size={15} aria-hidden="true" /> Rules
            </button>
          ) : null}
        </div>
      </div>
      <section className={RECORD_CARD}>
        <RecordToolbar>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <TableFilterBar
              columns={filterColumns}
              filters={filters}
              optionsFor={(column) => optionsFor(year.teachers, column)}
              onChange={setFilters}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-[#475467]">
            {visible.length === year.teachers.length ? `${year.teachers.length}` : `${visible.length} of ${year.teachers.length}`}
          </span>
        </RecordToolbar>
        <RecordList
          label="Full-time teachers"
          columns={columns}
          grid={grid}
          scrollX
          isEmpty={!visible.length}
          empty={year.teachers.length ? "No full-time teacher matches the search and filters." : "No full-time teacher teaches this year yet."}
          head={
            <>
              {/* Which kinds are the teacher's to declare and which the Head of Department's. */}
              <span />
              <HeadTip
                title="Research, through SAFIR"
                tip={
                  <>
                    <TipDo>Check each figure with SAFIR, then tick it.</TipDo>
                    <TipPoint tone="caution">The teacher declares these on the first step of their timetable preferences request.</TipPoint>
                    <TipPoint tone="good">A ticked figure is validated; one the teacher changes afterwards waits to be checked again.</TipPoint>
                  </>
                }
                style={{ gridColumn: `span ${research.length}` }}
                className="border-b border-[#98a2b3] pb-0.5 text-[#171717]"
              />
              <HeadTip
                title="Set by the Head of Department"
                tip={
                  <>
                    <TipDo>Set these for each teacher.</TipDo>
                    <TipPoint>The teacher reads them, without changing them, on their first step.</TipPoint>
                  </>
                }
                style={{ gridColumn: `span ${department.length}` }}
                className="border-b border-[#98a2b3] pb-0.5 text-[#171717]"
              />
              <span />
              <span />
              <span>Teacher</span>
              {kinds.map((rule) => (
                <HeadTip key={rule.kind} title={rule.label} tip={<RuleTip rule={rule} canChange={year.canChange} />} className="leading-tight">
                  {SHORT[rule.kind] ?? rule.label}
                </HeadTip>
              ))}
              <HeadTip
                title="Total"
                tip={<TipPoint>Every reduction the teacher has this year, in hours.</TipPoint>}
              >
                Total
              </HeadTip>
              <HeadTip
                title="Teaching owed"
                tip={
                  <>
                    <TipPoint>The year&rsquo;s service, {year.service} h, less the total. Never below 0 h.</TipPoint>
                    <TipPoint>Teaching loads shows it beside each full-timer&rsquo;s planned hours.</TipPoint>
                  </>
                }
              >
                Owes
              </HeadTip>
            </>
          }
        >
          {visible.map((teacher) => (
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
              <LabelledFigure value={hoursText(teacher.total)} tone="text-[#171717]" />
              <LabelledFigure value={hoursText(teacher.owed)} label={`of ${teacher.service}`} tone="text-[#1f4e79]" />
            </RecordRow>
          ))}
        </RecordList>
      </section>
      <p className="text-xs text-[#475467]">
        Every figure is in hours, with what it is made of under it.{" "}
        <span className="font-semibold text-[#8a6116]">Amber, marked !</span>: declared by the teacher, still to validate with
        SAFIR. <Check size={11} className="inline align-[-1px] text-[#2e7d55]" aria-hidden="true" /> validated.
        {year.canChange
          ? " Click a figure to change it: it is saved when it closes, and Escape leaves it as it was. A 0, No or None is kept as a figure; Clear leaves it not set."
          : ""}{" "}
        Full-time teachers declare theirs as the first step of the timetable preferences request.
      </p>

      {rules ? <RulesDialog year={year} onClose={() => setRules(false)} /> : null}
    </div>
  );
}

/**
 * A heading that explains itself in the app's bubble on hover. The pointer stays the arrow:
 * a heading is read, not typed into or pressed.
 */
function HeadTip({
  title,
  tip,
  children,
  className = "",
  style,
}: {
  title: string;
  tip: ReactNode;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Tip title={title} content={tip} side="bottom" wide={false}>
      <span style={style} className={`cursor-default ${className}`}>
        {children ?? title}
      </span>
    </Tip>
  );
}

/** What a column takes, how its hours are worked out, and who gives it. */
function RuleTip({ rule, canChange }: { rule: ReductionRule; canChange: boolean }) {
  const enter =
    rule.unit === "students"
      ? "Click a cell and enter how many students, 0 if none. The hours are worked out."
      : rule.unit === "hours"
        ? "Click a cell and enter the hours, 0 if none."
        : rule.unit === "yes"
          ? "Click a cell and choose Yes or No for this year."
          : rule.unit === "committees"
            ? "Click a cell and tick each committee the teacher sits on, or None."
            : "Click a cell and choose the one that applies, or None.";
  return (
    <>
      {canChange ? <TipDo>{enter}</TipDo> : null}
      <TipPoint>{rule.rule}</TipPoint>
      <TipPoint tone={rule.group === "safir" ? "caution" : "info"}>
        {rule.group === "safir"
          ? "Declared by the teacher, validated with SAFIR."
          : "Set by the Head of Department; the teacher reads it."}
      </TipPoint>
    </>
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
    <div className="sticky left-0 z-10 flex min-w-0 items-center gap-2 bg-white group-hover:bg-[#f4f7fb]">
      <TeacherAvatar fullName={teacher.name} size="tiny" />
      <span className="min-w-0">
        {/* A long name wraps rather than losing its end: the column is kept narrow for the figures. */}
        <span className="block break-words font-semibold leading-tight text-[#171717]">
          {teacher.name}
          {teacher.head ? (
            <span className="ml-1.5 inline-block rounded border border-[#1f4e79] px-1 align-[1px] text-[10px] font-semibold leading-4 text-[#1f4e79]">
              HoD
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-[#344054]" title={teacher.note || undefined}>
          {teacher.declaredAt ? `Declared ${dayWords(teacher.declaredAt)}` : <span className="italic text-[#475467]">Not declared yet</span>}
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
          {item.hours || item.state ? hoursText(item.hours) : "—"}
          <StateMark state={item.state} />
        </span>
      }
      label={madeOf(item)}
      faint={!item.hours}
      tone={item.state === "declared" ? "text-[#8a6116]" : "text-[#171717]"}
    />
  );
}

/**
 * An empty cell that takes a figure: a dashed box with a plus, so it reads as somewhere to
 * add one. A dash said "nothing here" and nothing about what to do.
 */
function AddMark() {
  return (
    <span className="inline-flex h-7 w-9 items-center justify-center rounded-md border border-dashed border-[#98a2b3] text-[#475467] transition-colors group-hover/figure:border-solid group-hover/figure:border-[#1f4e79] group-hover/figure:text-[#1f4e79]">
      <Plus size={14} aria-hidden="true" />
    </span>
  );
}

function figureWords(item: ReductionItem): string {
  return [item.state ? hoursText(item.hours) : "not set", madeOf(item), standing(item.state)].filter(Boolean).join(", ");
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
  const fromItem = (): Draft => ({
    amount: item.amount,
    detail: item.detail,
    validated: item.state === "validated",
    set: Boolean(item.state),
  });
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
      draft.set !== Boolean(item.state) ||
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
  /** Back to not set: saved at once when it was set, merely closed when it never was. */
  const clear = () => {
    keep.current = false;
    if (item.state) onChange({ amount: 0, detail: "", validated: false, set: false });
    setOpen(false);
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
          value={draft.set ? String(draft.amount) : ""}
          placeholder="Not set"
          // An empty box is not set; a 0 is a figure of its own.
          onChange={(event) => set(event.target.value === "" ? { set: false, amount: 0 } : { set: true, amount: number(event.target.value) })}
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
    // Yes or No; neither while it is not set.
    control = (
      <div role="radiogroup" aria-label={item.label} className="space-y-1.5">
        {[
          { answer: 1, words: "Yes", hours: item.per ?? 0 },
          { answer: 0, words: "No", hours: 0 },
        ].map((choice) => (
          <label key={choice.words} className="flex items-center gap-2 text-sm text-[#344054]">
            <input
              type="radio"
              name={`${teacher.teacherId}-${item.kind}`}
              checked={draft.set && Boolean(draft.amount) === Boolean(choice.answer)}
              onChange={() => set({ amount: choice.answer, set: true })}
            />
            <span className="min-w-0 flex-1">{choice.words}</span>
            <span className="tabular-nums text-[#667085]">{hoursText(choice.hours)}</span>
          </label>
        ))}
      </div>
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
                set({ detail: next.join(","), amount: next.length, set: true });
              }}
            />
            {option.label}
          </label>
        ))}
        {/* Set, with no committee: none, apart from not set. */}
        <label className="flex items-center gap-2 text-sm text-[#344054]">
          <input
            type="checkbox"
            checked={draft.set && !chosen.length}
            onChange={(event) => set(event.target.checked ? { detail: "", amount: 0, set: true } : { set: false })}
          />
          None
        </label>
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
              // Nothing chosen while it is not set; None is a choice of its own.
              checked={draft.set && draft.detail === option.key}
              onChange={() => set({ detail: option.key, amount: option.key ? 1 : 0, set: true })}
            />
            <span className="min-w-0 flex-1">{option.label}</span>
            <span className="tabular-nums text-[#667085]">{hoursText(option.hours)}</span>
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
          className={`group/figure -mx-1 flex min-w-0 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-[#eef4fa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7e5f3] ${
            open ? "bg-[#eef4fa]" : ""
          }`}
        >
          {item.state ? <FigureFace item={item} /> : <AddMark />}
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
              {item.state || draft.set ? (
                <button
                  type="button"
                  onClick={clear}
                  title="Leave it not set, as if nobody had said anything"
                  className="mr-auto rounded-md px-1 py-1.5 text-sm font-semibold text-[#475467] underline-offset-2 hover:text-[#171717] hover:underline"
                >
                  Clear
                </button>
              ) : null}
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

/** An option of a choice as the Rules window holds it: a new one has no key until it is saved. */
type OptionDraft = { key: string; label: string; hours: number };

/**
 * The figures each rule works with, an administrator's to change for everybody at once —
 * and, for a headship, its options: renamed, added, or taken away once nobody has them.
 */
function RulesDialog({ year, onClose }: { year: ReductionYear; onClose: () => void }) {
  const client = useQueryClient();
  const [service, setService] = useState(year.service);
  const [figures, setFigures] = useState<Record<string, Record<string, number>>>(() =>
    Object.fromEntries(
      year.rules
        .filter((rule) => rule.unit !== "choice")
        .map((rule) => [
          rule.kind,
          {
            ...(rule.per !== null ? { per: rule.per } : {}),
            ...(rule.cap !== null ? { cap: rule.cap } : {}),
            ...(rule.threeYears !== undefined ? { threeYears: rule.threeYears } : {}),
          },
        ]),
    ),
  );
  const [options, setOptions] = useState<Record<string, OptionDraft[]>>(() =>
    Object.fromEntries(
      year.rules
        .filter((rule) => rule.unit === "choice")
        .map((rule) => [rule.kind, (rule.options ?? []).map((option) => ({ ...option }))]),
    ),
  );
  const save = useMutation({
    mutationFn: () =>
      saveReductionRules({
        service,
        rules: {
          ...figures,
          ...Object.fromEntries(
            Object.entries(options).map(([kind, list]) => [
              kind,
              { options: list.map((option) => ({ ...(option.key ? { key: option.key } : {}), label: option.label, hours: option.hours })) },
            ]),
          ),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["hour-reductions"] });
      onClose();
    },
  });
  const field = "rounded-md border border-[#b7bec8] px-1.5 py-1 text-sm text-[#171717] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";
  const number = (kind: string, name: string, label: string) => (
    <label key={name} className="inline-flex items-center gap-1.5 text-xs text-[#344054]">
      {label}
      <input
        type="number"
        min={0}
        step={0.5}
        aria-label={`${kind} ${label}`}
        value={figures[kind]?.[name] ?? 0}
        onChange={(event) => setFigures((current) => ({ ...current, [kind]: { ...current[kind], [name]: Number(event.target.value) || 0 } }))}
        className={`${field} w-16`}
      />
    </label>
  );
  const changeOption = (kind: string, at: number, change: Partial<OptionDraft>) =>
    setOptions((current) => ({
      ...current,
      [kind]: current[kind].map((option, index) => (index === at ? { ...option, ...change } : option)),
    }));
  const choices = (rule: ReductionRule) => (
    <div className="w-full space-y-1.5">
      {(options[rule.kind] ?? []).map((option, at) => (
        <div key={option.key || `new-${at}`} className="flex items-center gap-2">
          <input
            type="text"
            aria-label={`${rule.label}: name of option ${at + 1}`}
            value={option.label}
            placeholder="Name of the option"
            onChange={(event) => changeOption(rule.kind, at, { label: event.target.value })}
            className={`${field} min-w-0 flex-1`}
          />
          <input
            type="number"
            min={0}
            step={0.5}
            aria-label={`${rule.label}: hours for option ${at + 1}`}
            value={option.hours}
            onChange={(event) => changeOption(rule.kind, at, { hours: Number(event.target.value) || 0 })}
            className={`${field} w-16`}
          />
          <span className="text-xs text-[#344054]">h</span>
          <button
            type="button"
            aria-label={`Take away ${option.label || `option ${at + 1}`}`}
            onClick={() => setOptions((current) => ({ ...current, [rule.kind]: current[rule.kind].filter((_, index) => index !== at) }))}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#a6292f] hover:bg-[#fdf3f3]"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setOptions((current) => ({ ...current, [rule.kind]: [...(current[rule.kind] ?? []), { key: "", label: "", hours: 0 }] }))}
        className="inline-flex items-center gap-1 text-sm font-semibold text-[#1f4e79] underline-offset-2 hover:underline"
      >
        <Plus size={14} aria-hidden="true" /> Add an option
      </button>
    </div>
  );
  const editable = (rule: ReductionRule) => {
    if (rule.unit === "students") return [number(rule.kind, "per", "h each"), number(rule.kind, "cap", "up to h")];
    if (rule.unit === "hours") {
      return rule.cap === null
        ? [<span key="none" className="text-xs text-[#475467]">As validated</span>]
        : [number(rule.kind, "cap", "up to h"), ...(rule.threeYears !== undefined ? [number(rule.kind, "threeYears", "over 3 years h")] : [])];
    }
    if (rule.unit === "choice") return [<Fragment key="choices">{choices(rule)}</Fragment>];
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
          className={`${field} w-20`}
        />
        h
      </label>
      <ul className="divide-y divide-[#d0d5dd] rounded-lg border border-[#b8c2cf]">
        {year.rules.map((rule) => (
          <li key={rule.kind} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:items-start">
            <div>
              <p className="text-sm font-semibold text-[#171717]">{rule.label}</p>
              {rule.unit === "choice" ? (
                <p className="mt-0.5 text-xs text-[#475467]">
                  An option a teacher has keeps them when it is renamed. One a teacher has cannot be taken away.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3">{editable(rule)}</div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
