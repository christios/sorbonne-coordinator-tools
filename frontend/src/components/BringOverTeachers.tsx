import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SemesterTag } from "@/components/SemesterTag";
import { activateTeachers, fetchActiveTeachers, fetchSemesterShortNames, fetchTermLinks } from "@/services/portalLists";

/**
 * Who carries on into a semester: teachers active in another one, ticked and brought over.
 *
 * Semester 2 starts with nobody active, rather than with a copy of Semester 1 to prune — but
 * most of the department teaches both, so its list is mostly a matter of saying who stays.
 * Each teacher is still one record; bringing them over makes them active here too, with their
 * links to the portal and the part-time database and their time sheets as they were.
 */
export function BringOverTeachers({
  open,
  term,
  semesterName,
  onClose,
}: {
  open: boolean;
  /** The portal term of the semester they are brought into. */
  term: string;
  semesterName: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const everyone = useQuery({ queryKey: ["active-teachers", ""], queryFn: () => fetchActiveTeachers(), enabled: open });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false, enabled: open });
  const shortNames = useQuery({ queryKey: ["semester-short-names"], queryFn: fetchSemesterShortNames, retry: false, enabled: open });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    setPicked(new Set());
    setQuery("");
  }, [open]);

  // A portal term's short name, through the semester it is: "S1".
  const shortOf = useMemo(() => {
    const semesterOf = Object.fromEntries(Object.entries(links.data ?? {}).map(([id, code]) => [code, id]));
    return (code: string) => shortNames.data?.[semesterOf[code] ?? ""] ?? "";
  }, [links.data, shortNames.data]);

  const candidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (everyone.data ?? [])
      .filter((teacher) => !(teacher.terms ?? []).includes(term) && (teacher.terms ?? []).length > 0)
      .filter((teacher) => !needle || `${teacher.fullName} ${teacher.email}`.toLowerCase().includes(needle))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }, [everyone.data, term, query]);
  const allPicked = candidates.length > 0 && candidates.every((teacher) => picked.has(teacher.id));

  const bring = useMutation({
    mutationFn: () => activateTeachers([...picked], term),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["active-teachers"] });
      void client.invalidateQueries({ queryKey: ["teacher-matches"] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title="Active teachers settings"
      description={semesterName}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          {bring.error ? (
            <span role="alert" className="mr-auto text-sm text-[#a6292f]">
              {(bring.error as Error).message}
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={picked.size === 0 || bring.isPending || !term}
            onClick={() => bring.mutate()}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {bring.isPending ? "Bringing over…" : `Bring ${picked.size || ""} over`}
          </button>
        </div>
      }
    >
      <h3 className="text-sm font-semibold text-[#171717]">Bring over from another semester</h3>
      <p className="mb-3 mt-0.5 text-xs text-[#667085]">
        Teachers active in another semester. Those you tick are active in {semesterName} too, with their portal and
        part-time records as they are.
      </p>
      <div className="mb-3 flex items-center gap-3">
        <input
          aria-label="Search teachers"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name or e-mail"
          className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
        />
        <label className="inline-flex shrink-0 items-center gap-2 text-sm text-[#344054]">
          <input
            type="checkbox"
            checked={allPicked}
            disabled={candidates.length === 0}
            onChange={() =>
              setPicked((current) => {
                const next = new Set(current);
                for (const teacher of candidates) {
                  if (allPicked) next.delete(teacher.id);
                  else next.add(teacher.id);
                }
                return next;
              })
            }
          />
          All shown
        </label>
      </div>
      {everyone.isLoading ? (
        <p className="text-sm text-[#667085]">Reading the teachers…</p>
      ) : everyone.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(everyone.error as Error).message}</p>
      ) : candidates.length === 0 ? (
        <p className="text-sm text-[#667085]">
          {query ? "Nobody by that name." : `Every teacher active in another semester is already active in ${semesterName}.`}
        </p>
      ) : (
        <ul className="max-h-80 divide-y divide-[#eef1f5] overflow-y-auto text-sm" aria-label="Teachers to bring over">
          {candidates.map((teacher) => (
            <li key={teacher.id}>
              <label className="flex cursor-pointer items-center gap-3 px-1 py-2">
                <input
                  type="checkbox"
                  checked={picked.has(teacher.id)}
                  onChange={() =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (next.has(teacher.id)) next.delete(teacher.id);
                      else next.add(teacher.id);
                      return next;
                    })
                  }
                />
                <span className="font-semibold text-[#171717]">{teacher.fullName}</span>
                <span className="text-xs text-[#667085]">{teacher.email}</span>
                {/* Where they are active now, as the menus say a semester. */}
                <span className="ml-auto inline-flex gap-1">
                  {(teacher.terms ?? []).map((code) =>
                    shortOf(code) ? (
                      <SemesterTag key={code} short={shortOf(code)} />
                    ) : (
                      <span key={code} className="text-xs tabular-nums text-[#98a2b3]">
                        {code}
                      </span>
                    ),
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
