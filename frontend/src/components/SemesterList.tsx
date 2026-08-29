import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SemesterImport } from "@/components/SemesterImport";
import { SemesterPublish } from "@/components/SemesterPublish";
import { SemesterUpdate } from "@/components/SemesterUpdate";
import {
  TimetableTerm,
  deleteTimetableTerm,
  fetchTimetableTerms,
  setTimetableTermPublished,
} from "@/services/timetables";

/**
 * Every semester the Student Hub holds, and whether students can see it yet.
 *
 * The two ways a semester gets its timetable both start here, because both are things you
 * do *to* the list: importing one at the start of term, and updating one when the
 * registrar re-issues the export. Each opens a screen of its own rather than crowding the
 * table, since neither is an everyday action.
 */
export function SemesterList({ host }: { host: string | null }) {
  const queryClient = useQueryClient();
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms });
  const [pendingDelete, setPendingDelete] = useState<TimetableTerm | null>(null);
  const [updating, setUpdating] = useState<TimetableTerm | null>(null);
  const [importing, setImporting] = useState(false);
  const [publishing, setPublishing] = useState<TimetableTerm | null>(null);
  // An update starts as a dialog over this list and takes the screen once it has a diff.
  const [updateStage, setUpdateStage] = useState<"pick" | "review">("pick");

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });
  const publishMutation = useMutation({
    mutationFn: ({ term, published }: { term: TimetableTerm; published: boolean }) =>
      setTimetableTermPublished(term.id, published),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (term: TimetableTerm) => deleteTimetableTerm(term.id),
    onSuccess: refresh,
  });

  const error = publishMutation.error?.message ?? deleteMutation.error?.message ?? null;

  if (publishing) {
    const current = (terms.data ?? []).find((term) => term.id === publishing.id) ?? publishing;
    return <SemesterPublish term={current} onBack={() => setPublishing(null)} />;
  }

  const underUpdate = updating
    ? (terms.data ?? []).find((term) => term.id === updating.id) ?? updating
    : null;

  /*
   * The list stays put while a file is being picked, and stands aside for a diff.
   *
   * It hides rather than the update being returned early, because an early return would
   * mount a second SemesterUpdate the moment the stage changed — and the first one, the
   * one holding the diff, would be thrown away in the same breath.
   */
  const reviewing = underUpdate !== null && updateStage === "review";

  return (
    <>
      {error ? (
        <p role="alert" className="mb-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}

            {reviewing ? null : (
            <section className="rounded-lg border border-[#d9dee7] bg-white">
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] px-6 py-4">
                <div className="flex items-center gap-2">
                  <CalendarDays size={18} className="text-[#1f4e79]" aria-hidden="true" />
                  <h2 className="text-base font-semibold text-[#171717]">Semesters on the Student Hub</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setImporting(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"
                >
                  <FileSpreadsheet size={16} aria-hidden="true" />
                  Import a timetable
                </button>
              </header>

              {terms.isLoading ? (
                <p className="px-6 py-8 text-sm text-[#667085]">Loading semesters…</p>
              ) : terms.error ? (
                <p role="alert" className="px-6 py-8 text-sm text-[#a6292f]">
                  {(terms.error as Error).message}
                </p>
              ) : (terms.data ?? []).length === 0 ? (
                <p className="px-6 py-8 text-sm text-[#667085]">
                  Nothing uploaded yet. Import a timetable to give students a semester.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[46rem] text-left text-sm">
                    <thead className="text-xs uppercase tracking-wide text-[#667085]">
                      <tr>
                        <th scope="col" className="px-6 py-3 font-semibold">Semester</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Courses</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Sessions</th>
                        <th scope="col" className="px-4 py-3 text-right font-semibold">Students</th>
                        <th scope="col" className="px-4 py-3 font-semibold">Students can see it</th>
                        <th scope="col" className="px-6 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {(terms.data ?? []).map((term) => (
                        <tr key={term.id} className="border-t border-[#e4e8ef]">
                          <td className="px-6 py-4">
                            <span className="font-semibold text-[#171717]">{term.name}</span>
                            <span className="mt-0.5 block text-xs text-[#667085]">{term.timetableFilename}</span>
                          </td>
                          <td className="px-4 py-4 text-right tabular-nums">{term.courseCount}</td>
                          <td className="px-4 py-4 text-right tabular-nums">{term.sessionCount}</td>
                          <td className="px-4 py-4 text-right tabular-nums">{term.studentCount}</td>
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() => publishMutation.mutate({ term, published: !term.isPublished })}
                              disabled={publishMutation.isPending}
                              className={
                                term.isPublished
                                  ? "rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"
                                  : "rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                              }
                            >
                              {term.isPublished ? "Published" : "Hidden"}
                            </button>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setPublishing(term)}
                                className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                              >
                                Publish
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setUpdateStage("pick");
                                  setUpdating(term);
                                }}
                                className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                              >
                                Update timetable
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingDelete(term)}
                                className="rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            )}

      <SemesterImport host={host} open={importing} onClose={() => setImporting(false)} />

      {underUpdate ? (
        <SemesterUpdate
          term={underUpdate}
          onBack={() => setUpdating(null)}
          onStage={setUpdateStage}
        />
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this semester?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its ${pendingDelete.sessionCount} sessions will be removed from the Student Hub. Students looking it up will stop finding their timetable. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete semester"
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </>
  );
}
