import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarDays, CheckCircle2, ExternalLink, Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenLoading } from "@/components/ScreenLoading";
import {
  TimetableTerm,
  deleteTimetableTerm,
  fetchTimetableStatus,
  fetchTimetableTerms,
  importTimetableTerm,
  setTimetableTermPublished,
} from "@/services/timetables";

/**
 * Timetables are stored by the SCEN Student Platform, not by this application.
 * This screen uploads the registrar export and the student list to it, and
 * controls whether students can see the result yet.
 */
export function TimetableUploader() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["timetable-status"], queryFn: fetchTimetableStatus });
  const terms = useQuery({
    queryKey: ["timetable-terms"],
    queryFn: fetchTimetableTerms,
    enabled: status.data?.configured === true,
  });

  const [name, setName] = useState("");
  const [timetable, setTimetable] = useState<File | null>(null);
  const [enrolments, setEnrolments] = useState<File[]>([]);
  const [imported, setImported] = useState<TimetableTerm | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TimetableTerm | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });

  const importMutation = useMutation({
    mutationFn: () =>
      importTimetableTerm({ name: name.trim(), timetable: timetable as File, enrolments }),
    onSuccess: (term) => {
      setImported(term);
      setTimetable(null);
      setEnrolments([]);
      refresh();
    },
  });
  const publishMutation = useMutation({
    mutationFn: ({ term, published }: { term: TimetableTerm; published: boolean }) =>
      setTimetableTermPublished(term.id, published),
    onSuccess: refresh,
  });
  const deleteMutation = useMutation({
    mutationFn: (term: TimetableTerm) => deleteTimetableTerm(term.id),
    onSuccess: refresh,
  });

  const busy = importMutation.isPending;
  const canImport = name.trim().length > 0 && timetable !== null && enrolments.length > 0 && !busy;
  const error =
    importMutation.error?.message ?? publishMutation.error?.message ?? deleteMutation.error?.message ?? null;

  if (status.isLoading) {
    return <ScreenLoading label="Checking the student platform connection…" />;
  }

  if (!status.data?.configured) {
    return (
      <div className="mx-auto max-w-[70rem] px-4 py-10 sm:px-6 lg:px-8">
        <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#171717]">
            <AlertCircle size={20} className="text-[#a6292f]" aria-hidden="true" />
            Timetable uploads are not configured
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#667085]">
            This deployment has no connection to the SCEN Student Platform. Set{" "}
            <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_URL</code> and{" "}
            <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SCEN_STUDENT_PLATFORM_TOKEN</code> in the
            application settings, then redeploy.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[70rem] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[#171717]">Upload a semester timetable</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">
              Send the registrar activity-list export and the student list to the student platform. Uploading a
              semester name that already exists replaces its timetable and enrolments.
            </p>
          </div>
          <a
            href={`https://${status.data.host}/`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            {status.data.host} <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>

        <form
          className="mt-5 grid gap-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setImported(null);
            importMutation.mutate();
          }}
        >
          <label className="md:col-span-2 text-sm font-semibold text-[#344054]">
            Semester name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Physics & Maths — First Year, Semester 1"
              className="mt-1.5 w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2.5 text-sm font-normal text-[#1f2937] outline-none focus:border-[#1f4e79] focus:ring-3 focus:ring-[#dceaf6]"
            />
          </label>

          <FilePicker
            label="Timetable export"
            hint=".xls or .xlsx from the registrar"
            accept=".xls,.xlsx"
            files={timetable ? [timetable] : []}
            onSelect={(files) => setTimetable(files[0] ?? null)}
          />
          <FilePicker
            label="Student lists"
            hint="Group templates or CRN lists — add FYS, L1, L2 and languages together"
            accept=".xlsx"
            multiple
            files={enrolments}
            onSelect={setEnrolments}
          />

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={!canImport}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {busy ? (
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
              ) : (
                <Upload size={17} aria-hidden="true" />
              )}
              Upload to student platform
            </button>
          </div>
        </form>

        {error ? (
          <p role="alert" className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">
            {error}
          </p>
        ) : null}

        {imported ? (
          <div className="mt-4 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={17} aria-hidden="true" />
              {imported.name} uploaded
            </p>
            <p className="mt-1 leading-6">
              {imported.courseCount} courses, {imported.sessionCount} sessions, {imported.studentCount} students.
              Students cannot see it until you publish it below.
            </p>
            {imported.studentLists && imported.studentLists.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-xs">
                {imported.studentLists.map((list) => (
                  <li key={list.filename}>
                    {list.filename}: {list.students} students
                    {list.sheets.length > 0 ? ` from ${list.sheets.join(", ")}` : ""}
                    {list.unknownGroups.length > 0 ? (
                      <span className="text-[#a6292f]"> · {list.unknownGroups.length} groups with no CRN</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {imported.unknownCrns && imported.unknownCrns.length > 0 ? (
              <p className="mt-1 text-[#a6292f]">
                {imported.unknownCrns.length} CRN(s) in the student list are missing from the timetable and were
                skipped: {imported.unknownCrns.slice(0, 8).join(", ")}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-[#d9dee7] bg-white">
        <header className="flex items-center gap-2 border-b border-[#e4e8ef] px-6 py-4">
          <CalendarDays size={18} className="text-[#1f4e79]" aria-hidden="true" />
          <h2 className="text-base font-semibold text-[#171717]">Semesters on the student platform</h2>
        </header>

        {terms.isLoading ? (
          <p className="px-6 py-8 text-sm text-[#667085]">Loading semesters…</p>
        ) : terms.error ? (
          <p role="alert" className="px-6 py-8 text-sm text-[#a6292f]">
            {(terms.error as Error).message}
          </p>
        ) : (terms.data ?? []).length === 0 ? (
          <p className="px-6 py-8 text-sm text-[#667085]">Nothing uploaded yet.</p>
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
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => setPendingDelete(term)}
                        className="rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AnnouncementEditor />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this semester?"
        description={
          pendingDelete
            ? `${pendingDelete.name} and its ${pendingDelete.sessionCount} sessions will be removed from the student platform. Students looking it up will stop finding their timetable. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete semester"
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete);
          setPendingDelete(null);
        }}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function FilePicker({
  label,
  hint,
  accept,
  files,
  multiple = false,
  onSelect,
}: {
  label: string;
  hint: string;
  accept: string;
  files: File[];
  multiple?: boolean;
  onSelect: (files: File[]) => void;
}) {
  return (
    <label className="text-sm font-semibold text-[#344054]">
      {label}
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => onSelect([...(event.target.files ?? [])])}
        className="mt-1.5 w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2 text-sm font-normal text-[#1f2937] file:mr-3 file:rounded file:border-0 file:bg-[#eaf1f8] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#1f4e79]"
      />
      <span className="mt-1 block text-xs font-normal text-[#667085]">
        {files.length > 0 ? files.map((file) => file.name).join(", ") : hint}
      </span>
    </label>
  );
}
