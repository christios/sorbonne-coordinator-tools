import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { type Cohort, deleteCohort, updateCohort } from "@/services/studentDatabase";

/**
 * Renaming a cohort, deleting one, and seeing who is in it.
 *
 * These lived on a Cohorts page of their own, which existed to list four cohorts and let
 * you click one. The list is now the dropdown beside this, so the page was a detour: the
 * three things it could actually do belong next to the cohort they act on.
 *
 * "Who is in it" is not built here either — it is the Students table filtered by cohort,
 * which it could always do. This only sets the filter.
 */
export function CohortActions({
  cohort,
  onShowMembers,
}: {
  cohort: Cohort;
  onShowMembers: (cohort: Cohort) => void;
}) {
  const client = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(cohort.name);
  const [term, setTerm] = useState(cohort.term);
  const [program, setProgram] = useState(cohort.program);
  const [yearLevel, setYearLevel] = useState(cohort.yearLevel);

  const refresh = () => client.invalidateQueries({ queryKey: ["cohorts"] });
  const rename = useMutation({
    mutationFn: () =>
      updateCohort(cohort.id, {
        name: name.trim(),
        term: term.trim(),
        notes: cohort.notes,
        program: program.trim(),
        yearLevel: yearLevel.trim(),
      }),
    onSuccess: () => {
      setRenaming(false);
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
          aria-label={`Rename ${cohort.name}`}
          onClick={() => {
            setName(cohort.name);
            setTerm(cohort.term);
            setProgram(cohort.program);
            setYearLevel(cohort.yearLevel);
            setRenaming(true);
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
        open={renaming}
        title="Rename this cohort"
        description="The year it belongs to, not the semester — a cohort keeps its people across both."
        onClose={() => setRenaming(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setRenaming(false)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || rename.isPending}
              onClick={() => rename.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              Save
            </button>
          </div>
        }
      >
        <div className="space-y-4">
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
          {/*
            * What the cohort expects, in the portal's own words. Optional: a cohort with
            * neither is judged on status alone by the Cohorts page.
            */}
          <label className="block text-sm font-semibold text-[#344054]">
            Program the cohort expects
            <input
              value={program}
              onChange={(event) => setProgram(event.target.value)}
              placeholder="Applied Mathematics and Physics — as the portal names it, or leave blank"
              className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="block text-sm font-semibold text-[#344054]">
            Year level the cohort expects
            <input
              value={yearLevel}
              onChange={(event) => setYearLevel(event.target.value)}
              placeholder="L1 — or leave blank"
              className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
            />
          </label>
          {rename.error ? (
            <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
              {(rename.error as Error).message}
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
