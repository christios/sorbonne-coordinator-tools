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
import { ExternalLink } from "lucide-react";
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
  timeSheets: 0,
  newestTimeSheet: null,
  hasDocuments: false,
};

/**
 * The line of facts under a teacher's name.
 *
 * Plain text separated by middots rather than a row of bordered pills. The pills read
 * well on their own and cost a row most of its height once there are four of them, and
 * the list is two dozen rows that somebody scans. Only a gap is given a background, so
 * the thing worth spotting is still the thing that stands out.
 */
export function TeacherFacts({ summary, loading }: { summary?: TeacherSummary; loading: boolean }) {
  if (loading && !summary) {
    return <span className="text-xs text-[#98a2b3]">Reading…</span>;
  }
  const held = summary ?? NOTHING;
  const sheet = held.newestTimeSheet;
  const behind = sheet ? periodsBehind(sheet.periodStart) : null;
  const facts: { text: string; missing?: boolean; quiet?: boolean }[] = [
    held.requisitions
      ? { text: `${held.requisitions} requisition${held.requisitions === 1 ? "" : "s"}` }
      : { text: "no requisition", missing: true },
    ...(held.contractedHours ? [{ text: `${held.contractedHours} h` }] : []),
    !sheet
      ? { text: "no time sheet", missing: true }
      : sheet.periodStart
        ? // Not a fault, just a fact: the newest sheet is not for the period running now.
          { text: `sheet ${shortPeriodLabel(sheet.periodStart)}`, quiet: behind !== null && behind > 0 }
        : { text: "sheet, no period", quiet: true },
    held.hasDocuments ? { text: "docs" } : { text: "no docs", missing: true },
  ];
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-[#667085]">
      {facts.map((fact, index) => (
        <span key={fact.text} className="flex items-center gap-x-1.5">
          {index ? <span className="text-[#c8d0da]">·</span> : null}
          <span
            className={
              fact.missing
                ? "rounded bg-[#fdf9ee] px-1.5 py-0.5 font-semibold text-[#8a6116]"
                : fact.quiet
                  ? "text-[#98a2b3]"
                  : "text-[#475467]"
            }
          >
            {fact.text}
          </span>
        </span>
      ))}
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
      <span className="flex flex-wrap items-center gap-1.5">
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
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:border-[#e4e8ef] disabled:text-[#c8d0da] disabled:hover:bg-white"
        >
          Download
        </button>
        <button
          type="button"
          onClick={() => {
            setLabel("");
            start.reset();
            setPicking("new");
          }}
          aria-label={`New requisition for ${teacher.fullName}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          New requisition
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
              placeholder="Physics TD contract"
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
