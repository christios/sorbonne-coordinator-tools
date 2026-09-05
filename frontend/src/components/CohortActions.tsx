import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchSchema, type PortalField } from "@/services/scenRosters";
import { type Cohort, deleteCohort, updateCohort } from "@/services/studentDatabase";

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
  onShowMembers: (cohort: Cohort) => void;
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

  const fields = schema.data?.fields ?? [];
  const optionsOf = (key: string) => fields.find((field) => field.key.toUpperCase() === key)?.options ?? [];
  // The term the extension is set to is always offered, even before the portal's list is read.
  const termOptions = [...optionsOf("TERM_CODE")];
  const current = schema.data?.term;
  if (current && !termOptions.some((option) => option.value === current.code)) {
    termOptions.unshift({ value: current.code, label: current.label || current.code });
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onShowMembers(cohort)}
          title={`Show the ${cohort.memberCount} students in ${cohort.name}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          <Users size={15} aria-hidden="true" />
          <span className="tabular-nums">{cohort.memberCount}</span>
        </button>
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
            options={optionsOf("MAJOR_CODE")}
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
            options={optionsOf("YEARLEVEL_CODE")}
            placeholder="L1"
            noun="year level"
            single
            onChange={(next) => setYearLevel(next[0] ?? "")}
          />
          {schema.data && schema.data.source !== "portal" ? (
            <p className="text-xs text-[#98a2b3]">
              The portal&apos;s code tables have not been read yet, so codes are typed rather than chosen. Open the portal
              once with the extension installed and they will be offered.
            </p>
          ) : null}
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
 * Portal codes, chosen from the portal's own table when the extension has read it, and
 * typed when it has not. Either way what is kept is the code, never the label.
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
  options: PortalField["options"];
  placeholder: string;
  noun: string;
  single?: boolean;
  onChange: (values: string[]) => void;
}) {
  // A value the table does not list — typed on a day it was not read — is still offered,
  // so a saved cohort never shows a blank where its own expectation should be.
  const offered = [...options];
  for (const value of values) {
    if (!offered.some((option) => option.value === value)) offered.push({ value, label: value });
  }
  return (
    <div className="block text-sm font-semibold text-[#344054]">
      {label}
      {hint ? <span className="block text-xs font-normal text-[#98a2b3]">{hint}</span> : null}
      <div className="mt-1.5">
        {options.length ? (
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
        ) : (
          <input
            aria-label={label}
            value={values.join(", ")}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
                  .slice(0, single ? 1 : undefined),
              )
            }
            placeholder={placeholder}
            className="block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        )}
      </div>
    </div>
  );
}
