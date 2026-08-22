import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, Plus, Users } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenLoading } from "@/components/ScreenLoading";
import { createCohort, deleteCohort, fetchCohorts, type Cohort } from "@/services/studentDatabase";

/**
 * Cohorts are whatever a coordinator needs to assemble — a year group in a semester, a
 * language pool that mixes them, a set of repeaters. Nothing here is a fixed category,
 * so a new kind of cohort needs no code.
 */
export function CohortList({ onOpen }: { onOpen: (cohort: Cohort) => void }) {
  const client = useQueryClient();
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts });
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Cohort | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ["cohorts"] });
  const create = useMutation({
    mutationFn: () => createCohort({ name: name.trim(), term: term.trim() }),
    onSuccess: (cohort) => {
      setName("");
      setTerm("");
      refresh();
      onOpen(cohort);
    },
  });
  const remove = useMutation({ mutationFn: (cohort: Cohort) => deleteCohort(cohort.id), onSuccess: refresh });

  if (cohorts.isLoading) return <ScreenLoading label="Loading cohorts…" />;

  const error = cohorts.error?.message ?? create.error?.message ?? remove.error?.message ?? null;
  const rows = cohorts.data ?? [];

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-[#d9dee7] bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <label className="text-sm font-semibold text-[#344054]">
          New cohort
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Foundation Year"
            className="mt-1 block w-64 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="text-sm font-semibold text-[#344054]">
          Term
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="S1 2026-27"
            className="mt-1 block w-44 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Plus size={16} aria-hidden="true" /> Create
        </button>
      </form>

      <section className="mt-5 rounded-lg border border-[#d9dee7] bg-white">
        {rows.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-[#667085]">
            No cohorts yet. Create one, then fill its groups from a workbook.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-[#667085]">
              <tr>
                <th scope="col" className="px-6 py-3 font-semibold">Cohort</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Students</th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">Blocks</th>
                <th scope="col" className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((cohort) => (
                <tr key={cohort.id} className="border-t border-[#e4e8ef]">
                  <td className="px-6 py-4">
                    <button
                      type="button"
                      onClick={() => onOpen(cohort)}
                      className="text-left font-semibold text-[#171717] hover:text-[#1f4e79]"
                    >
                      {cohort.name}
                    </button>
                    <span className="mt-0.5 block text-xs text-[#667085]">{cohort.term || "no term set"}</span>
                  </td>
                  <td className="px-4 py-4 text-right tabular-nums">{cohort.memberCount}</td>
                  <td className="px-4 py-4 text-right tabular-nums">{cohort.scopeCount}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => onOpen(cohort)}
                      className="mr-2 inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f8fafc]"
                    >
                      <Layers size={16} aria-hidden="true" /> Groups
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(cohort)}
                      className="rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="mt-3 flex items-center gap-2 text-sm text-[#667085]">
        <Users size={15} aria-hidden="true" />
        Members are student ids only. Names come from the registrar extension and stay in this tab.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this cohort?"
        description={
          pendingDelete
            ? `${pendingDelete.name}, its ${pendingDelete.memberCount} members and its groups will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete cohort"
        onConfirm={() => {
          if (pendingDelete) remove.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
