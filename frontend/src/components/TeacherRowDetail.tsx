/**
 * What a teacher's row in the library says, and what it lets you do from there.
 *
 * The list was a name, an email most of them have not got, and "0/0 tasks done", so any
 * sweep across two dozen people meant opening two dozen profiles. These two pieces put
 * the facts and the three common jobs on the row itself.
 *
 * Everything shown here is worked out from what is already stored, so nobody has to keep
 * it up and it cannot go stale. The one thing it deliberately does NOT say is "overdue":
 * a part-time teacher who is not teaching this period is not late, and a red mark
 * against them would be worse than no mark at all. It says which period the newest sheet
 * covers and leaves the reading to the person who knows who is teaching.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, FileCheck, FileClock, FilePlus, FileX } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { periodsBehind, shortPeriodLabel } from "@/services/payPeriods";
import {
  type Teacher,
  type TeacherSummary,
  createTeacherRequisition,
  downloadTeacherRequisitions,
  listTeacherRequisitions,
  listTeacherTimeSheets,
} from "@/services/teachers";

const NOTHING: TeacherSummary = {
  requisitions: 0,
  contractedHours: 0,
  adminHours: 0,
  timeSheets: 0,
  newestTimeSheet: null,
  hasDocuments: false,
};

/** A row's small square buttons: the jobs everybody knows by their icon, named on hover. */
const ICON_BUTTON =
  "inline-flex size-7 items-center justify-center rounded-md border border-[#d0d5dd] bg-white text-[#475467] hover:border-[#b7bec8] hover:bg-[#f2f7fb] hover:text-[#1f4e79] disabled:border-[#eef1f5] disabled:text-[#d0d5dd] disabled:hover:bg-white";

/** "40", "10.5": hours as a person reads them, without a trailing ".0". */
function hoursText(hours: number): string {
  return String(Math.round(hours * 10) / 10);
}

/**
 * What the requisitions pay for, as two figures side by side: teaching and admin.
 *
 * They were one number, "50 h", which was right until a requisition could pay for admin
 * work too — hours nobody teaches, which the planning and the registrar know nothing
 * about. Read as one figure they made every teacher with admin look over-planned. The
 * columns line up down the list, so the eye runs down a column of figures rather than
 * hunting through a sentence on each row.
 */
export function TeacherHoursFigures({ summary, loading }: { summary?: TeacherSummary; loading: boolean }) {
  if (loading && !summary) return <span className="text-xs text-[#98a2b3]">Reading…</span>;
  const held = summary ?? NOTHING;
  if (!held.requisitions) {
    return <span className="rounded bg-[#fdf9ee] px-1.5 py-0.5 text-xs font-semibold text-[#8a6116]">No requisition</span>;
  }
  const figure = (value: number, label: string, tone: string) => (
    <span className="flex min-w-[3.25rem] flex-col leading-tight">
      <span className={`text-sm font-semibold tabular-nums ${value ? tone : "text-[#c8d0da]"}`}>{hoursText(value)} h</span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#98a2b3]">{label}</span>
    </span>
  );
  return (
    <span className="flex items-center gap-3" title={`${held.requisitions} requisition${held.requisitions === 1 ? "" : "s"}`}>
      {figure(held.contractedHours, "teaching", "text-[#1f4e79]")}
      {figure(held.adminHours ?? 0, "admin", "text-[#7a5a1d]")}
      <span className="flex min-w-[2rem] flex-col leading-tight">
        <span className="text-sm font-semibold tabular-nums text-[#344054]">{held.requisitions}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#98a2b3]">filed</span>
      </span>
    </span>
  );
}

/**
 * The paperwork, as marks that say themselves: the newest time sheet, the documents.
 *
 * Only a gap is coloured, so the thing worth spotting is still the thing that stands out.
 * It does NOT say "overdue": a teacher not teaching this period is not late, so a sheet
 * for an earlier period is quiet rather than red.
 */
