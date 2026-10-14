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
 *
 * A period approved in the Timesheets app is different: it is here, whole, so HR's own Part
 * Time Sheet can be filled from it — one per teacher, in one zip — and the press that
 * produced them can record that they went to HR.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, ExternalLink, FileSpreadsheet, Send, X } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { SelectionBar } from "@/components/SelectionActions";
import { TimetablesButton } from "@/components/TimetablesButton";
import { fetchActiveTeachers } from "@/services/portalLists";
import { exportTeacherTimetables } from "@/services/timetableExports";
import { localDay, periodLabel } from "@/services/payPeriods";
import { payIssueSaid } from "@/services/payRates";
import {
  type Teacher,
  type TeacherTimeSheet,
  downloadPartTimeSheets,
  downloadTeachersRequisitions,
  listEverySubmittedTimeSheet,
  editedLines,
  editedSaid,
  listTeacherTimeSheets,
  markSubmittedToHr,
  SHEET_WORDS,
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
  const client = useQueryClient();
  const [showingSheets, setShowingSheets] = useState(false);
  const [showingPartTime, setShowingPartTime] = useState(false);
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
    <>
      {/* The same bar Students and Cohorts float over their tables; only the buttons differ. */}
      <SelectionBar count={chosen.length} onClear={onClear}>
        <button
          type="button"
          disabled={requisitions.isPending}
          onClick={() => {
            setSaid("");
            requisitions.mutate();
          }}
          className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
        >
          <Download size={15} aria-hidden="true" />{" "}
          {requisitions.isPending ? "Preparing…" : "Download requisitions"}
        </button>
        <button
          type="button"
          onClick={() => {
            setSaid("");
            setShowingSheets(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054]"
        >
          <FileSpreadsheet size={15} aria-hidden="true" /> Time sheets…
        </button>
        <button
          type="button"
          onClick={() => {
            setSaid("");
            setShowingPartTime(true);
          }}
          className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 font-semibold text-[#344054]"
        >
          <FileSpreadsheet size={15} aria-hidden="true" /> Part Time Sheets…
        </button>
        {/* Their teaching, found through the department's list they are linked to, or by name. */}
        <TimetablesButton
          make={async () => {
            const active = await client.fetchQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
            return exportTeacherTimetables(
              client,
              chosen.map((id) => ({ id: active.find((row) => row.partTimeTeacherId === id)?.id ?? "", fullName: nameOf(id) })),
            );
          }}
        />
        {said ? <span className="text-[#2f6b3d]">{said}</span> : null}
        {requisitions.error ? (
          <span role="alert" className="text-[#8f1f25]">
            {(requisitions.error as Error).message}
          </span>
        ) : null}
      </SelectionBar>

      <Modal
        open={showingSheets}
        size="wide"
        title={`Time sheets for ${chosen.length} teacher${chosen.length === 1 ? "" : "s"}`}
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

      {showingPartTime ? (
        <PartTimeSheets chosen={chosen} nameOf={nameOf} onClose={() => setShowingPartTime(false)} />
      ) : null}
    </>
  );
}

/**
 * The approved periods of the ticked teachers as HR's Part Time Sheets: one period at a
 * time, because a sheet is a period and HR is sent a period's worth together.
 *
 * Downloading is not sending, so nothing is marked by it. What it does is offer, once the
 * file is made, to mark exactly the sheets in it as submitted to HR — one press for the
 * batch, rather than twenty ticks on twenty profiles.
 */
function PartTimeSheets({
  chosen,
  nameOf,
  onClose,
}: {
  chosen: string[];
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const all = useQuery({ queryKey: ["submitted-time-sheets", "all"], queryFn: listEverySubmittedTimeSheet, retry: false });
  const mine = useMemo(
    () => (all.data ?? []).filter((sheet) => chosen.includes(sheet.teacherId)),
    [all.data, chosen],
  );
  const periods = useMemo(() => [...new Set(mine.map((sheet) => sheet.periodStart))].sort().reverse(), [mine]);
  const [picked, setPicked] = useState("");
  const period = picked || periods[0] || "";
  const sheets = mine
    .filter((sheet) => sheet.periodStart === period)
    .sort((left, right) => nameOf(left.teacherId).localeCompare(nameOf(right.teacherId)));
  const without = chosen.filter((id) => !sheets.some((sheet) => sheet.teacherId === id));
  // Files, not periods: a teacher who gave lectures and tutorials is a sheet at each rate.
  const files = sheets.reduce((sum, sheet) => sum + Math.max(1, sheet.partTimeSheets?.length ?? 1), 0);
  // What the last download held, so the offer to mark them is about exactly those.
  const [made, setMade] = useState<{ ids: string[]; notPlaced: number } | null>(null);
  const download = useMutation({
    mutationFn: (ids: string[]) => downloadPartTimeSheets(ids).then(({ notPlaced }) => ({ ids, notPlaced })),
    onSuccess: setMade,
  });
  const mark = useMutation({
    mutationFn: (ids: string[]) => markSubmittedToHr(ids),
    onSuccess: () => {
      setMade(null);
      void client.invalidateQueries({ queryKey: ["submitted-time-sheets"] });
      void client.invalidateQueries({ queryKey: ["tasks", "teacher"] });
    },
  });
  const failed = (download.error ?? mark.error ?? all.error) as Error | null;
  const unsent = made ? made.ids.filter((id) => !sheets.find((sheet) => sheet.periodId === id)?.hrSubmittedAt) : [];

  return (
    <Modal
      open
      size="wide"
      title={`Part Time Sheets for ${chosen.length} teacher${chosen.length === 1 ? "" : "s"}`}
      description="Filled from the periods approved in the Timesheets app: one workbook per teacher, in one zip."
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {failed ? (
            <span role="alert" className="mr-auto text-sm text-[#a6292f]">
              {failed.message}
            </span>
          ) : made ? (
            <span className="mr-auto text-sm text-[#667085]">
              {made.notPlaced
                ? `Downloaded, but ${made.notPlaced} line${made.notPlaced === 1 ? " has" : "s have"} no row on the template — check before sending.`
                : `Downloaded the sheets of ${made.ids.length} teacher${made.ids.length === 1 ? "" : "s"}.`}
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Close
          </button>
          {made && unsent.length ? (
            <button
              type="button"
              onClick={() => mark.mutate(made.ids)}
              disabled={mark.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1f6b47] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send size={14} aria-hidden="true" />
              {mark.isPending
                ? "Marking…"
                : `Mark ${made.ids.length === 1 ? "it" : `these ${made.ids.length}`} as submitted to HR`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={!sheets.length || download.isPending}
            onClick={() => download.mutate(sheets.map((sheet) => sheet.periodId))}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            <Download size={14} aria-hidden="true" />
            {download.isPending
              ? "Preparing…"
              : files === 1
                ? "Download the sheet"
                : `Download ${files || ""} sheets (.zip)`}
          </button>
        </div>
      }
    >
      {all.isPending ? <p className="text-sm text-[#667085]">Reading the approved sheets…</p> : null}
      {!all.isPending && !periods.length ? (
        <p className="text-sm text-[#667085]">None of the teachers you chose has a period approved in the Timesheets app yet.</p>
      ) : null}
      {periods.length ? (
        <>
          <div className="mb-3 w-64">
            <SelectMenu
              label="Period"
              value={period}
              onChange={(value) => {
                setPicked(value);
                setMade(null);
              }}
              options={periods.map((start) => ({ value: start, label: periodLabel(start) || start }))}
            />
          </div>
          <div className="overflow-x-auto rounded-lg border border-[#d9dee7]">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#e4e8ef] text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                  <th scope="col" className="px-3 py-2 text-left">Teacher</th>
                  <th scope="col" className="px-3 py-2 text-right">Hours</th>
                  <th scope="col" className="px-3 py-2 text-left">Sheets</th>
                  <th scope="col" className="px-3 py-2 text-left">Approved</th>
                  <th scope="col" className="px-3 py-2 text-left">HR</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet) => (
                  <tr key={sheet.periodId} className="border-b border-[#f2f4f7] last:border-0">
                    <td className="px-3 py-2 text-[#344054]">{nameOf(sheet.teacherId)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#344054]">{sheet.claimedHours}</td>
                    <td className="px-3 py-2 text-xs text-[#667085]">
                      {(sheet.partTimeSheets ?? []).map((part) => `${SHEET_WORDS[part.type]} ${part.hours} h`).join(" · ") ||
                        "—"}
                    </td>
                    <td className="px-3 py-2 text-[#667085]">
                      {[sheet.approvedBy, sheet.approvedOn ? localDay(sheet.approvedOn) : ""].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {sheet.hrSubmittedAt ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f6b47]">
                          <CheckCircle2 size={13} aria-hidden="true" /> Sent {localDay(sheet.hrSubmittedAt)}
                        </span>
                      ) : (
                        <span className="text-xs text-[#667085]">Not sent</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/*
            * Whose sheets will go out with a rate left blank, and why, and whose lines were
            * edited after the pre-fill — before anything is sent.
            */}
          {sheets.some((sheet) => sheet.pay?.issues.length || editedLines(sheet)) ? (
            <ul className="mt-3 grid gap-1 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-xs text-[#8a6116]">
              {sheets.flatMap((sheet) => [
                ...(sheet.pay?.issues ?? []).map((issue, index) => (
                  <li key={`${sheet.periodId}-${index}`}>
                    <span className="font-semibold">{nameOf(sheet.teacherId)}:</span> {payIssueSaid(issue)}
                  </li>
                )),
                ...(editedLines(sheet)
                  ? [
                      <li key={`${sheet.periodId}-edited`}>
                        <span className="font-semibold">{nameOf(sheet.teacherId)}:</span> {editedSaid(editedLines(sheet))}{" "}
                        Check which sheet each went on.
                      </li>,
                    ]
                  : []),
              ])}
            </ul>
          ) : null}
          {without.length ? (
            <p className="mt-3 flex items-start gap-1.5 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-xs text-[#8a6116]">
              <X size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                No approved sheet for {periodLabel(period) || period} from {without.map(nameOf).join(", ")}.
              </span>
            </p>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
