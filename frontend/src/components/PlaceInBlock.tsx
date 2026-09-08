import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import {
  type Cohort,
  type PlacementReport,
  assignStudents,
  fetchCatalogue,
  groupIsRetired,
} from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/** Taking a student out of a block is a real choice, so it is an option and not a blank. */
const OUT = "__out__";

/**
 * Putting a selection of students into one group of one block.
 *
 * Until this existed a workbook was the only way anybody reached a group, which made
 * "this student moved to TD 4" a spreadsheet edit and a re-upload. A block belongs to a
 * cohort and a semester, so both are chosen here rather than guessed: the same code "TD"
 * means different groups in different semesters, and picking the wrong one silently gives
 * a student the other semester's timetable.
 */
export function PlaceInBlock({
  open,
  cohort,
  studentIds,
  onClose,
  onPlaced,
}: {
  open: boolean;
  /**
   * The cohort every selected student belongs to.
   *
   * A cohort's own set takes only its own members. A set marked open to every cohort — the
   * languages — takes anybody, which is why they are offered here even though they live on
   * somebody else's row.
   */
  cohort: Cohort;
  studentIds: string[];
  onClose: () => void;
  /** `removed` when the group was "take them out", so the report can say so. */
  onPlaced: (report: PlacementReport & { removed: boolean }) => void;
}) {
  const [termId, setTermId] = useState("");
  /*
   * One row per set, because a student arriving mid-term needs a TD and a CM and a
   * language, and three passes through a dialog that forgets everything each time is how
   * one of them goes missing. The server already takes one set at a time and already says
   * whom it turned away, so this is N of the call it has always made.
   */
  const [rows, setRows] = useState<{ scopeId: string; groupId: string }[]>([{ scopeId: "", groupId: "" }]);
  const setRow = (index: number, patch: Partial<{ scopeId: string; groupId: string }>) =>
    setRows((held) => held.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  /*
   * With the sets open to every cohort, under a key of their own.
   *
   * Languages live on one cohort's row and are used by all of them, so asking only for
   * this cohort's own sets meant a language group could never be chosen here — the set
   * simply was not in the list. The key carries "with-shared" because WorkbookTools and
   * AddFromPortal read the same cohort and semester WITHOUT them: one key for two shapes
   * lets whichever landed first answer for both, and the languages would come and go
   * depending on what else had been open.
   */
  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId, "with-shared"],
    queryFn: () => fetchCatalogue(cohort.id, termId, true),
    enabled: open && Boolean(termId),
  });

  const scopes = catalogue.data?.scopes ?? [];
  const scopeOf = (id: string) => scopes.find((candidate) => candidate.id === id) ?? null;

  // A semester chosen in another screen means nothing here, so every row is dropped when
  // the semester changes rather than pointing at the old one's sets.
  useEffect(() => setRows([{ scopeId: "", groupId: "" }]), [termId]);

  const chosen = rows.filter((row) => row.scopeId && row.groupId);

  const place = useMutation({
    /*
     * One request per set, in the order they were chosen, and each one is a write. A
     * failure halfway leaves the earlier sets already written, so what landed is named
     * rather than swallowed — otherwise the obvious retry places them twice over.
     */
    mutationFn: async () => {
      let assigned = 0;
      const skipped = new Set<string>();
      const written: string[] = [];
      for (const row of chosen) {
        const code = scopeOf(row.scopeId)?.code ?? "the set";
        try {
          const report = await assignStudents(row.scopeId, studentIds, row.groupId === OUT ? null : row.groupId);
          assigned += report.assigned;
          report.skipped.forEach((id) => skipped.add(id));
          written.push(code);
        } catch (error) {
          const reason = error instanceof Error ? error.message : "That could not be completed.";
          throw new Error(written.length ? `${written.join(", ")} written. ${code} failed: ${reason}` : reason);
        }
      }
      return { assigned, skipped: [...skipped], removed: chosen.every((row) => row.groupId === OUT) };
    },
    onSuccess: (report) => onPlaced(report),
  });

  const ready = chosen.length === rows.length && chosen.length > 0 && studentIds.length > 0;

  return (
    <Modal
      open={open}
      title={`Place ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} in a group`}
      description={`${cohort.name} · a student holds one group per set, so this replaces whatever they hold now.`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!ready || place.isPending}
            onClick={() => place.mutate()}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {place.isPending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            {chosen.length && chosen.every((row) => row.groupId === OUT) ? "Take them out" : `Place ${studentIds.length}`}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <SelectMenu
          label="Semester"
          value={termId}
          placeholder="Which semester…"
          options={(terms.data ?? []).map((term) => ({ value: term.id, label: term.name }))}
          onChange={setTermId}
        />

        {rows.map((row, index) => {
          const scope = scopeOf(row.scopeId);
          // A set already spoken for by another row is not offered again: two rows on one
          // set would be two writes to the same place, and the second would win silently.
          const taken = new Set(rows.filter((_, at) => at !== index).map((other) => other.scopeId));
          // Numbered only once there is something to number: one set is "Block", not "Block 1".
          const nth = rows.length > 1 ? ` ${index + 1}` : "";
          return (
            <div key={index} className="space-y-4 border-t border-[#eef1f5] pt-4 first:border-0 first:pt-0">
              <SelectMenu
                label={`Block${nth}`}
                value={row.scopeId}
                placeholder={termId ? "Which set…" : "Choose a semester first"}
                options={scopes
                  .filter((candidate) => !taken.has(candidate.id))
                  .map((candidate) => ({
                    value: candidate.id,
                    label: candidate.name ? `${candidate.code} · ${candidate.name}` : candidate.code,
                    badge: `${candidate.groups.length} group${candidate.groups.length === 1 ? "" : "s"}`,
                  }))}
                onChange={(value) => setRow(index, { scopeId: value, groupId: "" })}
                disabled={!termId || catalogue.isLoading}
              />

              <SelectMenu
                label={`Group${nth}`}
                value={row.groupId}
                placeholder={row.scopeId ? "Which group…" : "Choose a set first"}
                options={[
                  // A group whose every section is retired teaches nobody; offering it is
                  // how somebody gets placed into a set that has stopped running.
                  ...(scope?.groups ?? []).filter((group) => !groupIsRetired(group)).map((group) => ({
                    value: group.id,
                    label: `Group ${group.label}`,
                    // An empty group says nothing rather than a bare "0", which reads as a label.
                    badge: group.capacity
                      ? `${group.assigned}/${group.capacity}`
                      : group.assigned
                        ? `${group.assigned} placed`
                        : undefined,
                    badgeTone: group.capacity && group.assigned >= group.capacity ? ("muted" as const) : undefined,
                  })),
                  ...(row.scopeId ? [{ value: OUT, label: "Take them out of this set" }] : []),
                ]}
                onChange={(value) => setRow(index, { groupId: value })}
                disabled={!row.scopeId}
              />

              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((held) => held.filter((_, at) => at !== index))}
                  className="text-sm font-semibold text-[#a6292f] hover:underline"
                >
                  Remove this set
                </button>
              ) : null}
            </div>
          );
        })}

        {termId && rows.length < scopes.length ? (
          <button
            type="button"
            onClick={() => setRows((held) => [...held, { scopeId: "", groupId: "" }])}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            <Plus size={15} aria-hidden="true" /> Another set
          </button>
        ) : null}

        {termId && !catalogue.isLoading && scopes.length === 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {cohort.name} has no sets in this semester yet. Define them on Group schema, or
              upload the group workbook, before placing anybody.
            </span>
          </p>
        ) : null}

        {place.error ? (
          <p role="alert" className="rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {(place.error as Error).message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
