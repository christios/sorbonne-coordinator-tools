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

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CheckCircle2 } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useMemo, type CSSProperties, type ReactNode } from "react";

import { SourceMark } from "@/components/DataTable";
import { locationFor } from "@/routes/toolRoute";
import {
  hoursIn,
  known,
  minutesOf,
  monthsOfDiff,
  oursSaid,
  stillToLookAt,
  unexpected,
  type DiffDay,
  type Meeting,
} from "@/services/classDiff";
import { formatRoom } from "@/services/weekSchedule";
import { useRooms } from "@/services/rooms";
import { fetchChangedClasses, fetchSweptTerms, type ChangedClasses } from "@/services/portalLists";
import { dismissalsByKey, fetchDismissals, type Dismissal } from "@/services/warningDismissals";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "8 h removed, 2 h added", leaving out the half that did not happen. */
function saidIn(lost: number, gained: number): string {
  const said = [
    lost ? `${Math.round(lost * 100) / 100} h removed` : "",
    gained ? `${Math.round(gained * 100) / 100} h added` : "",
  ].filter(Boolean);
  return said.join(", ");
}

/**
 * The count, on the pages where the people it happens to are listed; the looking, linking
 * and approving happen on the Class changes page, which this opens.
 */
export function ClassChangesBanner({ className = "" }: { className?: string }) {
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
            The portal has changed the classes in{" "}
            <strong>
              {waiting.length} section{waiting.length === 1 ? "" : "s"}
            </strong>{" "}
            — {saidIn(lost, gained)} since the department last looked.
          </span>
        </p>
        <a
          href={`#${locationFor("database", "class-changes")}`}
          className="shrink-0 rounded-md border border-[#c9a227] bg-white px-3 py-1.5 text-sm font-semibold text-[#7a5d00] hover:bg-[#fffaf0]"
        >
          Show what changed
        </a>
      </div>
    </>
  );
}

/** "20 Oct", for when something was approved. */
function shortDay(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso.slice(0, 10);
  return `${when.getDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][when.getMonth()]}`;
}

/**
 * One section's changed classes across the semester's months: what still meets, what went,
 * what arrived — with its approval, and whatever the page wants to show under it.
 */
