/**
 * The registrar has changed the classes inside a section that still exists.
 *
 * The sweep already protects against a section the portal stops answering for: it keeps
 * the classes it had and waits for two complete silences before believing it gone. This
 * is the other accident, and nothing caught it — a section that still answers, with its
 * classes deleted from inside it, read as a section that never had them. A part-time
 * teacher's twenty-six hours became six and the only sign was a number on another page
 * that has never had a warning on it, deliberately, because hours move all term.
 *
 * Three things, because three things can be true of a class: it has gone, it is still
 * there, or it has arrived. Arrivals are not a lesser fact — a class nobody planned is
 * teaching somebody has to do, and shown as "still booked" it was indistinguishable from
 * one that had always been in the timetable. Nothing here calls a deletion and an arrival
 * a move, whatever the week looks like: the registrar's meetings carry no identity from
 * one sweep to the next, so a move would be a guess wearing the clothes of a fact. Both
 * halves are drawn and the coordinator reading the month draws the conclusion.
 *
 * It says so on the pages where the people this happens to are listed, and it keeps
 * saying so until a coordinator has looked. Approval is stored against the changed
 * classes themselves, so it lasts exactly as long as they are the changed classes: the
 * same change stays approved, one more class going or arriving stops the approval
 * matching and asks again — and because the approval names the classes rather than the
 * page it was given on, answering it on Active CRNs answers it on Active teachers too.
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
import { fetchChangedClasses, fetchSweptTerms, type ChangedClasses } from "@/services/portalLists";
import { dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "8 h removed, 2 h added", leaving out the half that did not happen. */
function saidIn(lost: number, gained: number): string {
  const said = [
    lost ? `${Math.round(lost * 100) / 100} h removed` : "",
    gained ? `${Math.round(gained * 100) / 100} h added` : "",
  ].filter(Boolean);
  return said.join(", ");
}

export function ClassChangesBanner({ className = "" }: { className?: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const terms = useQuery({ queryKey: ["swept-terms"], queryFn: fetchSweptTerms, retry: false });
  const termCode = terms.data?.[0] ?? "";
  const changed = useQuery({
    queryKey: ["changed-classes", termCode],
    queryFn: () => fetchChangedClasses(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals, retry: false });
  const approved = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const waiting = useMemo(
    () => stillToLookAt(changed.data ?? [], approved),
    [changed.data, approved],
  );
  const approve = useMutation({
    mutationFn: (key: string) => setDismissal(key, true),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["warning-dismissals"] }),
  });

  if (waiting.length === 0) return null;

  // Only what the department did not already know: a coordinator's own cancellations
  // are not hours that went missing on them.
  const lost = waiting.reduce((sum, section) => sum + hoursIn(unexpected(section.removed)), 0);
  const gained = waiting.reduce((sum, section) => sum + hoursIn(section.added), 0);
  return (
    <>
      <div
        className={`${className} flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-4 py-3`}
      >
        <p className="flex items-start gap-2 text-sm text-[#7a5d00]">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>
            The registrar has changed the classes in{" "}
            <strong>
              {waiting.length} section{waiting.length === 1 ? "" : "s"}
            </strong>{" "}
            — {saidIn(lost, gained)} since the department last looked.
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
        title="Classes the registrar has changed"
        description="Each month the section touches, with what still meets, what has gone and what has arrived. Approving one keeps it out of the banner until something else about it changes."
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
  section: ChangedClasses;
  onApprove: () => void;
  approving: boolean;
}) {
  const months = useMemo(
    () => monthsOfDiff(section.kept, section.removed, section.added),
    [section.kept, section.removed, section.added],
  );
  const news = unexpected(section.removed);
  const lost = hoursIn(news);
  const gained = hoursIn(section.added);
  const left = hoursIn(section.kept);
  const known = section.removed.length - news.length;
  const said = [
    news.length ? `${news.length} class${news.length === 1 ? "" : "es"} gone (${lost} h)` : "",
    known ? `${known} you had cancelled` : "",
    section.added.length ? `${section.added.length} arrived (${gained} h)` : "",
    `${section.kept.length} unchanged (${left} h)`,
  ].filter(Boolean);
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-[#344054]">
            {section.courseCode || section.crn} · CRN {section.crn}
          </h4>
          <p className="mt-0.5 text-sm text-[#667085]">
            {section.teacherName || "Nobody named"} · {said.join(", ")}
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
      {/*
        * Every month the section touches on one row, however many there are. A semester
        * read as a strip is the whole point of drawing it — three squares left across
        * September, October and November is a course that stopped, and that only shows
        * when the months are side by side. Wrapped, the last month dropped under the
        * first and the shape went with it. So the columns share the width and the days
        * shrink to fit rather than the row breaking.
        */}
      <div className="mt-4 grid auto-cols-[minmax(9rem,1fr)] grid-flow-col gap-4 overflow-x-auto pb-1">
        {months.map((month) => (
          <div key={month.label} className="min-w-0">
            <p className="text-sm font-semibold text-[#344054]">{month.label}</p>
            <div className="mt-2 grid grid-cols-7 gap-[3px]">
              {WEEKDAYS.map((day) => (
                <span key={day} className="truncate text-center text-[10px] font-medium text-[#98a2b3]">
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
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#667085]">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#cfe2ff]" /> unchanged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#f8d7da]" /> removed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[#d1e7dd]" /> added
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
  if (!day) return <span className="aspect-square w-full" />;
  const gone = day.removed.length > 0;
  const arrived = day.added.length > 0;
  const meets = day.kept.length > 0;
  // Grey where the department cancelled it: a gap it already knew about, drawn so the
  // month still reads as a month, but not in the colour that means "look at this".
  const ours = gone && day.removed.every((meeting) => meeting.weCancelled);
  // A day can be two things at once — one class deleted, another put in its place. The
  // arrival takes the square, because it is the half a reader would otherwise never see,
  // and the loss keeps a ring around it rather than being argued down to nothing.
  const paint = arrived
    ? "bg-[#d1e7dd] text-[#0f5132]"
    : ours
      ? "bg-[#e9ecef] text-[#667085]"
      : gone
        ? "bg-[#f8d7da] text-[#842029]"
        : meets
          ? "bg-[#cfe2ff] text-[#084298]"
          : "text-[#98a2b3]";
  const also = arrived && gone ? " ring-2 ring-inset ring-[#e07c84]" : "";
  const said = [
    gone ? `${day.removed.length} class${day.removed.length === 1 ? "" : "es"} removed` : "",
    ours ? "which you had cancelled" : "",
    arrived ? `${day.added.length} added` : "",
    meets ? "still meets" : "",
  ].filter(Boolean);
  return (
    <span
      title={said.length ? `${day.day}: ${said.join(", ")}` : day.day}
      className={`flex aspect-square w-full items-center justify-center rounded-sm text-[11px] font-medium ${paint}${also} ${gone && !arrived ? "line-through" : ""}`}
    >
      {day.dayOfMonth}
    </span>
  );
}
