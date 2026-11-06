import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { fetchSemesterShortNames, setSemesterShortName } from "@/services/portalLists";

/**
 * A semester's short name — S1, S2, Summer — typed where the semester is set up.
 *
 * Saved when the box is left, like the portal term beside it. Coordinator Tools' own name
 * for the semester: the Student Hub's semester is never written to. The menus show it as a
 * square tag in front of the semester's name.
 */
export function SemesterShortName({ termId, label = "Short name" }: { termId: string; label?: string }) {
  const client = useQueryClient();
  const names = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false });
  const saved = names.data?.[termId] ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  const save = useMutation({
    mutationFn: (short: string) => setSemesterShortName(termId, short),
    onSuccess: () => client.invalidateQueries({ queryKey: ["semester-short-names"] }),
  });

  return (
    <input
      aria-label={label}
      value={draft}
      maxLength={12}
      placeholder="S1"
      disabled={names.isLoading}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== saved) save.mutate(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      title={save.error ? (save.error as Error).message : "A few letters the menus show in front of the semester's name"}
      className={`w-20 rounded-md border px-2 py-1.5 text-sm ${save.error ? "border-[#e5b7b9]" : "border-[#cbd5e1]"}`}
    />
  );
}
