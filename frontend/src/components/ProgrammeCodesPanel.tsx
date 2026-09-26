import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { useState } from "react";

import { type ProgrammeCode, fetchProgrammeCodes, removeProgrammeCode, setProgrammeCode } from "@/services/programmeCodes";

/**
 * Which programme codes are the same students, for the whole department.
 *
 * Admissions recoded L2's Mathematics from MATH to MATS in September 2026, and every row,
 * cohort and check written in MATH stopped matching the students who now carry MATS. One
 * line here — MATS means MATH — puts that right everywhere at once, instead of row by row.
 */
export function ProgrammeCodesPanel({ canChange }: { canChange: boolean }) {
  const client = useQueryClient();
  const codes = useQuery({ queryKey: ["programme-codes"], queryFn: fetchProgrammeCodes, retry: false });
  const [code, setCode] = useState("");
  const [meant, setMeant] = useState("");
  const settled = (next: ProgrammeCode[]) => client.setQueryData(["programme-codes"], next);
  const add = useMutation({
    mutationFn: () => setProgrammeCode(code.trim(), meant.trim()),
    onSuccess: (next) => {
      settled(next);
      setCode("");
      setMeant("");
    },
  });
  const remove = useMutation({ mutationFn: removeProgrammeCode, onSuccess: settled });
  const field = "w-28 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm uppercase placeholder:normal-case";

  return (
    <div>
      {codes.isLoading ? <p className="text-sm text-[#667085]">Reading the list…</p> : null}
      {codes.data && codes.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-center text-sm text-[#667085]">
          No codes are treated as the same yet.
        </p>
      ) : null}
      {codes.data?.length ? (
        <ul aria-label="Programme codes" className="divide-y divide-[#eef1f5] rounded-lg border border-[#d9dee7] bg-white">
          {codes.data.map((row) => (
            <li key={row.code} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="font-semibold tabular-nums text-[#171717]">{row.code}</span>
              <span className="inline-flex items-center gap-1 text-xs text-[#98a2b3]">
                means <ArrowRight size={12} aria-hidden="true" />
              </span>
              <span className="font-semibold tabular-nums text-[#171717]">{row.sameAs}</span>
              <span className="ml-auto text-xs text-[#98a2b3]">
                {[row.createdBy, row.createdAt.slice(0, 10)].filter(Boolean).join(" · ")}
              </span>
              {canChange ? (
                <button
                  type="button"
                  aria-label={`Stop treating ${row.code} as ${row.sameAs}`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(row.code)}
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
            if (code.trim() && meant.trim()) add.mutate();
          }}
        >
          <input aria-label="The new code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="e.g. MATS" className={field} />
          <span className="text-sm text-[#667085]">means</span>
          <input aria-label="The code it means" value={meant} onChange={(event) => setMeant(event.target.value)} placeholder="e.g. MATH" className={field} />
          <button
            type="submit"
            disabled={!code.trim() || !meant.trim() || add.isPending}
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
