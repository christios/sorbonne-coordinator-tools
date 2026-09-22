/**
 * The registrar has deleted classes from a section that still exists.
 *
 * The sweep already protects against a section the portal stops answering for: it keeps
 * the classes it had and waits for two complete silences before believing it gone. This
 * is the other accident, and nothing caught it — a section that still answers, with its
 * classes deleted from inside it, read as a section that never had them. A part-time
 * teacher's twenty-six hours became six and the only sign was a number on another page
 * that has never had a warning on it, deliberately, because hours move all term.
 *
 * So it says so here, on the page where the people this happens to are listed, and it
 * keeps saying so until a coordinator has looked. Approval is stored against the missing
 * classes themselves, so it lasts exactly as long as they are the missing classes: the
 * same deletion stays approved, and one more class going stops the approval matching and
 * asks again.
 *
 * Opening it draws the months. A count cannot show this and a calendar can — three
 * squares left across three months is not a course being taught, and it reads at a glance
 * in a way that "6 h against 26 h" never did.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { hoursIn, monthsOfDiff, stillToLookAt, unexpected, type DiffDay } from "@/services/classDiff";
import { fetchRemovedClasses, fetchSweptTerms, type RemovedClasses } from "@/services/portalLists";
import { dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function RemovedClassesBanner({ className = "" }: { className?: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const terms = useQuery({ queryKey: ["swept-terms"], queryFn: fetchSweptTerms, retry: false });
  const termCode = terms.data?.[0] ?? "";
  const removed = useQuery({
    queryKey: ["removed-classes", termCode],
    queryFn: () => fetchRemovedClasses(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals, retry: false });
  const approved = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const waiting = useMemo(
    () => stillToLookAt(removed.data ?? [], approved),
    [removed.data, approved],
  );
  const approve = useMutation({
    mutationFn: (key: string) => setDismissal(key, true),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["warning-dismissals"] }),
  });

  if (waiting.length === 0) return null;

  // Only what the department did not already know: a coordinator's own cancellations
  // are not hours that went missing on them.
  const lost = waiting.reduce((sum, section) => sum + hoursIn(unexpected(section.removed)), 0);
  return (
    <>
      <div
        className={`${className} flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-4 py-3`}
      >
        <p className="flex items-start gap-2 text-sm text-[#7a5d00]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            The registrar has removed classes from{" "}
            <strong>
              {waiting.length} section{waiting.length === 1 ? "" : "s"}
            </strong>{" "}
            — {Math.round(lost * 100) / 100} h of teaching that was booked and is not any more.
          </span>
        </p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-md border border-[#c9a227] bg-white px-3 py-1.5 text-sm font-semibold text-[#7a5d00] hover:bg-[#fffaf0]"
        >
          Show what changed
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Classes the registrar has removed"
        description="Each month the section touches, with what still meets and what has gone. Approving one keeps it out of the banner until something else about it changes."
        size="wide"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {waiting.map((section) => (
            <SectionDiff
              key={section.key}
              section={section}
              onApprove={() => approve.mutate(section.key)}
              approving={approve.isPending && approve.variables === section.key}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}

function SectionDiff({
  section,
  onApprove,
  approving,
}: {
  section: RemovedClasses;
  onApprove: () => void;
  approving: boolean;
}) {
  const months = useMemo(() => monthsOfDiff(section.kept, section.removed), [section.kept, section.removed]);
  const news = unexpected(section.removed);
  const lost = hoursIn(news);
  const left = hoursIn(section.kept);
  const known = section.removed.length - news.length;
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-[#344054]">
            {section.courseCode || section.crn} · CRN {section.crn}
          </h4>
          <p className="mt-0.5 text-sm text-[#667085]">
            {section.teacherName || "Nobody named"} · {news.length} class{news.length === 1 ? "" : "es"} gone ({lost} h)
            {known ? `, ${known} you had cancelled` : ""}, {section.kept.length} still booked ({left} h)
          </p>
        </div>
        <button
          type="button"
          onClick={onApprove}
          disabled={approving}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60"
        >
          <Check size={16} /> Approve
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-5">
        {months.map((month) => (
          <div key={month.label}>
            <p className="text-sm font-semibold text-[#344054]">{month.label}</p>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((day) => (
                <span key={day} className="text-center text-[11px] font-medium text-[#98a2b3]">
                  {day}
                </span>
              ))}
              {month.days.map((day, index) => (
                <Square key={day?.day ?? `blank-${index}`} day={day} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-[#667085]">
        <span className="mr-3 inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#d1e7dd]" /> still meets
        </span>
        <span className="mr-3 inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#f8d7da]" /> removed
        </span>
        {known ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#e9ecef]" /> you had cancelled it
          </span>
        ) : null}
      </p>
    </section>
  );
}

function Square({ day }: { day: DiffDay | null }) {
  if (!day) return <span className="h-8 w-8" />;
  const gone = day.removed.length > 0;
  const meets = day.kept.length > 0;
  // Grey where the department cancelled it: a gap it already knew about, drawn so the
  // month still reads as a month, but not in the colour that means "look at this".
  const ours = gone && day.removed.every((meeting) => meeting.weCancelled);
  const paint = ours
    ? "bg-[#e9ecef] text-[#667085]"
    : gone
      ? "bg-[#f8d7da] text-[#842029]"
      : meets
        ? "bg-[#d1e7dd] text-[#0f5132]"
        : "text-[#98a2b3]";
  const title = ours
    ? `${day.day}: you cancelled this, and the registrar has now removed it`
    : gone
      ? `${day.day}: ${day.removed.length} class${day.removed.length === 1 ? "" : "es"} removed`
      : meets
        ? `${day.day}: still meets`
        : day.day;
  return (
    <span
      title={title}
      className={`flex h-8 w-8 items-center justify-center rounded-sm text-xs font-medium ${paint} ${gone ? "line-through" : ""}`}
    >
      {day.dayOfMonth}
    </span>
  );
}
