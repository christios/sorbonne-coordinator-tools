import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { TimetableTerm, importTimetableTerm } from "@/services/timetables";

/**
 * Creating a semester from the registrar's activity-list export.
 *
 * The export alone: the student lists that used to come with it are gone, because who is
 * in which group is this application's own knowledge and reaches students through Publish.
 * A semester therefore arrives with nobody on it — define its blocks in Groups & CRNs,
 * place the cohort, then publish.
 */
export function SemesterImport({ host }: { host: string | null }) {
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

  return (
          <section className="rounded-lg border border-[#d9dee7] bg-white p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#171717]">Import a timetable</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[#667085]">
                  Send the registrar&rsquo;s activity-list export to the student platform. It arrives with
                  nobody on it: define the blocks in Groups &amp; CRNs, place the cohort, then publish.
                  Importing a semester name that already exists replaces its timetable.
                </p>
              </div>
              <a
                href={`https://${host}/`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
              >
                {host} <ExternalLink size={15} aria-hidden="true" />
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
                className="md:col-span-2"
                label="Timetable export"
                hint=".xls or .xlsx from the registrar"
                accept=".xls,.xlsx"
                files={timetable ? [timetable] : []}
                onSelect={(files) => setTimetable(files[0] ?? null)}
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
                  Import to student platform
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
                  {imported.courseCount} courses and {imported.sessionCount} sessions, with{" "}
                  {imported.studentCount} student(s) on it. Give its blocks their groups in Groups &amp;
                  CRNs, place the cohort, then publish — students see nothing until you do.
                </p>
              </div>
            ) : null}
          </section>
  );
}

function FilePicker({
  label,
  hint,
  accept,
  files,
  multiple = false,
  className = "",
  onSelect,
}: {
  label: string;
  hint: string;
  accept: string;
  files: File[];
  multiple?: boolean;
  className?: string;
  onSelect: (files: File[]) => void;
}) {
  return (
    <label className={`text-sm font-semibold text-[#344054] ${className}`}>
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
