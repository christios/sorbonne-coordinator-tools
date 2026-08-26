import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import {
  type Cohort,
  type PlacementReport,
  assignStudents,
  fetchCatalogue,
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
  /** The cohort every selected student belongs to — a block is only open to its own. */
  cohort: Cohort;
  studentIds: string[];
  onClose: () => void;
  /** `removed` when the group was "take them out", so the report can say so. */
  onPlaced: (report: PlacementReport & { removed: boolean }) => void;
}) {
  const [termId, setTermId] = useState("");
  const [scopeId, setScopeId] = useState("");
  const [groupId, setGroupId] = useState("");

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  const catalogue = useQuery({
    queryKey: ["catalogue", cohort.id, termId],
    queryFn: () => fetchCatalogue(cohort.id, termId),
    enabled: open && Boolean(termId),
  });

  const scopes = catalogue.data?.scopes ?? [];
  const scope = scopes.find((candidate) => candidate.id === scopeId) ?? null;

  // A semester chosen in another screen means nothing here, so the block and group are
  // dropped whenever the semester changes rather than pointing at the old one.
  useEffect(() => {
    setScopeId("");
    setGroupId("");
  }, [termId]);
  useEffect(() => setGroupId(""), [scopeId]);

  const place = useMutation({
    mutationFn: () => assignStudents(scopeId, studentIds, groupId === OUT ? null : groupId),
    onSuccess: (report) => onPlaced({ ...report, removed: groupId === OUT }),
  });

  const ready = Boolean(scopeId && groupId) && studentIds.length > 0;

  return (
    <Modal
      open={open}
      title={`Place ${studentIds.length} student${studentIds.length === 1 ? "" : "s"} in a block`}
      description={`${cohort.name} · a student holds one group per block, so this replaces whatever they hold now.`}
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
            {groupId === OUT ? "Take them out" : `Place ${studentIds.length}`}
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

        <SelectMenu
          label="Block"
          value={scopeId}
          placeholder={termId ? "Which block…" : "Choose a semester first"}
          options={scopes.map((candidate) => ({
            value: candidate.id,
            label: candidate.name ? `${candidate.code} · ${candidate.name}` : candidate.code,
            badge: `${candidate.groups.length} group${candidate.groups.length === 1 ? "" : "s"}`,
          }))}
          onChange={setScopeId}
          disabled={!termId || catalogue.isLoading}
        />

        <SelectMenu
          label="Group"
          value={groupId}
          placeholder={scopeId ? "Which group…" : "Choose a block first"}
          options={[
            ...(scope?.groups ?? []).map((group) => ({
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
            ...(scopeId ? [{ value: OUT, label: "Take them out of this block" }] : []),
          ]}
          onChange={setGroupId}
          disabled={!scopeId}
        />

        {termId && !catalogue.isLoading && scopes.length === 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              {cohort.name} has no blocks in this semester yet. Define them in Groups &amp; CRNs, or
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
