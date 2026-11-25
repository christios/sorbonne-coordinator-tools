import {
  AlertTriangle,
  Check,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  Pencil,
  Plus,
  Repeat,
  StickyNote,
  Timer,
  UserRound,
  Wand2,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { InfoTip, TipButton, TipDo, TipPage, TipPill, TipPoint, TipUsage } from "@/components/InfoTip";
import { GroupRoster } from "@/components/GroupRoster";
import { SectionDialog } from "@/components/CourseCard";
import { CourseRecord } from "@/components/CourseRecord";
import { UnlinkedTermWarning } from "@/components/PortalTermLink";
import { YearPill } from "@/components/YearPill";
import { type Card, type CardSet, type SectionRow, cardSeats, partRow, rowKey, teaches } from "@/services/courseCards";
import { componentOf, figure, hoursIn, type CoursePlan } from "@/services/coursePlans";
import type { Request } from "@/services/studentDatabase";
import { MUTUALIZED_WORDS, type ActiveTeacher, type TermCrns } from "@/services/portalLists";
import type { GroupClash } from "@/services/publication";
import type { MissingFrom } from "@/services/publicationView";
import { ALL_COHORTS, EMPTY_PART, partsOf, type Cohort, type SectionPart } from "@/services/studentDatabase";

const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * A row's facts as pills (user, 25 Nov 2026): its hours, session length, sessions a week and
 * weeks each in their own, the seats and exempt count too, instead of one grey line of
 * figures run together and cut off at the end.
 */
const PILL = "inline-flex min-w-0 max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium";
const TONE = {
  plain: "bg-[#f2f4f7] text-[#475467]",
  warn: "bg-[#fdf6e3] text-[#8a6116]",
  danger: "bg-[#fdf3f3] text-[#a6292f]",
  gone: "bg-[#f8fafc] text-[#c8d0da]",
} as const;

/**
 * How full a group is: grey room left, green exactly full, red over — a room that will not
 * hold the class. Only the two that ask something of you take a colour.
 */
const SEATS = {
  over: "bg-[#fdf3f3] text-[#a6292f]",
  full: "bg-[#eaf5ee] text-[#2e7d55]",
  room: "bg-[#f2f4f7] text-[#344054]",
  unset: "bg-[#f8fafc] text-[#b7bec8]",
} as const;

/** Which of the four readings this group is: the same words Capacity uses. */
function seatsVerdict(placed: number, seats: number): keyof typeof SEATS {
  if (!seats) return "unset";
  if (placed > seats) return "over";
  if (placed === seats) return "full";
  return "room";
}

/**
 * The group's seats at the end of its row's first line: students placed over seats in a
 * pill coloured by how full it is, and beside it how many of the group don't take the course.
 */
function Seats({ placed, seats, exempt, dim }: { placed: number; seats: number; exempt: number; dim: boolean }) {
  const verdict = seatsVerdict(placed, seats);
  return (
    <span className="flex items-center justify-end gap-1 whitespace-nowrap @lg:gap-1.5">
      {exempt ? (
        <span
          title={`${exempt} of the group's students don't take this course`}
          className={`${PILL} border border-dashed ${dim ? "border-[#eef1f5] text-[#d5dce4]" : "border-[#c8d0da] text-[#98a2b3]"}`}
        >
          {exempt} exempt
        </span>
      ) : null}
      <span
        title={seats ? `${placed} of ${seats} seats taken` : `${placed} placed, no capacity set`}
        className={`${PILL} justify-center text-xs font-semibold tabular-nums @lg:min-w-[4.5rem] ${dim ? TONE.gone : SEATS[verdict]}`}
      >
        {placed}
        <span className="px-0.5 opacity-50">/</span>
        {seats || "—"}
      </span>
    </span>
  );
}

/** "room 12 · avoid Fridays" — what a section asks of the timetable, in one line. */
function asks(section: SectionPart): string {
  return [section.roomPref, section.dayPref, section.timePref, section.constraints, section.comments]
    .filter(Boolean)
    .join(" · ");
}

/**
 * A section's hours and session length as its row shows them: its own, else the course's —
 * an undivided section only, since a part of a divided one carries its own share — and where
 * its own differ from what the course asks.
 */
function shownOf(part: SectionPart, course: Request | undefined) {
  return {
    hours: part.hours || course?.hours || "",
    hoursInherited: !part.hours && Boolean(course?.hours),
    duration: part.duration || course?.duration || "",
    durationInherited: !part.duration && Boolean(course?.duration),
    overrides: course ? differences(part.hours, part.duration, course) : [],
  };
}

/**
 * Where a section's own hours or session length differ from what the course asks: "Its own
 * 45 h — the course asks 50 h". Figures that read the same ("50", "50 h") are not a difference.
 */
function differences(hours: string, duration: string, course: Request): string[] {
  const said: string[] = [];
  const own = hoursIn(hours);
  const asked = hoursIn(course.hours);
  if (hours && course.hours && (own === null || asked === null ? hours.trim() !== course.hours.trim() : Math.abs(own - asked) > 0.001)) {
    said.push(`Its own ${own === null ? hours : `${figure(own)} h`} — the course asks ${asked === null ? course.hours : `${figure(asked)} h`}`);
  }
  const length = hoursIn(duration);
  const usual = hoursIn(course.duration);
  if (duration && course.duration && (length === null || usual === null ? duration.trim() !== course.duration.trim() : Math.abs(length - usual) > 0.001)) {
    said.push(`sessions of ${duration} h — the course's are ${course.duration} h`);
  }
  return said;
}

/**
 * What one stretch of teaching asks, as its row reads it: the hours and session length it
 * shows (the course's where it says none), how often and in which weeks, and its note.
 */
type Asked = { hours: string; duration: string; perWeek: string; weeks: string; note: string };

function askedOf(part: SectionPart, course: Request | undefined): Asked {
  const shown = shownOf(part, course);
  return { hours: shown.hours, duration: shown.duration, perWeek: part.sessionsPerWeek, weeks: part.weeks, note: asks(part) };
}

/** The words for one figure on a row; a row without hours says so, as a load is counted from them. */
function said(key: keyof Asked, value: string): string {
  if (key === "hours") return value ? `${hoursIn(value) === null ? value : figure(hoursIn(value) ?? 0)} h` : "no hours";
  if (key === "duration") return value ? `${value} h sessions` : "";
  // "2" reads "2/week"; "1 session a week" is said as typed.
  if (key === "perWeek") return value ? (/week/i.test(value) ? value.trim() : `${value.trim()}/week`) : "";
  if (key === "weeks") return value ? (/week/i.test(value) ? value.trim() : `weeks ${value.trim()}`) : "";
  return value;
}

/**
 * The columns a set's rows share: group, CRN, teacher, its figures, seats, the eye.
 *
 * Every row says its own hours, session length, weeks and note, even where the whole set
 * shares them (user, 24 Nov 2026). They were lifted to the set's line for a while when most
 * sections agreed, which put the same figure on the set's line in one set and in the rows
 * of the next; the columns line up, so a row that differs is still found by reading down.
 *
 * Free text never wraps a row (user, 24 Nov 2026): a teacher's name, a section's own weeks
 * and its note each take one line, cut short with an ellipsis, and say the whole on hover.
 * "3 sessions (weeks 1, 2, 3, 6), 3 sessions (weeks 4, 5)…" otherwise took the teacher's
 * column for itself.
 *
 * Aligned columns where the list is wide enough; on a phone each row wraps instead, its
 * seats pushed to the right of the first line, so nothing is cut off.
 *
 * Laid out as a card (user, 25 Nov 2026): the group, its CRN in a box, the teacher, and the
 * seats on the first line; the figures as pills under the CRN; the note in a box of its own.
 */
const ROW_COLUMNS =
  "flex flex-col @lg:grid @lg:grid-cols-[max-content_max-content_minmax(6rem,1fr)_max-content_max-content_max-content_max-content] @lg:gap-x-3";

/**
 * Each kind of figure its own look and place (user, 25 Nov 2026): hours a solid pill and the
 * session length an outlined one, in their own columns on the first line so they line up down
 * the set; sessions a week and weeks tinted pills under it; the note a line ruled in amber.
 * They were all the same grey pill, one after another, and read as one.
 */
const FIGURE = {
  hours: "bg-[#e3ecf7] font-semibold text-[#1f4e79]",
  duration: "border border-[#cfd6df] bg-white text-[#475467]",
  perWeek: "bg-[#efeefe] text-[#3c3489]",
  weeks: "bg-[#e6f4ee] text-[#085041]",
  warn: "bg-[#fdf6e3] font-semibold text-[#8a6116]",
} as const;

/**
 * A part's number at the start of its line, ① ② on a line joining them (user, 25 Nov 2026),
 * so the parts of a section read as one teaching in turn, not as unrelated rows. The joining
 * line runs from one number to the next where the list has columns; on a phone the numbers
 * stand alone.
 */
function PartMarker({ number, first, last, gone }: { number: number; first: boolean; last: boolean; gone: boolean }) {
  return (
    // Against the CRN, at the end of the group's column, so "① 23904 Sudarshan Shinde" reads as one.
    <span className="relative inline-flex items-start @lg:row-span-2 @lg:justify-end @lg:self-stretch">
      <span
        aria-hidden="true"
        className={`absolute right-[8.5px] hidden w-px bg-[#c8d3df] @lg:block ${first ? "top-3" : "-top-1"} ${last ? "h-4" : "-bottom-2"} ${
          first && last ? "!hidden" : ""
        }`}
      />
      <span
        className={`relative z-[1] mt-[2px] inline-flex size-[18px] items-center justify-center rounded-full border bg-white text-[10px] font-semibold tabular-nums ${
          gone ? "border-[#e4e8ef] text-[#c8d0da]" : "border-[#b7c6d8] text-[#1f4e79]"
        }`}
        title={`Part ${number}`}
      >
        {number}
      </span>
    </span>
  );
}

/**
 * One stretch of a section's teaching, as a row of its set's list.
 *
 * For the ordinary section — one professor, first week to last — this is the whole row: the
 * group, its CRN, the teacher and the seats on the first line, its figures and note under it.
 *
 * For a section taught in parts it is one numbered part under the group's own line, which
 * carries the name, the seats and whether the parts' hours add up (user, 25 Nov 2026). Each
 * part has its CRN, teacher, own hours, the course's session length and its note, and is
 * pressed and edited on its own. The first part used to be the group's line and the second a
 * grey "part 2" under it, which read as two unrelated rows; and neither said its session
 * length, which a part takes from the course like any section.
 */
function PartRow({
  row,
  part,
  index,
  count,
  dim,
  teacherName,
  portal,
  teacherDrift,
  onEdit,
  onShowGroup,
}: {
  row: SectionRow;
  part: SectionPart;
  index: number;
  /** How many parts the section has: one for the ordinary section. */
  count: number;
  dim: boolean;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  teacherDrift: Set<string>;
  onEdit: () => void;
  onShowGroup?: () => void;
}) {
  const split = count > 1;
  const gone = dim || part.retired;
  const name = `${row.scope.code} ${row.group.label}`;
  const label = `${name} ${row.course.code}`;
  const portalRow = portal && part.crn ? (portal.crns[part.crn] ?? null) : undefined;
  const chosen = part.teacherId ? teacherName(part.teacherId) : "";
  // The course's hours and session length unless the section says its own. A part of a
  // divided section carries its own share of the hours, so it takes only the session length.
  const course = split ? { ...row.course.request, hours: "" } : row.course.request;
  const shown = shownOf(part, course);
  const asked = askedOf(part, course);
  const drifted = Boolean(part.crn) && teacherDrift.has(part.crn);
  const { seats, placed } = cardSeats(row);

  // Its figures, amber where the course asks otherwise.
  const own = (["hours", "duration", "perWeek", "weeks"] as const)
    .map((key) => ({ key, words: said(key, asked[key]) }))
    .filter((each) => each.words);
  const ownNote = asked.note;
  const warn = shown.overrides.length && !gone;
  const hoursWords = own.find((each) => each.key === "hours")?.words ?? "";
  // Amber where the section's own figure is not what the course asks.
  const hoursOff = shown.overrides.some((each) => each.startsWith("Its own"));
  const durationOff = shown.overrides.some((each) => each.startsWith("sessions of"));
  // The session length's own hover: what it is, and where it is not the course's.
  const durationTitle = asked.duration
    ? [
        `${asked.duration} h sessions${shown.durationInherited ? `, from what the course asks: the ${split ? "part" : "section"} says none of its own` : ""}`,
        ...shown.overrides.filter((each) => each.startsWith("sessions of")),
      ].join("\n")
    : undefined;
  const pattern = own.filter((each): each is { key: "perWeek" | "weeks"; words: string } => each.key === "perWeek" || each.key === "weeks");
  // The whole of the figures on hover, with where they differ from the course and whose they are.
  const figuresTitle = own.length
    ? [
        own.map((each) => each.words).join(" · "),
        ...(warn ? shown.overrides : []),
        ...own.flatMap((each) =>
          (each.key === "hours" && shown.hoursInherited) || (each.key === "duration" && shown.durationInherited)
            ? [`${each.words}, from what the course asks: the ${split ? "part" : "section"} says none of its own`]
            : [],
        ),
      ].join("\n")
    : undefined;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit();
        }
      }}
      // Numbered as they are read, top to bottom: the parts keep no order of their own.
      aria-label={split ? `Edit ${label}, part ${index + 1}` : `Edit ${label}`}
      className={`group flex flex-wrap items-center gap-x-1.5 gap-y-1.5 px-2.5 text-left text-sm hover:bg-[#f6f8fb] @lg:col-span-full @lg:gap-x-3 @lg:px-3 @lg:grid @lg:grid-cols-subgrid @lg:gap-y-1.5 ${
        split ? `pt-1 ${index === count - 1 ? "pb-2.5" : "pb-2"}` : "py-2.5"
      }`}
    >
      {split ? (
        <PartMarker number={index + 1} first={index === 0} last={index === count - 1} gone={gone} />
      ) : (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={`font-semibold ${gone ? "text-[#c8d0da]" : "text-[#171717]"}`}>{name}</span>
          {part.retired && !dim ? <span className={`${chip} bg-[#f8fafc] text-[#c8d0da]`}>retired</span> : null}
        </span>
      )}

      <span className="whitespace-nowrap tabular-nums">
        {part.crn ? (
          <span
            className={`rounded-md border px-1.5 py-px text-xs ${gone ? "border-[#eef1f5] text-[#c8d0da]" : "border-[#d9dee7] bg-white text-[#475467]"}`}
          >
            {part.crn}
          </span>
        ) : gone ? null : (
          <span className={`${PILL} ${TONE.danger} font-semibold`}>no CRN</span>
        )}
      </span>

      <span
        className="inline-flex min-w-0 max-w-full items-center gap-1.5"
        title={chosen || (part.teacher ? `${part.teacher}, not confirmed: named on the row, but not chosen from Active teachers yet` : "Nobody teaches it yet")}
      >
        <UserRound size={13} aria-hidden="true" className={`shrink-0 ${gone ? "text-[#e4e8ef]" : chosen || part.teacher ? "text-[#98a2b3]" : "text-[#c79a3a]"}`} />
        <span className="min-w-0 truncate">
          {chosen ? (
            <span className={gone ? "text-[#c8d0da]" : "text-[#344054]"}>{chosen}</span>
          ) : part.teacher ? (
            <span className={gone ? "text-[#c8d0da]" : "text-[#667085]"}>
              {part.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
            </span>
          ) : (
            <span className={gone ? "text-[#d5dce4]" : "font-medium text-[#8a6116]"}>nobody yet</span>
          )}
        </span>
      </span>

      {/* On a phone the figures start a line of their own, so every card breaks in the same place. */}
      <span aria-hidden="true" className="h-0 basis-full @lg:hidden" />

      <span className="flex justify-end tabular-nums" title={figuresTitle}>
        {hoursWords === "no hours" ? (
          <span className={`${PILL} border border-dashed border-[#d9dee7] text-[#98a2b3]`}>no hours</span>
        ) : hoursWords ? (
          <span className={`${PILL} text-xs ${gone ? TONE.gone : hoursOff ? FIGURE.warn : FIGURE.hours}`}>
            {hoursOff && !gone ? <AlertTriangle size={11} aria-hidden="true" className="shrink-0" /> : <Clock3 size={11} aria-hidden="true" className="shrink-0" />}
            {hoursWords}
          </span>
        ) : null}
      </span>
      <span className="flex tabular-nums" title={durationTitle}>
        {asked.duration ? (
          <span className={`${PILL} ${gone ? TONE.gone : durationOff ? FIGURE.warn : FIGURE.duration}`}>
            {durationOff && !gone ? <AlertTriangle size={11} aria-hidden="true" className="shrink-0" /> : null}
            {asked.duration} h each
          </span>
        ) : null}
      </span>

      {/* The group's seats and roster are the group's line's, when the section has parts. */}
      {split ? (
        <span className="hidden @lg:block" />
      ) : (
        <span className="ml-auto flex justify-end @lg:ml-0">
          <Seats placed={placed} seats={seats} exempt={row.exempt ?? 0} dim={dim} />
        </span>
      )}

      <span className={`inline-flex items-center gap-0.5 ${split ? "ml-auto @lg:ml-0" : ""}`}>
        {/*
          * Who is in this group — its own button rather than the row's press, which opens
          * the editor: looking at a group is not editing it.
          */}
        {!split && onShowGroup ? <WhoButton name={name} onShowGroup={onShowGroup} /> : <span className="w-[17px]" />}
        {/* Shown on hover, which a touch screen has none of. */}
        <Pencil size={13} className="hidden shrink-0 text-transparent group-hover:text-[#98a2b3] @lg:block" aria-hidden="true" />
      </span>

      {/*
        * Under the first line, from the CRN's column: the figures as pills, what the portal
        * says otherwise, and the note in a box of its own.
        */}
      <span className="flex min-w-0 basis-full flex-col items-start gap-1.5 @lg:col-start-2 @lg:col-end-[-1] @lg:basis-auto">
        {pattern.length || (part.crn && portalRow === null) || (portalRow?.teacherName && drifted) || (split && part.retired && !dim) ? (
          <span className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 tabular-nums" title={pattern.map((each) => each.words).join(" · ") || undefined}>
            {split && part.retired && !dim ? <span className={`${PILL} ${TONE.gone}`}>retired</span> : null}
            {pattern.map((each) => {
              const Icon = each.key === "perWeek" ? Repeat : CalendarDays;
              return (
                <span key={each.key} className={`${PILL} ${gone ? TONE.gone : FIGURE[each.key]}`}>
                  <Icon size={11} aria-hidden="true" className="shrink-0" />
                  <span className="min-w-0 truncate">{each.words}</span>
                </span>
              );
            })}
            {part.crn && portalRow === null ? (
              <span className={`${PILL} ${TONE.danger}`}>Not in the portal&apos;s list for this semester.</span>
            ) : null}
            {portalRow?.teacherName && drifted ? (
              <span className={`${PILL} ${TONE.plain}`} title="The portal names another teacher for this CRN">
                Portal: {portalRow.teacherName}
              </span>
            ) : null}
          </span>
        ) : null}
        {ownNote ? (
          <span
            title={ownNote}
            className={`flex min-w-0 max-w-full items-center gap-1.5 border-l-2 py-px pl-2 text-xs ${
              gone ? "border-[#eef1f5] text-[#d5dce4]" : "border-[#e9c46a] text-[#667085]"
            }`}
          >
            <StickyNote size={12} aria-hidden="true" className="shrink-0 text-[#c79a3a]" />
            <span className="min-w-0 truncate">{ownNote}</span>
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** The eye at the end of a group's line: who is in it. */
function WhoButton({ name, onShowGroup }: { name: string; onShowGroup: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Who is in ${name}`}
      title="Who is in this group"
      onClick={(event) => {
        event.stopPropagation();
        onShowGroup();
      }}
      className="shrink-0 rounded p-0.5 text-[#c8d0da] hover:bg-[#eef1f5] hover:text-[#1f4e79]"
    >
      <Eye size={13} aria-hidden="true" />
    </button>
  );
}

/**
 * Whether a section's parts add up to what the course asks, on the group's line: green when
 * they do, amber when they don't or when a part says no hours.
 */
function PartsHours({ together, asked, dim }: { together: number | null; asked: number | null; dim: boolean }) {
  if (together === null) {
    return (
      <span className={`${PILL} ${dim ? TONE.gone : TONE.warn}`} title="A part says no hours, so the section's load can't be counted">
        <AlertTriangle size={11} aria-hidden="true" className="shrink-0" /> Not every part has hours
      </span>
    );
  }
  if (asked === null) {
    return <span className={`${PILL} ${dim ? TONE.gone : TONE.plain}`}>{figure(together)} h in all</span>;
  }
  const adds = Math.abs(together - asked) <= 0.001;
  return (
    <span
      className={`${PILL} ${dim ? TONE.gone : adds ? "bg-[#eaf5ee] text-[#2e7d55]" : `${TONE.warn} font-semibold`}`}
      title={adds ? `Its parts make ${figure(together)} h, what the course asks` : `Its parts make ${figure(together)} h — the course asks ${figure(asked)} h`}
    >
      {adds ? <Check size={11} aria-hidden="true" className="shrink-0" /> : <AlertTriangle size={11} aria-hidden="true" className="shrink-0" />}
      {figure(together)} h of the course&apos;s {figure(asked)} h
    </span>
  );
}

/**
 * One section, as a row of its set's list (user, 24 Nov 2026).
 *
 * The cards before it sat two or three abreast, each repeating the set's hours, session length
 * and note, with the CRN, the teacher and the seats in a different place on each. As rows the
 * set reads down: every CRN under the one above, every teacher, every seat count.
 */
function SectionRows({
  row,
  teacherName,
  portal,
  teacherDrift,
  onEdit,
  onShowGroup,
}: {
  row: SectionRow;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  teacherDrift: Set<string>;
  /** Which stretch of teaching to open — the section itself when it has only one. */
  onEdit: (part: SectionPart | null) => void;
  onShowGroup?: () => void;
}) {
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;

  if (row.notTaught) {
    // A sub-row's word that it is not taught this course: no class, no CRN wanted, not a gap.
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => onEdit(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onEdit(null);
          }
        }}
        aria-label={`Edit ${label}`}
        className="flex flex-wrap items-center gap-x-3 border-t border-[#eef1f5] px-3 py-2 text-sm first:border-t-0 hover:bg-[#f6f8fb] @lg:col-span-full @lg:grid @lg:grid-cols-subgrid"
      >
        <span className="font-semibold text-[#c8d0da]">
          {row.scope.code} {row.group.label}
        </span>
        <span className="text-xs text-[#98a2b3] @lg:col-span-5">Not taught to this sub-row.</span>
      </div>
    );
  }

  const name = `${row.scope.code} ${row.group.label}`;
  const parts = partsOf(row.section);
  const held = parts.length ? parts : [EMPTY_PART];
  const split = parts.length > 1;
  // Dim the whole section only when NOTHING it teaches is still running.
  const dim = parts.length > 0 && parts.every((part) => part.retired);
  // Its parts' hours together, against what the course asks, when every live part says some.
  const live = parts.filter((part) => !part.retired);
  const together = live.length && live.every((part) => hoursIn(part.hours) !== null)
    ? live.reduce((sum, part) => sum + (hoursIn(part.hours) ?? 0), 0)
    : null;
  const asked = hoursIn(row.course.request.hours);
  const { seats, placed } = cardSeats(row);

  return (
    <article
      aria-label={label}
      className={`flex flex-col border-t border-[#eef1f5] first:border-t-0 @lg:col-span-full @lg:grid @lg:grid-cols-subgrid ${dim ? "bg-[#fdfefe]" : ""}`}
    >
      {split ? (
        // The group's own line: its name, how its parts' hours add up, its seats and roster.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pb-1.5 pt-2.5 text-sm @lg:col-span-full @lg:grid @lg:grid-cols-subgrid">
          <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 @lg:col-span-5">
            <span className={`whitespace-nowrap font-semibold ${dim ? "text-[#c8d0da]" : "text-[#171717]"}`}>{name}</span>
            <span className={`${chip} bg-[#eef4fa] text-[#1f4e79]`} title="Taught in more than one stretch, by more than one person">
              {parts.length} parts
            </span>
            {live.length ? <PartsHours together={together} asked={asked} dim={dim} /> : null}
            {dim ? <span className={`${chip} bg-[#f8fafc] text-[#c8d0da]`}>retired</span> : null}
          </span>
          <span className="ml-auto flex justify-end @lg:ml-0">
            <Seats placed={placed} seats={seats} exempt={row.exempt ?? 0} dim={dim} />
          </span>
          <span className="inline-flex items-center gap-0.5">
            {onShowGroup ? <WhoButton name={name} onShowGroup={onShowGroup} /> : <span className="w-[17px]" />}
            <span className="w-[13px]" />
          </span>
        </div>
      ) : null}
      {held.map((part, index) => (
        <PartRow
          key={part.part}
          row={row}
          part={part}
          index={index}
          count={held.length}
          dim={dim}
          teacherName={teacherName}
          portal={portal}
          teacherDrift={teacherDrift}
          onEdit={() => onEdit(row.section ? part : null)}
          onShowGroup={onShowGroup}
        />
      ))}
    </article>
  );
}

/** A set's sections, one row each, in columns the rows share, inside the set's box. */
function SectionList({ children, faded = false }: { children: ReactNode; faded?: boolean }) {
  return (
    <div className={`@container ${faded ? "border-t border-dashed border-[#e4e8ef] bg-[#fcfcfd]" : ""}`}>
      <div className={ROW_COLUMNS}>{children}</div>
    </div>
  );
}

/**
 * A set's share of its course's plan gone wrong, said on the set's line — "No session length in
 * Groups & CRNs yet" — and fixed in the course's record, which the tag opens.
 */
function PlanIssue({ plan, component: said, onOpen }: { plan: CoursePlan | null | undefined; component: string; onOpen: () => void }) {
  const component = componentOf({ component: said });
  const held = plan && component ? plan.components[component] : null;
  const differing = held?.exceptions?.length ?? 0;
  // A problem first; else how many sections carry a figure of their own.
  const issue = held?.issue || (differing ? `${differing} section${differing === 1 ? "" : "s"} differ${differing === 1 ? "s" : ""} from the course` : "");
  if (!issue) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${issue}. Open the course to set what this set asks.`}
      className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[#fdf6e3] px-2 py-0.5 text-[11px] font-semibold text-[#8a6116] hover:underline"
    >
      <AlertTriangle size={11} aria-hidden="true" /> {issue}
    </button>
  );
}

/**
 * One course, in full: its sets, and under each the sections anybody teaches of it.
 *
 * Everything this course has to say is said here, where there is room to say it — which
 * is the whole point of choosing one course at a time rather than opening fifteen boxes.
 * The course's own facts (title, UE, whether it is mutualized) are the active course's
 * and are changed on the Courses page, not here; what is changed here is a section.
 */
export function CourseDetail({
  card,
  cohort,
  teachers,
  portal,
  teacherDrift,
  unassigned,
  clashes,
  action,
  onChanged,
  onFilled,
  onPlaceStudents,
  coursePlan,
  coursePlanTerm = "",
}: {
  card: Card;
  /** The course's plan in the card's semester — its hours, lead and weeks — when it has one. */
  coursePlan?: CoursePlan | null;
  /** The card's semester as the portal numbers it, which the plan is kept by. */
  coursePlanTerm?: string;
  cohort: Cohort | null;
  /** Something the whole semester's request needs, shown where the semester is named. */
  action?: ReactNode;
  teachers: ActiveTeacher[];
  portal: TermCrns | null;
  /**
   * The CRNs where the registrar names somebody other than our planning does — the
   * server's verdict, not a string compare made here.
   *
   * This card used to decide for itself, by asking whether the portal's teacher column
   * was character-for-character what we had chosen. On the real data that says "Portal:
   * ..." under twenty-six sections, and five of the eleven distinct pairs behind them are
   * nothing but where the space falls in a surname. The rule that knows better lives on
   * the server because the register check needs it too, and two copies of a rule like
   * that drift apart.
   */
  teacherDrift: Set<string>;
  /** Who each set still needs, by cohort: one cohort for a cohort's course, every cohort for All cohorts'. */
  unassigned: Record<string, MissingFrom[]>;
  clashes: GroupClash[] | null;
  onChanged: () => void;
  onFilled: (report: FillReport) => void;
  /** Open the Cohorts page on exactly these ids — how "3 in no group" is answered. */
  onPlaceStudents?: (cohortId: string, studentIds: string[]) => void;
}) {
  const [editing, setEditing] = useState<SectionRow | null>(null);
  // Which group's students are being looked at, if any.
  const [showingGroup, setShowingGroup] = useState<SectionRow | null>(null);
  const [filling, setFilling] = useState<CardSet | null>(null);
  // Which set's course line is being written, if any: one per set, as the hours differ.
  /*
   * The course's record, opened with the pen by its name (23 Nov 2026): its facts (UE,
   * coefficient, mutualized), what each set asks of it, its lead and its weeks — set there,
   * so the sets below show their sections and nothing else.
   */
  const [recordOpen, setRecordOpen] = useState(false);
  const [showingRetired, setShowingRetired] = useState<Record<string, boolean>>({});
  const teacherName = (id: string) => teachers.find((teacher) => teacher.id === id)?.fullName ?? "";

  return (
    /*
      * The course's name stays put while its sets scroll under it — a card twelve sections
      * long otherwise leaves you reading a list of groups with no way to tell whose.
      */
    <section className="flex min-w-0 flex-col rounded-lg border border-[#d9dee7] bg-white lg:h-full lg:min-h-0">
      <header className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1.5 border-b border-[#eef1f5] px-5 py-4">
        <h3 className="text-lg font-semibold tabular-nums text-[#171717]">{card.code}</h3>
        <button
          type="button"
          onClick={() => setRecordOpen(true)}
          aria-label={`Edit ${card.code}: its facts, what it asks, its lead and its weeks`}
          title="The course: its UE, coefficient and mutualized, what each set asks, its lead and its weeks"
          className="self-center rounded-md p-1 text-[#475467] hover:bg-[#eef4fa] hover:text-[#1f4e79] focus-visible:outline-2 focus-visible:outline-[#1f4e79]"
        >
          <Pencil size={15} aria-hidden="true" />
        </button>
        <p className="text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</p>
        {card.ue ? <span className="text-xs tabular-nums text-[#98a2b3]">{card.ue}</span> : null}
        {card.active?.mutualized ? (
          <span
            title="Set on the course's own record: press the pen by its name"
            className={`${chip} ${card.active.mutualized === "yes" ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"}`}
          >
            {MUTUALIZED_WORDS[card.active.mutualized]}
          </span>
        ) : null}
        {!card.active ? (
          <span className={`${chip} bg-[#fdf9ee] text-[#8a6116]`} title="Choose it on the Courses page so it carries a UE and a parent CRN">
            Not on the active list
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-3">
          <span className="inline-flex items-center gap-2 text-xs text-[#98a2b3]">
            {card.cohortName} · {card.termName || "no semester"}
            <YearPill year={cohort?.term ?? ""} />
          </span>
          {/* Said only when the semester has no portal term; see UnlinkedTermWarning. */}
          {card.termId ? <UnlinkedTermWarning termId={card.termId} /> : null}
          {action}
        </span>
      </header>

      <div className="relative space-y-4 px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-none">
        {card.sets.map((set) => {
          const missingByCohort = (unassigned[set.scope.code] ?? []).filter((each) => each.ids.length);
          const left = missingByCohort.reduce((sum, each) => sum + each.ids.length, 0);
          /*
           * A group that holds nothing for this course is not a section of it.
           *
           * The card draws a block per group of the set, and a set's groups need not all
           * take the same course — the Licence years split into a mathematics group and a
           * physics group, and each takes half the set's courses. Drawing the other half
           * as empty blocks invented sections nobody had asked the timetabler for. They
           * are offered under "add a section" instead, which is what they really are.
           *
           * A retired section is kept, because it is a fact about the year, and folded
           * away, because it is not a thing to read.
           */
          /*
           * A card per SECTION, with its parts inside it.
           *
           * A section handed from one professor to another at mid-semester is two stretches
           * of teaching under a CRN each. They were two cards for a while, and that was
           * wrong: they are one group teaching one course, so two cards split the group's
           * seats, its roster and its fullness away from half of its own teaching.
           *
           * Retired is read over every part, so a section whose first half is retired and
           * whose second half still runs is still a section that teaches.
           */
          const live = set.rows.filter((row) => row.section && !partsOf(row.section).every((part) => part.retired));
          const retired = set.rows.filter((row) => row.section && partsOf(row.section).every((part) => part.retired));
          // Offering to add a section in a group the course is not taught to is how the
          // empty cell got there in the first place.
          const spare = set.rows.filter((row) => !row.section && teaches(row));
          // Said not to be taught the course: no row, but pressable, so it can be taught again.
          const untaught = set.rows.filter((row) => row.notTaught);
          return (
            /*
             * A set is one box (user, 25 Nov 2026): a heading strip with what the set is and
             * its Fill, its sections, and a footer strip for the groups it has no section in.
             * The "not taught to" and "add a section in" lines floated between one set and the
             * next before, and read as belonging to either.
             */
            <div key={set.scope.id} className="overflow-hidden rounded-xl border border-[#d9dee7] bg-white">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[#eef1f5] bg-[#f8fafc] px-3 py-2 text-sm">
                <span className="rounded-md bg-[#e8eef6] px-2 py-0.5 font-semibold text-[#1f4e79]">{set.scope.code}</span>
                {set.scope.name && set.scope.name !== set.scope.code ? (
                  <span className="font-medium text-[#475467]">{set.scope.name}</span>
                ) : null}
                <span className={`${PILL} border border-[#e4e8ef] bg-white text-[#667085]`}>
                  {live.length} section{live.length === 1 ? "" : "s"}
                  {/* A component named after its set — "CM · CM" — says it twice. */}
                  {set.course.component && set.course.component !== set.scope.code ? ` · ${set.course.component}` : ""}
                </span>
                <PlanIssue plan={coursePlan} component={set.course.component || set.scope.code} onOpen={() => setRecordOpen(true)} />
                <InfoTip label="How to read a section row" title="Reading a section row">
                  <TipDo>Press a row to edit its CRN, teacher, hours and what it asks.</TipDo>
                  <TipPoint>
                    <TipButton icon={Clock3}>50 h</TipButton> <TipButton icon={Timer}>1.5 h each</TipButton> the section&apos;s hours and
                    session length, in their columns on the row&apos;s first line. Under them, how many sessions a week and which weeks,
                    and the note on the line ruled in amber. Long ones end in &hellip;; hover for the whole.
                  </TipPoint>
                  <TipPoint tone="caution">
                    <TipButton look="warn" icon={AlertTriangle}>45 h</TipButton> differs from what the course asks; the course&apos;s figure
                    is in the tooltip.
                  </TipPoint>
                  <TipPoint tone="serious">
                    <TipButton look="danger">no CRN</TipButton> the portal&apos;s CRN isn&apos;t entered yet.
                  </TipPoint>
                  <TipPoint tone="caution">
                    <b>not confirmed</b>: a teacher is named, but not chosen from <TipPage name="Active teachers" /> yet.{" "}
                    <b>nobody yet</b>: no teacher at all.
                  </TipPoint>
                  <TipPoint>
                    <b>30/33</b> at the end of a row&apos;s first line: students placed over seats. Grey is room left, green full, red
                    over. <b>1 exempt</b> beside it: a student of the group who doesn&apos;t take this course.
                  </TipPoint>
                  <TipPoint>
                    <TipButton icon={Eye}>who</TipButton> the eye, at the end of a row, lists who is in the group.
                  </TipPoint>
                  <TipUsage
                    when={<><TipPill>TD 1</TipPill> shows 38/30, in red.</>}
                    todo={<>Press the eye to see who is in it. Then press the row and raise its seats, or place some students in another TD.</>}
                    then={<>It turns green or blue, and the timetabler is told the real size.</>}
                    other={<><TipPill>CM A</TipPill> at 56/98 is blue: room left. Green is exactly full, with nothing to do.</>}
                  />
                </InfoTip>
                {set.scope.openToAll ? (
                  <span className={`${chip} bg-[#e8edf3] text-[#1f4e79]`}>Open to every cohort</span>
                ) : null}
                {left
                  ? /*
                     * The count is the question; the students are the answer.
                     *
                     * "6 in no group" told a coordinator there was work to do and then made
                     * them go and find who it was for, in a table of three thousand rows.
                     * Pressing it opens the Cohorts page on the cohort and exactly those
                     * six — that page being where a student is put into a block. All cohorts'
                     * sets say it once per cohort, each opening that cohort's page.
                     */
                    missingByCohort.map((each) => (
                      <button
                        key={each.cohortId}
                        type="button"
                        disabled={!onPlaceStudents}
                        onClick={() => onPlaceStudents?.(each.cohortId, each.ids)}
                        title={
                          onPlaceStudents
                            ? `Place the ${each.ids.length} student${each.ids.length === 1 ? "" : "s"} in no ${set.scope.code} group`
                            : undefined
                        }
                        className={`${chip} inline-flex items-center gap-1 bg-[#fdf9ee] text-[#8a6116] ${
                          onPlaceStudents ? "hover:bg-[#f9efd6] hover:underline" : "cursor-default"
                        }`}
                      >
                        <AlertTriangle size={11} aria-hidden="true" />{" "}
                        {card.cohortId === ALL_COHORTS ? `${each.cohortName} · ` : ""}
                        {each.ids.length} in no group
                      </button>
                    ))
                  : null}
                {cohort ? (
                  <button
                    type="button"
                    onClick={() => setFilling(set)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                  >
                    <Wand2 size={13} aria-hidden="true" /> Fill {set.scope.code}
                  </button>
                ) : null}
                {cohort ? (
                  <InfoTip label={`What Fill ${set.scope.code} does`} title={`Fill ${set.scope.code}`}>
                    <TipDo>
                      Press <TipButton icon={Wand2}>Fill {set.scope.code}</TipButton> to place students in this set&apos;s groups, all at
                      once.
                    </TipDo>
                    <TipPoint>Choose who: everyone not yet in this set, or only the students you pick.</TipPoint>
                    <TipPoint>Choose how: balanced, each to the least-full group, or packed, one group full before the next.</TipPoint>
                    <TipPoint>The plan shows who goes where before anything is saved.</TipPoint>
                    <TipPoint>
                      Only a few students? Press{" "}
                      <TipButton look="warn" icon={AlertTriangle}>
                        N in no group
                      </TipButton>{" "}
                      instead, to place them by hand.
                    </TipPoint>
                    <TipUsage
                      when={<>New students arrived, and <TipButton look="warn" icon={AlertTriangle}>6 in no group</TipButton> shows beside {set.scope.code}.</>}
                      todo={<>Fill {set.scope.code}: everyone not yet in this set, balanced. Check the plan, then confirm.</>}
                      then={<>Each goes to the least-full group; the report names anyone who couldn&apos;t be placed.</>}
                      other={<>Seven A0 language groups and fewer students than seats: choose <b>Packed</b>, so <TipPill>A0-F1</TipPill> fills before <TipPill>A0-F2</TipPill> and the last groups stay empty, ready to close.</>}
                    />
                  </InfoTip>
                ) : null}
              </div>

              {live.length ? (
                <SectionList>
                  {live.map((row) => (
                    <SectionRows key={rowKey(row)} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing(partRow(row, part))} onShowGroup={() => setShowingGroup(row)} />
                  ))}
                </SectionList>
              ) : (
                <p className="px-3 py-2.5 text-xs text-[#98a2b3]">
                  No section of {card.code} in {set.scope.code} yet{spare.length ? ": add one below." : "."}
                </p>
              )}

              {retired.length && showingRetired[set.scope.id] ? (
                <SectionList faded>
                  {retired.map((row) => (
                    <SectionRows key={rowKey(row)} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing(partRow(row, part))} onShowGroup={() => setShowingGroup(row)} />
                  ))}
                </SectionList>
              ) : null}

              {/* The set's footer: its retired sections, folded away, and the groups it has no section in. */}
              {retired.length || untaught.length || spare.length ? (
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[#eef1f5] bg-[#f8fafc] px-3 py-2 text-xs text-[#667085]">
                  {retired.length ? (
                    <button
                      type="button"
                      onClick={() => setShowingRetired((current) => ({ ...current, [set.scope.id]: !current[set.scope.id] }))}
                      aria-expanded={Boolean(showingRetired[set.scope.id])}
                      className="inline-flex items-center gap-1 font-medium text-[#98a2b3] hover:text-[#475467]"
                    >
                      {showingRetired[set.scope.id] ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                      {retired.length} retired
                    </button>
                  ) : null}

                  {untaught.length ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>Not taught to</span>
                      <InfoTip label="What not taught to means" title="Not taught to">
                        <TipDo>Press a group to teach it this course again.</TipDo>
                        <TipPoint>These sub-rows are marked as not taking the course: no class, and no CRN expected.</TipPoint>
                        <TipUsage
                          when={<>The physicists&apos; sub-row was marked not taught, and now takes the course after all.</>}
                          todo={<>Press it here, say it is taught, and give it its CRN.</>}
                          then={<>It gets a section row like the others.</>}
                        />
                      </InfoTip>
                      {untaught.map((row) => (
                        <button
                          key={rowKey(row)}
                          type="button"
                          onClick={() => setEditing(row)}
                          title="Press to change it, or to teach the course to this group again"
                          className="rounded-full border border-[#e4e8ef] bg-white px-2 py-0.5 font-medium text-[#98a2b3] line-through decoration-[#c8d0da] hover:border-[#1f4e79] hover:text-[#1f4e79] hover:no-underline"
                        >
                          {row.group.label}
                        </button>
                      ))}
                    </span>
                  ) : null}

                  {spare.length ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>Add a section in</span>
                      <InfoTip label="What add a section in means" title="Add a section">
                        <TipDo>Press a group to give it a section of this course.</TipDo>
                        <TipPoint>Groups of this set that have no section of the course yet.</TipPoint>
                        <TipUsage
                          when={<>A <TipPill>TD 4</TipPill> was added on <TipPage name="Group schema" />.</>}
                          todo={<>Press <TipPill>4</TipPill> here, then enter its CRN and teacher.</>}
                          then={<>TD 4 gets its own row, with its seats and hours.</>}
                        />
                      </InfoTip>
                      {spare.map((row) => (
                        <button
                          key={rowKey(row)}
                          type="button"
                          onClick={() => setEditing(row)}
                          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#b7bec8] bg-white px-2 py-0.5 font-medium text-[#475467] hover:border-[#1f4e79] hover:text-[#1f4e79]"
                        >
                          <Plus size={11} aria-hidden="true" />
                          {row.group.label}
                        </button>
                      ))}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {filling && cohort ? (
        <FillBlock
          open
          cohort={cohort}
          scope={filling.scope}
          clashes={clashes}
          onClose={() => setFilling(null)}
          onFilled={(report) => {
            setFilling(null);
            onFilled(report);
          }}
        />
      ) : null}

      {recordOpen ? (
        <CourseRecord
          open
          courseCode={card.code}
          planTerm={coursePlanTerm}
          planSemesterName={card.termName}
          onClose={() => {
            setRecordOpen(false);
            onChanged();
          }}
        />
      ) : null}

      {editing ? (
        <SectionDialog
          card={card}
          row={editing}
          teachers={teachers}
          portal={portal}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}

      {showingGroup && cohort ? (
        <GroupRoster
          open
          cohortId={cohort.id}
          cohortName={cohort.name}
          scopeId={showingGroup.scope.id}
          scopeCode={showingGroup.scope.code}
          semester={card.termId}
          groupId={showingGroup.group.id}
          groupLabel={showingGroup.group.label}
          /*
           * The courses of the set this group belongs to, not of the card on screen.
           *
           * The card is one course; a set teaches several, and a student exempt from one
           * of them is in the group for the rest. Reading the set means the roster can be
           * used for the whole of it in one pass rather than a course at a time.
           */
          courses={
            card.sets
              .find((entry) => entry.scope.id === showingGroup.scope.id)
              ?.scope.courses.map((course) => ({ id: course.id, code: course.code })) ?? []
          }
          onClose={() => setShowingGroup(null)}
        />
      ) : null}
    </section>
  );
}
