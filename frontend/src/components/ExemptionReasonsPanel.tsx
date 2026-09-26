import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";

import { type ExemptionReason, addExemptionReason, fetchExemptionReasons, removeExemptionReason } from "@/services/exemptionReasons";

/**
 * The reasons offered when a student is exempted from a course — "LEA track", "Repeater".
 *
 * Picked rather than typed, so the same words are used every time and the Students and
 * Cohorts tables can be filtered on them. An exemption keeps the words it was given:
 * taking a reason off the list changes nothing already recorded.
 */
export function ExemptionReasonsPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const reasons = useQuery({ queryKey: ["exemption-reasons"], queryFn: fetchExemptionReasons, retry: false });
  const [label, setLabel] = useState("");
  const settled = (next: ExemptionReason[]) => client.setQueryData(["exemption-reasons"], next);
  const add = useMutation({
    mutationFn: () => addExemptionReason(label.trim()),
    onSuccess: (next) => {
      settled(next);
      setLabel("");
    },
  });
  const remove = useMutation({ mutationFn: removeExemptionReason, onSuccess: settled });

  return (
    <div>
      {reasons.isLoading ? <p className="text-sm text-[#667085]">Reading the list…</p> : null}
      {reasons.data && reasons.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-center text-sm text-[#667085]">
          No reasons yet. An exemption can still be given without one.
        </p>
      ) : null}
      {reasons.data?.length ? (
        <ul aria-label="Exemption reasons" className="divide-y divide-[#eef1f5] rounded-lg border border-[#d9dee7] bg-white">
          {reasons.data.map((row) => (
            <li key={row.label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-semibold text-[#171717]">{row.label}</span>
              <span className="ml-auto text-xs text-[#98a2b3]">
                {[row.createdBy, row.createdAt.slice(0, 10)].filter(Boolean).join(" · ")}
              </span>
              {canChange ? (
                <button
                  type="button"
                  aria-label={`Take ${row.label} off the list`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(row.label)}
                  className="rounded p-1 text-[#c8d0da] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canChange ? (
        <form
          className="mt-4 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (label.trim()) add.mutate();
          }}
        >
          <input
            aria-label="A reason"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. LEA track"
            className="w-56 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!label.trim() || add.isPending}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {add.isPending ? "Saving…" : "Add"}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-xs text-[#98a2b3]">Only an administrator can change this list.</p>
      )}
      {add.error || remove.error ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">
          {((add.error ?? remove.error) as Error).message}
        </p>
      ) : null}
    </div>
  );
}
