/**
 * What you can do to several part-time teachers at once, once some rows are ticked.
 *
 * Two jobs, and they are not the same shape, because the two things are not kept in the
 * same place. A requisition is ours: the server writes the document, so several of them
 * really do arrive as one zip. A time sheet is a workbook in OneDrive that somebody else
 * owns, and this platform holds a link to it and nothing more. Nothing here can fetch
 * those files: the server has no Microsoft credential, and a browser cannot read another
 * origin's downloads either.
 *
 * So the time-sheet button hands over what there actually is — the list, as a spreadsheet
 * you can keep, and a way to open every sheet at once — and says plainly that it is the
 * links rather than the workbooks. Pretending otherwise would give somebody a zip full of
 * sign-in pages at the end of a payroll run.
 */

import { useMutation, useQueries } from "@tanstack/react-query";
import { Download, ExternalLink, FileSpreadsheet, X } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { periodLabel } from "@/services/payPeriods";
import {
  type Teacher,
  type TeacherTimeSheet,
  downloadTeachersRequisitions,
  listTeacherTimeSheets,
} from "@/services/teachers";

/** A row of the list a time-sheet download comes to. */
export type SheetLine = { teacher: string; sheet: TeacherTimeSheet };

export function asSpreadsheet(lines: SheetLine[]): string {
  const cell = (value: string) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Teacher", "Time sheet", "Period", "Academic year", "Link"],
    ...lines.map(({ teacher, sheet }) => [
      teacher,
      sheet.label,
      periodLabel(sheet.periodStart) || "not said",
      sheet.academicYear,
      sheet.url,
    ]),
  ];
  // A leading BOM, or Excel reads a column of accented names as mojibake.
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

function save(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function TeacherBulkActions({
  chosen,
  teachers,
  onClear,
}: {
  chosen: string[];
  teachers: Teacher[];
  onClear: () => void;
}) {
  const [showingSheets, setShowingSheets] = useState(false);
  const [said, setSaid] = useState("");
  const nameOf = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? id;

  const requisitions = useMutation({
    mutationFn: () => downloadTeachersRequisitions(chosen),
    onSuccess: ({ withoutRequisitions }) =>
      setSaid(
        withoutRequisitions
          ? `Downloaded. ${withoutRequisitions} of them had no requisition to include.`
          : "Downloaded.",
      ),
  });

  // Only asked for once the dialog is open: two dozen rows fetching their own sheets up
  // front would be two dozen requests to draw a page nobody has ticked anything on.
  const { lines, loading } = useQueries({
    queries: (showingSheets ? chosen : []).map((id) => ({
      queryKey: ["teacher-time-sheets", id],
      queryFn: () => listTeacherTimeSheets(id),
    })),
    combine: (reads) => ({
      lines: reads.flatMap((read, index) =>
        (read.data ?? []).map((sheet) => ({ teacher: nameOf(chosen[index]), sheet })),
      ),
      loading: reads.some((read) => read.isLoading),
    }),
  });
  const without = chosen.filter((id) => !lines.some((line) => line.teacher === nameOf(id)));

  return (
    <div
      role="status"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-[#d9dee7] bg-[#f8fafc] px-5 py-3"
    >
      <span className="text-sm font-semibold text-[#171717]">
        {chosen.length} teacher{chosen.length === 1 ? "" : "s"} chosen
      </span>
      <button
        type="button"
        disabled={requisitions.isPending}
        onClick={() => {
          setSaid("");
          requisitions.mutate();
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
      >
        <Download size={14} /> {requisitions.isPending ? "Preparing…" : "Download requisitions"}
      </button>
      <button
        type="button"
        onClick={() => {
          setSaid("");
          setShowingSheets(true);
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-white"
      >
        <FileSpreadsheet size={14} /> Time sheets…
      </button>
      <button type="button" onClick={onClear} className="text-sm font-semibold text-[#667085]">
        Clear
      </button>
      {said ? <span className="text-sm text-[#2f6b3d]">{said}</span> : null}
      {requisitions.error ? (
        <span role="alert" className="text-sm text-[#8f1f25]">
          {(requisitions.error as Error).message}
        </span>
      ) : null}

      <Modal
        open={showingSheets}
        size="wide"
        title={`Time sheets for ${chosen.length} teacher${chosen.length === 1 ? "" : "s"}`}
        description="The workbooks live in OneDrive and stay there. What this can hand over is the list and the links."
        onClose={() => setShowingSheets(false)}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowingSheets(false)}
              className="text-sm font-semibold text-[#667085]"
            >
              Close
            </button>
            {/*
              * Opening them is a separate press from saving the list, because a browser
              * will stop a page opening twenty tabs and there is nothing to be done about
              * that but let somebody choose it deliberately.
              */}
            <button
              type="button"
              disabled={!lines.length}
              onClick={() => lines.forEach(({ sheet }) => window.open(sheet.url, "_blank", "noreferrer"))}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] disabled:border-[#e4e8ef] disabled:text-[#c8d0da]"
            >
              <ExternalLink size={14} /> Open all {lines.length || ""}
            </button>
            <button
              type="button"
              disabled={!lines.length}
              onClick={() => save("part-time-time-sheets.csv", asSpreadsheet(lines), "text/csv;charset=utf-8")}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              <Download size={14} /> Download the list
            </button>
          </div>
        }
      >
        {loading ? <p className="text-sm text-[#667085]">Reading the time sheets…</p> : null}
        {!loading && !lines.length ? (
          <p className="text-sm text-[#667085]">None of the teachers you chose has a time sheet linked yet.</p>
        ) : null}
        {lines.length ? (
          <div className="overflow-x-auto rounded-lg border border-[#d9dee7]">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e4e8ef] text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                  <th scope="col" className="px-3 py-2 text-left">Teacher</th>
                  <th scope="col" className="px-3 py-2 text-left">Time sheet</th>
                  <th scope="col" className="px-3 py-2 text-left">Period</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(({ teacher, sheet }) => (
                  <tr key={sheet.id} className="border-b border-[#f2f4f7] last:border-0">
                    <td className="px-3 py-2 text-[#344054]">{teacher}</td>
                    <td className="px-3 py-2">
                      <a
                        href={sheet.url}
                        target="_blank"
                        rel="noreferrer"
                        title={sheet.url}
                        className="inline-flex items-center gap-1.5 font-semibold text-[#1f4e79] hover:underline"
                      >
                        {sheet.label}
                        <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    </td>
                    <td className="px-3 py-2 text-[#667085]">{periodLabel(sheet.periodStart) || "not said"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {/* Said out loud: a blank is somebody nobody has filed a sheet for, not a failure. */}
        {!loading && without.length ? (
          <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-xs text-[#8a6116]">
            <X size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              No time sheet linked for {without.map(nameOf).join(", ")}.
            </span>
          </p>
        ) : null}
      </Modal>
    </div>
  );
}
