import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { createCohort, type Cohort } from "@/services/studentDatabase";

/**
 * Making a cohort, on the page named after them.
 *
 * Until now the only way to create one anywhere in this application was an entry inside
 * the dropdown that moved students, which meant a cohort could not be made without a
 * selection to put in it — you could not set up next year's L1 in August and fill it in
 * September. The two are separate acts and this is the one that does not need students.
 */
export function NewCohort({ onCreated }: { onCreated?: (cohort: Cohort) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");

  const create = useMutation({
    mutationFn: () => createCohort({ name: name.trim(), term: term.trim() }),
    onSuccess: (cohort) => {
      setOpen(false);
      setName("");
      setTerm("");
      client.invalidateQueries({ queryKey: ["cohorts"] });
      onCreated?.(cohort);
    },
  });

  const field = "mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <Plus size={15} aria-hidden="true" /> New cohort
      </button>

      <Modal
        open={open}
        title="New cohort"
        description="A cohort is a population for a year, not a semester — its sets of groups are defined per semester, on the Group schema page."
        onClose={() => setOpen(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {create.isPending ? "Creating…" : "Create"}
            </button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-[#344054]">
            Name
            <input value={name} autoFocus onChange={(event) => setName(event.target.value)} placeholder="Foundation Year" className={field} />
          </label>
          <label className="block text-sm font-semibold text-[#344054]">
            Year
            <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="2026-27" className={field} />
          </label>
        </div>
        <p className="mt-3 text-xs text-[#98a2b3]">
          It starts empty. Students join it from the Students table, and what it expects of them — the majors, the
          portal terms, the year level — is said afterwards with the pencil beside its name.
        </p>
        {create.error ? (
          <p role="alert" className="mt-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {(create.error as Error).message}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
