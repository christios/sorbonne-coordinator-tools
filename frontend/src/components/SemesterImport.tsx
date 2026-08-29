import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileSpreadsheet, Loader2 } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { TimetableTerm, importTimetableTerm } from "@/services/timetables";

/**
 * Creating a semester from the registrar's activity-list export.
 *
 * The export alone: the student lists that used to come with it are gone, because who is
 * in which group is this application's own knowledge and reaches students through Publish.
 * A semester therefore arrives with nobody on it — define its blocks in Groups & CRNs,
 * place the cohort, then publish.
 *
 * It is a dialog because it is a name and a file: the full screen it used to take was a
 * page-sized way to ask two questions, and it hid the list you were adding to. The result
 * stays in the dialog rather than vanishing on success, since what a semester arrived
 * holding — and that nobody is on it yet — is the part worth reading.
 */
export function SemesterImport({
  host,
  open,
  onClose,
}: {
  host: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [timetable, setTimetable] = useState<File | null>(null);
  const [imported, setImported] = useState<TimetableTerm | null>(null);

  const importMutation = useMutation({
    mutationFn: () => importTimetableTerm({ name: name.trim(), timetable: timetable as File }),
    onSuccess: (term) => {
      setImported(term);
      setTimetable(null);
      queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });
    },
  });

  const busy = importMutation.isPending;
  const canImport = name.trim().length > 0 && timetable !== null && !busy;
  const error = importMutation.error?.message ?? null;

  const close = () => {
    setName("");
    setTimetable(null);
    setImported(null);
    importMutation.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Import a timetable"
      description="The registrar's activity-list export. Importing a semester name that already exists replaces its timetable."
      onClose={close}
      footer={
        imported ? (
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white hover:bg-[#183f63]"
          >
            Done
          </button>
        ) : (
          <>
            <button type="button" onClick={close} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!canImport}
              onClick={() => importMutation.mutate()}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet size={16} aria-hidden="true" />
              )}
              Import to Student Hub
            </button>
          </>
        )
      }
    >
      {imported ? (
        <div className="rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={17} aria-hidden="true" />
            {imported.name} uploaded
          </p>
          <p className="mt-1 leading-6">
            {imported.courseCount} courses and {imported.sessionCount} sessions, with{" "}
            {imported.studentCount} student(s) on it. Give its blocks their groups in Groups &amp;
            CRNs, place the cohort, then publish — students see nothing until you do.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-[#344054]">
            Semester name
            <input
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="Physics & Maths — First Year, Semester 1"
              className="mt-1.5 w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2.5 text-sm font-normal text-[#1f2937] outline-none focus:border-[#1f4e79] focus:ring-3 focus:ring-[#dceaf6]"
            />
          </label>

          <label className="block text-sm font-semibold text-[#344054]">
            Timetable export
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(event) => setTimetable(event.target.files?.[0] ?? null)}
              className="mt-1.5 w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2 text-sm font-normal text-[#1f2937] file:mr-3 file:rounded file:border-0 file:bg-[#eaf1f8] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#1f4e79]"
            />
            <span className="mt-1 block text-xs font-normal text-[#667085]">
              {timetable ? timetable.name : ".xls or .xlsx from the registrar"}
            </span>
          </label>

          <p className="text-sm leading-6 text-[#667085]">
            It arrives with nobody on it: define the blocks in Groups &amp; CRNs, place the cohort,
            then publish.
            {host ? (
              <>
                {" "}
                <a
                  href={`https://${host}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-baseline gap-1 font-semibold text-[#1f4e79] hover:underline"
                >
                  {host} <ExternalLink size={13} aria-hidden="true" />
                </a>
              </>
            ) : null}
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