export function SectionDiff({
  section,
  span,
  onApprove,
  approving = false,
  approval,
  plain = false,
  children,
}: {
  section: ChangedClasses;
  /** The semester's months, so a section with nothing in September still shows September. */
  span?: { from: string; to: string };
  onApprove?: () => void;
  approving?: boolean;
  /** Who approved this change, and when — said in place of the button. */
  approval?: Dismissal;
  /**
   * Inside a card of its own — the CRN record's — which already has the border and says
   * which section it is: drawn without either.
   */
  plain?: boolean;
  children?: ReactNode;
}) {
  const months = useMemo(
    () => monthsOfDiff(section.kept, section.removed, section.added, span),
    [section.kept, section.removed, section.added, span],
  );
  const news = unexpected(section.removed);
  const lost = hoursIn(news);
  const gained = hoursIn(section.added);
  const left = hoursIn(section.kept);
  const cancelledByUs = section.removed.filter((meeting) => meeting.weCancelled).length;
  const coveredByUs = section.removed.filter((meeting) => meeting.weCovered).length;
  const knownCount = cancelledByUs + coveredByUs;
  // Whether any day here is two things at once, which is the only thing the ring says.
  const both = months.some((month) =>
    month.days.some((day) => day && day.removed.length > 0 && day.added.length > 0),
  );
  const said = [
    news.length ? `${news.length} class${news.length === 1 ? "" : "es"} gone (${lost} h)` : "",
    cancelledByUs ? `${cancelledByUs} you had cancelled` : "",
    coveredByUs ? `${coveredByUs} you had covered` : "",
    section.added.length ? `${section.added.length} arrived (${gained} h)` : "",
    `${section.kept.length} unchanged (${left} h)`,
  ].filter(Boolean);
  return (
    /*
     * Two columns: the months on the left, and on the right what the section is and what
     * the department makes of it — the approval, and the classes that went and arrived
     * with their links and notes. The months are read and the lists are worked through
     * side by side, so neither has to be scrolled away to use the other. On a narrow
     * screen the right-hand half comes first, since it says what the months are of.
     */
    <section
      className={`grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] ${
        plain ? "" : "rounded-lg border border-[#d9dee7] bg-white p-4"
      }`}
    >
      <div className="min-w-0 lg:order-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {plain ? null : (
              <h4 className="text-base font-semibold text-[#344054]">
                {section.courseCode || section.crn} · CRN {section.crn}
              </h4>
            )}
            <p className={`text-sm text-[#667085] ${plain ? "" : "mt-0.5"}`}>
              {section.teacherName || "Nobody named"} · {said.join(", ")}
            </p>
          </div>
          {approval ? (
            <span className="inline-flex shrink-0 items-center">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-[#e8f5ee] px-3 py-1.5 text-sm font-semibold text-[#1f6b47]">
                <CheckCircle2 size={16} aria-hidden="true" /> Approved by {approval.byName || approval.byEmail}, {shortDay(approval.at)}
              </span>
              <SourceMark source="planning" />
            </span>
          ) : onApprove ? (
            <button
              type="button"
              onClick={onApprove}
              disabled={approving}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60"
            >
              <Check size={16} /> Approve
            </button>
          ) : null}
        </div>
        {children}
      </div>
      <div className="min-w-0 lg:order-1">
        {/*
          * The semester's months side by side on one row, small, every section laid against the
          * same ones, so a course that stopped in November reads the same on every card: the
          * squares that are left, against the months around them. A phone keeps two to a row.
          */}
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-(--months)"
          style={{ "--months": `repeat(${months.length}, minmax(0, 1fr))` } as CSSProperties}
        >
          {months.map((month) => (
            <div key={month.label} className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#344054]">{month.label}</p>
              <div className="mt-1.5 grid grid-cols-7 gap-[2px]">
                {WEEKDAYS.map((day) => (
                  <abbr
                    key={day}
                    title={day}
                    className="text-center text-[9px] font-medium text-[#98a2b3] no-underline"
                  >
                    {day.slice(0, 1)}
                  </abbr>
                ))}
                {month.days.map((day, index) => (
                  <Square key={day?.day ?? `blank-${index}`} day={day} section={section} />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#667085]">
          {/* The months are the portal's: what it had when the section was first seen, and what it has now. */}
          <SourceMark source="portal" className="" />
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#cfe2ff]" /> unchanged
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#f8d7da]" /> removed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm bg-[#d1e7dd]" /> added
          </span>
          {both ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-[#d1e7dd] ring-2 ring-inset ring-[#e07c84]" /> arrived
              where one was removed the same day
            </span>
          ) : null}
          {knownCount ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-[#e9ecef]" />{" "}
              {coveredByUs === 0 ? "you had cancelled it" : cancelledByUs === 0 ? "you had covered it" : "you had cancelled or covered it"}
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "Tuesday 15 September 2026". */
function longDay(iso: string): string {
  const [year, month, date] = iso.split("-").map(Number);
  const made = new Date(year, month - 1, date);
  return Number.isNaN(made.getTime()) ? iso : `${LONG_DAYS[made.getDay()]} ${date} ${LONG_MONTHS[month - 1]} ${year}`;
}

/** One class on the hover card: its hours, how long, and where. */
function ClassLine({ meeting, tone, note }: { meeting: Meeting; tone: string; note?: string }) {
  const hours = Math.round((minutesOf(meeting) / 60) * 100) / 100;
  // What the room seats, as the Rooms page keeps it; read once and shared, so cheap per line.
  const { roomOf } = useRooms();
  const seats = meeting.room ? (roomOf(meeting.room)?.seats ?? null) : null;
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className={`font-semibold tabular-nums ${tone}`}>
        {meeting.startsAt}–{meeting.endsAt}
      </span>
      <span className="tabular-nums text-[#667085]">{hours} h</span>
      {meeting.room ? (
        <span className="text-[#344054]">
          room {formatRoom(meeting.room)}
          {seats !== null ? <span className="text-[#98a2b3]"> · {seats} seats</span> : null}
        </span>
      ) : null}
      {note ? <span className="text-[#98a2b3]">{note}</span> : null}
    </li>
  );
}

/**
 * Everything the day holds, on hover: which section, whose, and each class that still
 * meets, went or arrived — its hours, length and room. The square's colour says what
 * happened; this says to what.
 */
function DayCard({ day, section }: { day: DiffDay; section: ChangedClasses }) {
  const groups: { title: string; tone: string; meetings: Meeting[] }[] = [
    { title: "Removed", tone: "text-[#842029]", meetings: day.removed },
    { title: "Added", tone: "text-[#0f5132]", meetings: day.added },
    { title: "Still meets", tone: "text-[#084298]", meetings: day.kept },
  ];
  return (
    <div className="space-y-2">
      <div>
        <p className="font-semibold text-[#171717]">{longDay(day.day)}</p>
        <p className="text-[#344054]">
          {section.courseCode || "A section"}
          {section.title ? ` · ${section.title}` : ""} · CRN {section.crn}
        </p>
        <p className="text-[#667085]">{section.teacherName || "Nobody named on the portal"}</p>
      </div>
      {groups
        .filter((group) => group.meetings.length)
        .map((group) => (
          <div key={group.title}>
            <p className={`text-[11px] font-semibold uppercase tracking-wide ${group.tone}`}>{group.title}</p>
            <ul className="mt-0.5 space-y-0.5">
              {group.meetings.map((meeting) => (
                <ClassLine
                  key={`${meeting.startsAt}|${meeting.room}`}
                  meeting={meeting}
                  tone={group.tone}
                  note={oursSaid(meeting) || undefined}
                />
              ))}
            </ul>
          </div>
        ))}
      {!day.removed.length && !day.added.length && !day.kept.length ? (
        <p className="text-[#98a2b3]">No class of this section, before or now.</p>
      ) : null}
    </div>
  );
}

function Square({ day, section }: { day: DiffDay | null; section: ChangedClasses }) {
  if (!day) return <span className="aspect-square w-full" />;
  const gone = day.removed.length > 0;
  const arrived = day.added.length > 0;
  const meets = day.kept.length > 0;
  // Grey where the department cancelled it: a gap it already knew about, drawn so the
  // month still reads as a month, but not in the colour that means "look at this".
  const ours = gone && day.removed.every(known);
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
          : day.outside
            ? "text-[#d5dce4]"
            : "text-[#98a2b3]";
  const also = arrived && gone ? " ring-2 ring-inset ring-[#e07c84]" : "";
  const said = [
    gone ? `${day.removed.length} class${day.removed.length === 1 ? "" : "es"} removed` : "",
    ours ? (day.removed.every((meeting) => meeting.weCancelled) ? "which you had cancelled" : "which you had cancelled or covered") : "",
    arrived ? `${day.added.length} added` : "",
    meets ? "still meets" : "",
  ].filter(Boolean);
  const square = (
    <span
      tabIndex={said.length ? 0 : undefined}
      aria-label={said.length ? `${day.day}: ${said.join(", ")}` : day.day}
      className={`flex aspect-square w-full items-center justify-center rounded-[3px] text-[10px] font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79] ${paint}${also} ${gone && !arrived ? "line-through" : ""}`}
    >
      {day.dayOfMonth}
    </span>
  );
  // A day with nothing on it has nothing to say on hover either.
  if (!said.length) return square;
  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{square}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={6}
            collisionPadding={12}
            className="z-[130] w-72 max-w-[calc(100vw-2rem)] rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-xs leading-5 text-[#475467] shadow-lg"
          >
            <DayCard day={day} section={section} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