export function TeacherPaperwork({ summary, loading }: { summary?: TeacherSummary; loading: boolean }) {
  if (loading && !summary) return null;
  const held = summary ?? NOTHING;
  const sheet = held.newestTimeSheet;
  const behind = sheet ? periodsBehind(sheet.periodStart) : null;
  const pill = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";
  const gap = `${pill} bg-[#fdf9ee] text-[#8a6116]`;
  return (
    <span className="flex items-center gap-1.5">
      {!sheet ? (
        <span className={gap}>
          <FileClock size={12} aria-hidden="true" /> No time sheet
        </span>
      ) : (
        <span
          className={`${pill} ${behind !== null && behind > 0 ? "bg-[#f2f4f7] text-[#667085]" : "bg-[#eaf1f8] text-[#1f4e79]"}`}
          title={sheet.periodStart ? `Newest time sheet: ${sheet.label}` : "The newest time sheet says no period"}
        >
          <FileClock size={12} aria-hidden="true" /> {sheet.periodStart ? shortPeriodLabel(sheet.periodStart) : "No period"}
        </span>
      )}
      {held.hasDocuments ? (
        <span className={`${pill} bg-[#f4fbf5] text-[#256237]`}>
          <FileCheck size={12} aria-hidden="true" /> Docs
        </span>
      ) : (
        <span className={gap}>
          <FileX size={12} aria-hidden="true" /> No docs
        </span>
      )}
    </span>
  );
}


/**
 * The three jobs that used to need the profile: open a time sheet, take away one or more
 * requisitions, and start a new one.
 *
 * Each button that has to choose between several things opens a dialog rather than a
 * pop-up panel, and the lists behind those dialogs are only fetched when one is opened.
 * Two dozen rows asking for their own requisitions and sheets up front would be fifty
 * requests to draw a page nobody has interacted with yet.
 */
