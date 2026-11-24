import { AlertTriangle, ChevronDown, ChevronRight, Clock3, Eye, Pencil, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { InfoTip, TipButton, TipDo, TipPage, TipPill, TipPoint, TipUsage } from "@/components/InfoTip";
import { GroupRoster } from "@/components/GroupRoster";
import { SectionDialog } from "@/components/CourseCard";
import { CourseRecord } from "@/components/CourseRecord";
import { UnlinkedTermWarning } from "@/components/PortalTermLink";
import { YearPill } from "@/components/YearPill";
import { type Card, type CardSet, type SectionRow, cardSeats, rowKey, teaches } from "@/services/courseCards";
import { componentOf, figure, hoursIn, type CoursePlan } from "@/services/coursePlans";
import type { Request } from "@/services/studentDatabase";
import { MUTUALIZED_WORDS, type ActiveTeacher, type TermCrns } from "@/services/portalLists";
import type { GroupClash } from "@/services/publication";
import type { MissingFrom } from "@/services/publicationView";
import { ALL_COHORTS, EMPTY_PART, partsOf, type Cohort, type SectionPart } from "@/services/studentDatabase";

const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * How full a group is, in the colours Capacity uses: blue room left, green exactly full,
 * red over — a room that will not hold the class.
 */
const SEATS = {
  over: { bar: "#a6292f", number: "text-[#a6292f]" },
  full: { bar: "#2e7d55", number: "text-[#2e7d55]" },
  room: { bar: "#1f4e79", number: "text-[#344054]" },
  unset: { bar: "#e4e8ef", number: "text-[#b7bec8]" },
} as const;

/** Which of the four readings this group is: the same words Capacity uses. */
function seatsVerdict(placed: number, seats: number): keyof typeof SEATS {
  if (!seats) return "unset";
  if (placed > seats) return "over";
  if (placed === seats) return "full";
  return "room";
}

/**
 * The group's seats at the end of its row: students placed over seats, and a bar beside
 * them, so the rows of a set read as a column of how full each class is (user, 24 Nov 2026).
 * The bar goes on a narrow screen; the figures stay.
 */
function Seats({ placed, seats, exempt, dim }: { placed: number; seats: number; exempt: number; dim: boolean }) {
  const verdict = seatsVerdict(placed, seats);
  const share = seats ? Math.min(1, placed / seats) : 0;
  return (
    <span className="flex items-center justify-end gap-2 whitespace-nowrap">
      {exempt ? (
        <span
          title={`${exempt} of the group's students don't take this course`}
          className={`text-[11px] font-semibold ${dim ? "text-[#d5dce4]" : "text-[#8a6116]"}`}
        >
          {exempt} exempt
        </span>
      ) : null}
      <span aria-hidden="true" className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-[#eef1f5] @lg:block">
        <span
          className="block h-full rounded-full"
          style={{ width: `${share * 100}%`, backgroundColor: dim || placed === 0 ? "#e4e8ef" : SEATS[verdict].bar }}
        />
      </span>
      <span
        title={seats ? `${placed} of ${seats} seats taken` : `${placed} placed, no capacity set`}
        className={`min-w-[3.25rem] text-right text-[13px] font-semibold tabular-nums ${dim ? "text-[#d5dce4]" : SEATS[verdict].number}`}
      >
        {placed}
        <span className="opacity-45">/{seats || "—"}</span>
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
 */
const ROW_COLUMNS =
  "flex flex-col @lg:grid @lg:grid-cols-[max-content_max-content_minmax(6rem,1fr)_fit-content(14rem)_max-content_max-content] @lg:gap-x-3";

/**
 * One stretch of a section's teaching, as a row of its set's list.
 *
 * For the ordinary section — one professor, first week to last — this is the whole row.
 * For a course handed over at mid-semester it is one of two lines, each with its own CRN,
 * name and weeks, pressed and edited on its own; the group's seats and roster sit on the
 * first line only, since the same people sit in each.
 */
function PartRow({
  row,
  part,
  index,
  split,
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
  split: boolean;
  dim: boolean;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  teacherDrift: Set<string>;
  onEdit: () => void;
  onShowGroup?: () => void;
}) {
  const parts = partsOf(row.section);
  const first = index === 0;
  const gone = dim || part.retired;
  const name = `${row.scope.code} ${row.group.label}`;
  const label = `${name} ${row.course.code}`;
  const portalRow = portal && part.crn ? (portal.crns[part.crn] ?? null) : undefined;
  const chosen = part.teacherId ? teacherName(part.teacherId) : "";
  // The course's hours and session length unless the section says its own; a part of a
  // divided section carries its own share, so only an undivided one takes the course's.
  const shown = shownOf(part, split ? undefined : row.course.request);
  const asked = askedOf(part, split ? undefined : row.course.request);
  const drifted = Boolean(part.crn) && teacherDrift.has(part.crn);
  const { seats, placed } = cardSeats(row);

  // Its figures, amber where the course asks otherwise.
  const own = (["hours", "duration", "perWeek", "weeks"] as const)
    .map((key) => ({ key, words: said(key, asked[key]) }))
    .filter((each) => each.words);
  const ownNote = asked.note;
  const warn = shown.overrides.length && !gone;

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
      className={`group flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left text-sm hover:bg-[#f6f8fb] @lg:col-span-full @lg:grid @lg:grid-cols-subgrid @lg:gap-y-0 ${
        first ? "" : "border-t border-dashed border-[#eef1f5]"
      }`}
    >
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {first ? (
          <span className={`font-semibold ${gone ? "text-[#c8d0da]" : "text-[#171717]"}`}>{name}</span>
        ) : (
          <span className="pl-2 text-xs text-[#98a2b3]">part {index + 1}</span>
        )}
        {/* Said on the first line: one thing to know about the section before reading its parts. */}
        {first && split ? (
          <span className={`${chip} bg-[#eef4fa] text-[#1f4e79]`} title="Taught in more than one stretch, by more than one person">
            {parts.length} parts
          </span>
        ) : null}
        {part.retired && !dim ? <span className={`${chip} bg-[#f8fafc] text-[#c8d0da]`}>retired</span> : null}
      </span>

      <span className="whitespace-nowrap tabular-nums">
        {part.crn ? (
          <span className={gone ? "text-[#c8d0da]" : "text-[#667085]"}>{part.crn}</span>
        ) : gone ? null : (
          <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>no CRN</span>
        )}
      </span>

      <span
        className="min-w-0 max-w-full truncate"
        title={chosen || (part.teacher ? `${part.teacher}, not confirmed: named on the row, but not chosen from Active teachers yet` : "Nobody teaches it yet")}
      >
        {chosen ? (
          <span className={gone ? "text-[#c8d0da]" : "text-[#344054]"}>{chosen}</span>
        ) : part.teacher ? (
          <span className={gone ? "text-[#c8d0da]" : "text-[#667085]"}>
            {part.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
          </span>
        ) : (
          <span className={gone ? "text-[#d5dce4]" : "text-[#8a6116]"}>nobody yet</span>
        )}
      </span>

      <span
        className="min-w-0 max-w-full truncate text-[11px] tabular-nums"
        title={
          own.length
            ? [
                own.map((each) => each.words).join(" · "),
                ...(warn ? shown.overrides : []),
                ...own.flatMap((each) =>
                  (each.key === "hours" && shown.hoursInherited) || (each.key === "duration" && shown.durationInherited)
                    ? [`${each.words}, from what the course asks: the section says none of its own`]
                    : [],
                ),
              ].join("\n")
            : undefined
        }
      >
        {own.map((each, index) => {
          const amber = warn && (each.key === "hours" || each.key === "duration");
          return (
            <span key={each.key} className={gone ? "text-[#d5dce4]" : amber ? "font-semibold text-[#8a6116]" : "text-[#667085]"}>
              {index ? " · " : ""}
              {amber ? <AlertTriangle size={10} aria-hidden="true" className="mr-0.5 inline align-[-1px]" /> : null}
              {each.words}
            </span>
          );
        })}
      </span>

      {first ? (
        <span className="ml-auto flex justify-end @lg:ml-0">
          <Seats placed={placed} seats={seats} exempt={row.exempt ?? 0} dim={dim} />
        </span>
      ) : (
        <span className="hidden @lg:block" />
      )}

      <span className="inline-flex items-center gap-0.5">
        {/*
          * Who is in this group — its own button rather than the row's press, which opens
          * the editor: looking at a group is not editing it.
          */}
        {first && onShowGroup ? (
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
        ) : (
          <span className="w-[17px]" />
        )}
        <Pencil size={13} className="shrink-0 text-transparent group-hover:text-[#98a2b3]" aria-hidden="true" />
      </span>

      {/* Under the row, from the CRN's column: its own note, and what the portal says otherwise. */}
      {ownNote || (part.crn && portalRow === null) || (portalRow?.teacherName && drifted) ? (
        <span className="mt-0.5 min-w-0 basis-full space-y-0.5 text-xs leading-5 @lg:col-start-2 @lg:col-end-[-1] @lg:basis-auto">
          {ownNote ? (
            <span title={ownNote} className={`block truncate ${gone ? "text-[#d5dce4]" : "text-[#667085]"}`}>
              {ownNote}
            </span>
          ) : null}
          {part.crn && portalRow === null ? (
            <span className="block text-[11px] text-[#a6292f]">Not in the portal&apos;s list for this semester.</span>
          ) : null}
          {portalRow?.teacherName && drifted ? <span className="block text-[11px] text-[#98a2b3]">Portal: {portalRow.teacherName}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One section, as a row of its set's list (user, 24 Nov 2026).
 *
 * The cards before it sat two or three abreast, each repeating the set's hours, session length
 * and note, with the CRN, the teacher and the seats in a different place on each. As rows the
 * set reads down: every CRN under the one above, every teacher, every seat count, and the
 * figures the set shares said once, on its line.
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
        <span className="text-xs text-[#98a2b3] @lg:col-span-3">Not taught to this sub-row.</span>
      </div>
    );
  }

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
  const splitDiffers =
    split && together !== null && asked !== null && Math.abs(together - asked) > 0.001
      ? `Its parts make ${figure(together)} h — the course asks ${figure(asked)} h`
      : "";

  return (
    <article
      aria-label={label}
      className={`flex flex-col border-t border-[#eef1f5] first:border-t-0 @lg:col-span-full @lg:grid @lg:grid-cols-subgrid ${dim ? "bg-[#fdfefe]" : ""}`}
    >
      {held.map((part, index) => (
        <PartRow
          key={part.part}
          row={row}
          part={part}
          index={index}
          split={split}
          dim={dim}
          teacherName={teacherName}
          portal={portal}
          teacherDrift={teacherDrift}
          onEdit={() => onEdit(row.section ? part : null)}
          onShowGroup={onShowGroup}
        />
      ))}
      {splitDiffers ? (
        <p className="flex items-start gap-1 px-3 pb-2 text-[11px] font-semibold text-[#8a6116] @lg:col-start-2 @lg:col-end-[-1] @lg:px-0">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{splitDiffers}</span>
        </p>
      ) : null}
    </article>
  );
}

/** A set's sections, one row each, in columns the rows share. */
function SectionList({ children, faded = false }: { children: ReactNode; faded?: boolean }) {
  return (
    <div className="@container">
      <div className={`${ROW_COLUMNS} overflow-hidden rounded-lg border ${faded ? "border-dashed border-[#eef1f5]" : "border-[#e4e8ef]"} bg-white`}>
        {children}
      </div>
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

      <div className="relative space-y-6 px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-none">
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
            <div key={set.scope.id}>
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
                {set.scope.name && set.scope.name !== set.scope.code ? (
                  <span className="text-[#667085]">{set.scope.name}</span>
                ) : null}
                <span className="text-xs text-[#98a2b3]">
                  {live.length} section{live.length === 1 ? "" : "s"}
                  {/* A component named after its set — "CM · CM" — says it twice. */}
                  {set.course.component && set.course.component !== set.scope.code ? ` · ${set.course.component}` : ""}
                </span>
                <PlanIssue plan={coursePlan} component={set.course.component || set.scope.code} onOpen={() => setRecordOpen(true)} />
                <InfoTip label="How to read a section row" title="Reading a section row">
                  <TipDo>Press a row to edit its CRN, teacher, hours and what it asks.</TipDo>
                  <TipPoint>
                    <TipButton icon={Clock3}>50 h · 1.5 h sessions</TipButton> the section&apos;s hours, session length and weeks, with its
                    note under the row. Long ones end in &hellip;; hover for the whole.
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
                    <b>30/33</b> at the end of a row: students placed over seats. The bar says how full: blue room left, green full, red
                    over.
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
                    <SectionRows key={rowKey(row)} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing({ ...row, section: part, parts: partsOf(row.section).length })} onShowGroup={() => setShowingGroup(row)} />
                  ))}
                </SectionList>
              ) : null}

              {retired.length ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowingRetired((current) => ({ ...current, [set.scope.id]: !current[set.scope.id] }))}
                    aria-expanded={Boolean(showingRetired[set.scope.id])}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[#98a2b3] hover:text-[#667085]"
                  >
                    {showingRetired[set.scope.id] ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
                    {retired.length} retired
                  </button>
                  {showingRetired[set.scope.id] ? (
                    <div className="mt-2">
                      <SectionList faded>
                        {retired.map((row) => (
                          <SectionRows key={rowKey(row)} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing({ ...row, section: part, parts: partsOf(row.section).length })} onShowGroup={() => setShowingGroup(row)} />
                        ))}
                      </SectionList>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {untaught.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#98a2b3]">
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
                      className="rounded-full border border-[#e4e8ef] bg-[#f8fafc] px-2 py-0.5 font-medium text-[#98a2b3] line-through decoration-[#c8d0da] hover:border-[#1f4e79] hover:text-[#1f4e79] hover:no-underline"
                    >
                      {row.group.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {spare.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#98a2b3]">
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
                      className="rounded-full border border-dashed border-[#c8d0da] px-2 py-0.5 font-medium text-[#667085] hover:border-[#1f4e79] hover:text-[#1f4e79]"
                    >
                      {row.group.label}
                    </button>
                  ))}
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
