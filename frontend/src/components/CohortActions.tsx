import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchPortalCourses, fetchTermLinks } from "@/services/portalLists";
import { rowsHeld } from "@/services/rosterStore";
import { fetchSchema, type PortalField, type RosterRow } from "@/services/scenRosters";
import { type Cohort, deleteCohort, updateCohort } from "@/services/studentDatabase";

type Option = { value: string; label: string };

/** The codes the department has always dealt in, for a browser that has read nothing yet. */
const KNOWN: Record<string, Option[]> = {
  MAJOR_CODE: [
    { value: "MATH", label: "Applied Mathematics and Physics" },
    { value: "PHYS", label: "Physics" },
  ],
  YEARLEVEL_CODE: [
    { value: "FY", label: "Foundation Year" },
    { value: "L1", label: "L1" },
    { value: "L2", label: "L2" },
    { value: "L3", label: "L3" },
  ],
  TERM_CODE: [],
};

/**
 * Every code a field is known to take, from every source this browser has: the portal's
 * own table when the extension has read it, the values on the rows the pulls hold, the
 * portal terms other pages know, and the codes the department has always used. Each once,
 * the portal's label where there is one.
 */
function choicesFor(field: string, sources: { schema: PortalField[]; rows: RosterRow[]; extra: Option[] }): Option[] {
  const out = new Map<string, string>();
  const add = (value: string, label = "") => {
    const code = value.trim();
    if (!code) return;
    if (!out.has(code) || (label && out.get(code) === code)) out.set(code, label || out.get(code) || code);
  };
  for (const option of sources.schema.find((held) => held.key.toUpperCase() === field)?.options ?? []) add(option.value, option.label);
  for (const option of sources.extra) add(option.value, option.label);
  for (const option of KNOWN[field] ?? []) add(option.value, option.label);
  // What the pulls carry: the code when they have it, else the description, which the
  // rules match by label anyway.
  const described = field.replace(/_CODE$/, "_DESC");
  for (const row of sources.rows) {
    const code = String(row[field] ?? "").trim();
    const desc = String(row[described] ?? row[`${field}_DESC`] ?? "").trim();
    if (code) add(code, desc);
    else if (desc) add(desc);
  }
  return [...out.entries()]
    .map(([value, label]) => ({ value, label: label === value ? value : `${label} (${value})` }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * Renaming a cohort, saying what it expects, deleting one, and seeing who is in it.
 *
 * These lived on a Cohorts page of their own, which existed to list four cohorts and let
 * you click one. The list is now the dropdown beside this, so the page was a detour: the
 * things it could actually do belong next to the cohort they act on.
 *
 * What a cohort expects is said in the portal's codes — the majors and the terms it
 * spans, and a year level — chosen from the code tables the extension read from the
 * portal, so "differs from the cohort's" compares like with like.
 */
export function CohortActions({
  cohort,
  onShowMembers,
}: {
  cohort: Cohort;
  /** Left out where the members are already on screen, as on the Cohorts page. */
  onShowMembers?: (cohort: Cohort) => void;
}) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(cohort.name);
  const [term, setTerm] = useState(cohort.term);
  const [majors, setMajors] = useState<string[]>(cohort.majors);
  const [terms, setTerms] = useState<string[]>(cohort.terms);
  const [yearLevel, setYearLevel] = useState(cohort.yearLevel);
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: editing, staleTime: 60_000 });
  const held = useQuery({ queryKey: ["roster-rows-held"], queryFn: rowsHeld, enabled: editing, staleTime: 60_000 });
  const portalTerms = useQuery({ queryKey: ["portal", "courses", ""], queryFn: () => fetchPortalCourses("", ""), enabled: editing, retry: false });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: editing, retry: false });

  const refresh = () => client.invalidateQueries({ queryKey: ["cohorts"] });
  const save = useMutation({
    mutationFn: () =>
      updateCohort(cohort.id, {
        name: name.trim(),
        term: term.trim(),
        notes: cohort.notes,
        majors,
        terms,
        yearLevel: yearLevel.trim(),
      }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteCohort(cohort.id),
    onSuccess: () => {
      setDeleting(false);
      refresh();
    },
  });

  const sources = { schema: schema.data?.fields ?? [], rows: held.data ?? [], extra: [] as Option[] };
  // Terms come from more places than a table: the term the extension is set to, the terms
  // the Courses list holds, and the ones the semesters are linked to.
  const current = schema.data?.term;
  const termExtra: Option[] = [
    ...(current ? [{ value: current.code, label: current.label || current.code }] : []),
    ...(portalTerms.data?.terms ?? []).map((code) => ({ value: code, label: code })),
    ...Object.values(links.data ?? {}).map((code) => ({ value: code, label: code })),
  ];
  const majorOptions = choicesFor("MAJOR_CODE", sources);
  const termOptions = choicesFor("TERM_CODE", { ...sources, extra: termExtra });
  const yearOptions = choicesFor("YEARLEVEL_CODE", sources);

  return (
    <>
      <div className="flex items-center gap-1">
        {onShowMembers ? (
          <button
            type="button"
            onClick={() => onShowMembers(cohort)}
            title={`Show the ${cohort.memberCount} students in ${cohort.name}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            <Users size={15} aria-hidden="true" />
            <span className="tabular-nums">{cohort.memberCount}</span>
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Edit ${cohort.name}`}
          onClick={() => {
            setName(cohort.name);
            setTerm(cohort.term);
            setMajors(cohort.majors);
            setTerms(cohort.terms);
            setYearLevel(cohort.yearLevel);
            setEditing(true);
          }}
          className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#344054] hover:bg-[#f8fafc]"
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${cohort.name}`}
          onClick={() => setDeleting(true)}
          className="rounded-md border border-[#e5b7b9] bg-white p-2 text-[#a6292f] hover:bg-[#fdf3f3]"
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>

      <Modal
        open={editing}
        title="This cohort"
        description="Its name and year, and what it expects of its students in the portal's own codes. A cohort that expects nothing is judged on status alone."
        onClose={() => setEditing(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setEditing(false)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <label className="block text-sm font-semibold text-[#344054]">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Foundation Year"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
            </label>
            <label className="block text-sm font-semibold text-[#344054]">
              Year
              <input
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="2026-27"
                className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
              />
            </label>
          </div>

          <CodesField
            label="Majors the cohort expects"
            hint="MAJOR_CODE, as the portal filters by it. More than one when the cohort spans them."
            values={majors}
            options={majorOptions}
            placeholder="MATH, PHYS"
            noun="major"
            onChange={setMajors}
          />
          <CodesField
            label="Portal terms the cohort spans"
            hint="TERM_CODE — both semesters of the year, usually."
            values={terms}
            options={termOptions}
            placeholder="262710, 262720"
            noun="term"
            onChange={setTerms}
          />
          <CodesField
            label="Year level the cohort expects"
            hint="YEARLEVEL_CODE — one, or none."
            values={yearLevel ? [yearLevel] : []}
            options={yearOptions}
            placeholder="L1"
            noun="year level"
            single
            onChange={(next) => setYearLevel(next[0] ?? "")}
          />
          <p className="text-xs text-[#98a2b3]">
            Codes come from the portal&apos;s tables as the extension read them, from the pulls this browser holds, and
            from the ones the department has always used. A code not listed can be added under its field.
          </p>
          {save.error ? (
            <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
              {(save.error as Error).message}
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleting}
        title="Delete this cohort?"
        description={`${cohort.name}, its ${cohort.memberCount} member(s) and its ${cohort.scopeCount} block(s) will be removed, in every semester. The students themselves stay — they simply belong to no cohort. This cannot be undone.`}
        confirmLabel="Delete cohort"
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

/**
 * Portal codes, chosen from a list — never typed into the list itself. What is kept is
 * the code, never the label. A code nobody has listed yet can be added underneath, and
 * from then on it is one of the choices.
 */
export function CodesField({
  label,
  hint,
  values,
  options,
  placeholder,
  noun,
  single = false,
  onChange,
}: {
  label: string;
  hint?: string;
  values: string[];
  options: Option[];
  placeholder: string;
  noun: string;
  single?: boolean;
  onChange: (values: string[]) => void;
}) {
  const [other, setOther] = useState("");
  const [adding, setAdding] = useState(false);
  // A value the list does not carry — saved on a day it was not known — is still offered,
  // so a saved cohort never shows a blank where its own expectation should be.
  const offered = [...options];
  for (const value of values) {
    if (!offered.some((option) => option.value === value)) offered.push({ value, label: value });
  }
  const add = () => {
    const code = other.trim().toUpperCase();
    if (!code) return;
    onChange(single ? [code] : values.includes(code) ? values : [...values, code]);
    setOther("");
    setAdding(false);
  };
  return (
    <div className="block text-sm font-semibold text-[#344054]">
      {label}
      {hint ? <span className="block text-xs font-normal text-[#98a2b3]">{hint}</span> : null}
      <div className="mt-1.5">
        <SelectMenu
          label={label}
          value={single ? (values[0] ?? "") : values.join("\n")}
          multiple={!single}
          itemNoun={noun}
          placeholder={single ? "None" : `Choose ${noun}s…`}
          searchable={offered.length > 12}
          onChange={(next) => onChange(single ? (next ? [next] : []) : next.split("\n").filter(Boolean))}
          options={single ? [{ value: "", label: "None" }, ...offered] : offered}
        />
      </div>
      {adding ? (
        <div className="mt-1.5 flex items-center gap-2">
          <input
            aria-label={`Add a ${noun} code`}
            autoFocus
            value={other}
            onChange={(event) => setOther(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
              if (event.key === "Escape") setAdding(false);
            }}
            placeholder={placeholder}
            className="block w-40 rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-normal"
          />
          <button type="button" onClick={add} disabled={!other.trim()} className="text-xs font-semibold text-[#1f4e79] disabled:opacity-50">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-xs font-semibold text-[#667085]">
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-normal text-[#667085] hover:text-[#1f4e79]"
        >
          <Plus size={12} aria-hidden="true" /> A {noun} code not listed
        </button>
      )}
    </div>
  );
}