export function TeacherRowActions({
  teacher,
  summary,
  onOpenRequisition,
  onChanged,
}: {
  teacher: Teacher;
  summary?: TeacherSummary;
  onOpenRequisition: (teacherId: string, requisitionId: string) => void;
  onChanged: () => void;
}) {
  const held = summary ?? NOTHING;
  const [picking, setPicking] = useState<"time sheets" | "requisitions" | "new" | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [label, setLabel] = useState("");
  const [academicYear, setAcademicYear] = useState("2026-2027");

  const sheets = useQuery({
    queryKey: ["teacher-time-sheets", teacher.id],
    queryFn: () => listTeacherTimeSheets(teacher.id),
    enabled: picking === "time sheets",
  });
  const requisitions = useQuery({
    queryKey: ["teacher-requisitions", teacher.id],
    queryFn: () => listTeacherRequisitions(teacher.id),
    enabled: picking === "requisitions",
  });
  const download = useMutation({
    mutationFn: (ids: string[]) => downloadTeacherRequisitions(teacher.id, ids),
    onSuccess: () => setPicking(null),
  });
  const start = useMutation({
    mutationFn: () => createTeacherRequisition(teacher.id, { label: label.trim(), academicYear: academicYear.trim() }),
    onSuccess: (made) => {
      setPicking(null);
      onChanged();
      onOpenRequisition(teacher.id, made.id);
    },
  });

  const only = held.newestTimeSheet;
  const oneSheet = held.timeSheets === 1 && only;

  return (
    <>
      {/*
        * Every button names its teacher. The visible word is the same on all two dozen
        * rows, which is fine to look at and useless to listen to: read aloud, the page
        * was "New requisition" sixty-two times with nothing to tell them apart.
        */}
      <span className="flex flex-nowrap items-center gap-1">
        {/*
          * With one sheet the button is the link itself, because a dialog to choose
          * between one thing is a dialog that should not exist.
          */}
        {oneSheet ? (
          <a
            href={only.url}
            target="_blank"
            rel="noreferrer"
            title={only.label}
            aria-label={`Open ${teacher.fullName}'s time sheet`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            <ExternalLink size={13} /> Time sheet
          </a>
        ) : (
          <button
            type="button"
            disabled={held.timeSheets === 0}
            onClick={() => setPicking("time sheets")}
            title={held.timeSheets === 0 ? "No time sheet linked yet" : `Choose one of ${held.timeSheets}`}
            aria-label={`Time sheets for ${teacher.fullName}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:border-[#e4e8ef] disabled:text-[#c8d0da] disabled:hover:bg-white"
          >
            <ExternalLink size={13} /> Time sheet{held.timeSheets > 1 ? ` (${held.timeSheets})` : ""}
          </button>
        )}
        <button
          type="button"
          disabled={held.requisitions === 0}
          onClick={() => {
            setChosen([]);
            download.reset();
            setPicking("requisitions");
          }}
          title={held.requisitions === 0 ? "No requisition to download" : "Choose which to download"}
          aria-label={`Download requisitions for ${teacher.fullName}`}
          className={ICON_BUTTON}
        >
          <Download size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setLabel("");
            start.reset();
            setPicking("new");
          }}
          aria-label={`New requisition for ${teacher.fullName}`}
          title="New requisition"
          className={ICON_BUTTON}
        >
          <FilePlus size={14} aria-hidden="true" />
        </button>
      </span>

      <Modal
        open={picking === "time sheets"}
        title={`${teacher.fullName} — time sheets`}
        description="Each one opens in OneDrive, where the workbook lives."
        onClose={() => setPicking(null)}
      >
        {sheets.isLoading ? <p className="text-sm text-[#667085]">Reading the time sheets…</p> : null}
        <ul className="grid gap-2" aria-label="Time sheets to open">
          {(sheets.data ?? []).map((sheet) => (
            <li key={sheet.id}>
              <a
                href={sheet.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => setPicking(null)}
                className="flex items-center justify-between gap-3 rounded-lg border border-[#d9dee7] px-4 py-3 hover:border-[#b9d0e5] hover:bg-[#f8fafc]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#1f4e79]">{sheet.label}</span>
                  <span className="mt-0.5 block text-sm text-[#667085]">
                    {shortPeriodLabel(sheet.periodStart) || "no period said"}
                  </span>
                </span>
                <ExternalLink size={15} className="shrink-0 text-[#667085]" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={picking === "requisitions"}
        title={`${teacher.fullName} — download requisitions`}
        description="One arrives as a document. Several arrive as one zip."
        onClose={() => setPicking(null)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setPicking(null)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!chosen.length || download.isPending}
              onClick={() => download.mutate(chosen)}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {download.isPending ? "Preparing…" : `Download ${chosen.length || ""}`.trim()}
            </button>
          </div>
        }
      >
        {requisitions.isLoading ? <p className="text-sm text-[#667085]">Reading the requisitions…</p> : null}
        {(requisitions.data ?? []).length ? (
          <button
            type="button"
            onClick={() =>
              setChosen(
                chosen.length === (requisitions.data ?? []).length ? [] : (requisitions.data ?? []).map((item) => item.id),
              )
            }
            className="mb-2 text-sm font-semibold text-[#1f4e79]"
          >
            {chosen.length === (requisitions.data ?? []).length ? "Choose none" : "Choose all"}
          </button>
        ) : null}
        <ul className="grid gap-2" aria-label="Requisitions to download">
          {(requisitions.data ?? []).map((item) => (
            <li key={item.id}>
              <label className="flex items-center gap-3 rounded-lg border border-[#d9dee7] px-4 py-3 hover:bg-[#f8fafc]">
                <input
                  type="checkbox"
                  aria-label={`${item.label}, ${item.academicYear}`}
                  checked={chosen.includes(item.id)}
                  onChange={() =>
                    setChosen((held) =>
                      held.includes(item.id) ? held.filter((one) => one !== item.id) : [...held, item.id],
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-[#171717]">{item.label}</span>
                  <span className="mt-0.5 block text-sm text-[#667085]">{item.academicYear}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        {download.error ? (
          <p role="alert" className="mt-2 text-sm text-[#8f1f25]">
            {(download.error as Error).message}
          </p>
        ) : null}
      </Modal>

      {/*
        * A requisition is named before it exists, the same two things the profile asks
        * for. Inventing a label from the row would put a name nobody chose on a document
        * that goes to human resources.
        */}
      <Modal
        open={picking === "new"}
        title={`New requisition for ${teacher.fullName}`}
        description="It opens in the editor once it is made."
        onClose={() => setPicking(null)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setPicking(null)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!label.trim() || start.isPending}
              onClick={() => start.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {start.isPending ? "Creating…" : "Create and edit"}
            </button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            <span>Request label</span>
            <input
              autoFocus
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Physics TD requisition"
              className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            <span>Academic year</span>
            <input
              value={academicYear}
              onChange={(event) => setAcademicYear(event.target.value)}
              className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal"
            />
          </label>
        </div>
        {start.error ? (
          <p role="alert" className="mt-2 text-sm text-[#8f1f25]">
            {(start.error as Error).message}
          </p>
        ) : null}
      </Modal>
    </>
  );
}
