import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";
import { ReductionFields, ReductionTotals } from "@/components/ReductionFields";
import { ScreenLoading } from "@/components/ScreenLoading";
import { useReductionDraft } from "@/components/useReductionDraft";
import {
  type ReductionRule,
  type ReductionYear,
  fetchReductionYear,
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

type Teacher = ReductionYear["teachers"][number];

const cell = "border border-[#d0d5dd] px-2 py-1.5";

/**
 * Hour reductions: every full-timer's year, as the department's table had it.
 *
 * A column per kind — research through SAFIR, then the department's own — the total, and the
 * teaching each still owes of the year's service. A research figure a teacher declared and
 * nobody has checked with SAFIR yet is marked. An administrator opens a teacher to set the
 * department's reductions, correct and validate the research ones, and changes the rules'
 * figures; everybody else reads.
 */
export function HourReductionsPage({ header }: { header?: HTMLElement | null }) {
  const { semesters, semester, setTermId, term } = usePortalSemester();
  const held = useQuery({
    queryKey: ["hour-reductions", term],
    queryFn: () => fetchReductionYear(term),
    enabled: Boolean(term),
    retry: false,
  });
  const [open, setOpen] = useState<Teacher | null>(null);
  const [rules, setRules] = useState(false);
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

  return (
    <div className="space-y-4">
      {menu}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#344054]">
          <b className="text-[#171717]">{yearWords(year.year)}</b> · yearly service {year.service} h ·{" "}
          {year.teachers.length} full-time teacher{year.teachers.length === 1 ? "" : "s"}
          {waiting ? <span className="text-[#7a5410]"> · {waiting} research figure{waiting === 1 ? "" : "s"} to validate</span> : null}
        </p>
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

      {year.teachers.length === 0 ? (
        <p className="text-sm text-[#667085]">No full-time teacher teaches this year yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#d0d5dd]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#f2f4f7] text-xs font-semibold text-[#344054]">
              <tr>
                <th rowSpan={2} className={`${cell} text-left`}>Teacher</th>
                <th colSpan={research.length} className={cell}>Research, through SAFIR</th>
                <th colSpan={department.length} className={cell}>Set by the Head of Department</th>
                <th rowSpan={2} className={cell}>Total</th>
                <th rowSpan={2} className={cell}>Teaching owed</th>
              </tr>
              <tr>
                {[...research, ...department].map((rule) => (
                  <th key={rule.kind} title={`${rule.label}: ${rule.rule}`} className={`${cell} whitespace-nowrap`}>
                    {SHORT[rule.kind] ?? rule.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {year.teachers.map((teacher) => (
                <tr key={teacher.teacherId} className="hover:bg-[#f8fafc]">
                  <td className={`${cell} min-w-[11rem] text-left`}>
                    <button type="button" onClick={() => setOpen(teacher)} className="text-left font-semibold text-[#1f4e79] underline-offset-2 hover:underline">
                      {teacher.name}
                    </button>
                    {teacher.head ? <span className="ml-1.5 rounded border border-[#1f4e79] px-1 text-[10px] font-semibold text-[#1f4e79]">HoD</span> : null}
                    {!teacher.fullTime ? <span className="ml-1.5 text-[11px] text-[#7a5410]">not full time now</span> : null}
                    {!teacher.declaredAt ? <span className="block text-[11px] text-[#667085]">Not declared yet</span> : null}
                  </td>
                  {teacher.items.map((item) => (
                    <td
                      key={item.kind}
                      title={item.state === "declared" ? "Declared, to be validated with SAFIR" : undefined}
                      className={`${cell} text-center tabular-nums ${
                        item.state === "declared" ? "bg-[#fff8e6] font-semibold text-[#7a5410]" : item.hours ? "text-[#171717]" : "text-[#98a2b3]"
                      }`}
                    >
                      {item.hours || "·"}
                    </td>
                  ))}
                  <td className={`${cell} text-center font-semibold tabular-nums`}>{teacher.total}</td>
                  <td className={`${cell} text-center font-semibold tabular-nums`}>{teacher.owed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[#475467]">
        <span className="rounded bg-[#fff8e6] px-1 font-semibold text-[#7a5410]">Amber</span> figures were declared by the
        teacher and are still to be validated with SAFIR. Full-time teachers declare theirs as the first step of the
        timetable preferences request.
      </p>

      {open ? (
        <TeacherReductions
          key={open.teacherId}
          teacher={year.teachers.find((teacher) => teacher.teacherId === open.teacherId) ?? open}
          canChange={year.canChange}
          term={term}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {rules ? <RulesDialog year={year} term={term} onClose={() => setRules(false)} /> : null}
    </div>
  );
}

/** One teacher's year: the department's reductions to set, the research ones to check. */
function TeacherReductions({
  teacher,
  canChange,
  term,
  onClose,
}: {
  teacher: Teacher;
  canChange: boolean;
  term: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { draft, set, total, owed, changes } = useReductionDraft(teacher.items, teacher.service);
  const save = useMutation({
    mutationFn: () => saveDepartmentReductions(teacher.year, teacher.teacherId, changes(() => true, true)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["hour-reductions", term] });
      onClose();
    },
  });
  return (
    <Modal
      open
      size="wide"
      title={teacher.name}
      description={`Hour reductions for ${yearWords(teacher.year)}`}
      onClose={onClose}
      footer={
        canChange ? (
          <div className="flex items-center justify-end gap-2">
            {save.isError ? <p role="alert" className="mr-auto text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
            <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#344054]">
              Cancel
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {save.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null} Save
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-5">
        {teacher.declaredAt ? (
          <p className="text-sm text-[#475467]">
            Declared by the teacher on {teacher.declaredAt.slice(0, 10)}.
            {teacher.note ? <span className="mt-1 block rounded-md bg-[#f2f7fb] px-3 py-2 text-[#344054]">“{teacher.note}”</span> : null}
          </p>
        ) : (
          <p className="text-sm text-[#475467]">The teacher has not declared their research reductions for this year yet.</p>
        )}
        <ReductionFields
          title="Research, through SAFIR"
          about={canChange ? "Correct a figure if SAFIR has another, and tick it once SAFIR has confirmed it." : "Declared by the teacher."}
          items={teacher.items.filter((item) => item.group === "safir")}
          draft={draft}
          onChange={set}
          editable={() => canChange}
          withValidation={canChange}
        />
        <ReductionFields
          title="Set by the Head of Department"
          about={canChange ? "The teacher reads these on their first step." : "Set by the Head of Department."}
          items={teacher.items.filter((item) => item.group === "department")}
          draft={draft}
          onChange={set}
          editable={() => canChange}
        />
        <ReductionTotals total={total} owed={owed} service={teacher.service} />
      </div>
    </Modal>
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
