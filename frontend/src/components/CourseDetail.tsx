import { AlertTriangle, Armchair, ChevronDown, ChevronRight, Clock3, Eye, Pencil, UserRound, Wand2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { FillBlock, type FillReport } from "@/components/FillBlock";
import { GroupRoster } from "@/components/GroupRoster";
import { SectionDialog } from "@/components/CourseCard";
import { CourseRequestDialog, CourseRequestLine } from "@/components/CourseRequest";
import { PortalTermLink } from "@/components/PortalTermLink";
import { YearPill } from "@/components/YearPill";
import type { Card, CardSet, SectionRow } from "@/services/courseCards";
import { MUTUALIZED_WORDS, type ActiveTeacher, type TermCrns } from "@/services/portalLists";
import type { GroupClash } from "@/services/publication";
import { EMPTY_PART, partsOf, type Cohort, type SectionPart } from "@/services/studentDatabase";

const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";

/**
 * One figure the timetabler works from, said loudly enough to be read at a glance.
 *
 * Total hours and anticipated students are not two more numbers among six: they are what
 * a teacher's load is computed from and what a room is chosen by, and everything else on
 * this line — sessions a week, hours each, which weeks — follows from them. They spent a
 * long time in the same eleven-pixel grey run-on as the rest, where the eye slid over
 * them, so they are lifted out of it.
 *
 * The two do not look alike. They are different quantities — a span of teaching and a
 * count of people — and a card carries them side by side, so an eye running down a column
 * of sections should be able to find the one it is after without reading either. Hence a
 * clock against a person, a square corner against a round one, and two hues rather than
 * one; the difference is small enough that they stay a pair.
 *
 * Missing is a reading too. An empty box says the timetabler has not been told yet, which
 * is worth seeing without opening the section to find out.
 */
const FIGURES = {
  hours: {
    icon: Clock3,
    shape: "rounded-md",
    said: "border-[#cfe0ee] bg-[#eef4fa]",
    number: "text-[#1f4e79]",
    word: "text-[#6d8fb4]",
  },
  expected: {
    icon: UserRound,
    shape: "rounded-full",
    said: "border-[#d9d3e9] bg-[#f8f6fd]",
    number: "text-[#5b4d8a]",
    word: "text-[#9089b8]",
  },
  // Amber, and the same round shape as "expected", because it is a count of the same
  // people — the ones this class will not have in it.
  exempt: {
    icon: UserRound,
    shape: "rounded-full",
    said: "border-[#e8d9ac] bg-[#fdf9ee]",
    number: "text-[#8a6116]",
    word: "text-[#b99a52]",
  },
} as const;

function Figure({ label, value, dim }: { label: keyof typeof FIGURES; value: string; dim: boolean }) {
  const said = Boolean(value);
  const skin = FIGURES[label];
  const Icon = skin.icon;
  return (
    <span
      title={said ? `${value} ${label}` : `No ${label} set yet`}
      className={`inline-flex items-center gap-1 border px-2 py-1 ${skin.shape} ${
        dim ? "border-[#f2f5f9] bg-white" : said ? skin.said : "border-dashed border-[#d9dee7] bg-white"
      }`}
    >
      <Icon size={11} aria-hidden="true" className={dim ? "text-[#e4e9ef]" : said ? skin.word : "text-[#c2c9d3]"} />
      <span className={`text-[13px] font-semibold leading-none tabular-nums ${dim ? "text-[#d5dce4]" : said ? skin.number : "text-[#b7bec8]"}`}>
        {value || "—"}
      </span>
      <span className={`text-[10px] font-semibold uppercase leading-none tracking-wide ${dim ? "text-[#e4e9ef]" : said ? skin.word : "text-[#c2c9d3]"}`}>
        {label}
      </span>
    </span>
  );
}

/**
 * How full the group is, as a figure beside the other two.
 *
 * "30/33 seats taken" spent its life as grey prose at the foot of the card, which is the
 * one place a number goes to not be read. It is the third of the three facts a timetable
 * is built from — hours, expected, seats — so it is said the way the other two are.
 *
 * It differs from them in taking its colour from its own answer: full is a finished thing,
 * over is a room that will not hold the class, and neither should have to be worked out
 * from the digits. The edge on the left carries that verdict at the size of a glance, and
 * the bar along the card's foot says the same in proportion.
 */
const SEATS = {
  over: { skin: "border-[#e5b7b9] border-l-[3px] border-l-[#a6292f] bg-[#fdf3f3]", number: "text-[#a6292f]", word: "text-[#c98d90]" },
  full: { skin: "border-[#cfe6d8] border-l-[3px] border-l-[#2e7d55] bg-[#f2f9f4]", number: "text-[#2e7d55]", word: "text-[#8ab7a0]" },
  room: { skin: "border-[#d9e0e8] border-l-[3px] border-l-[#1f4e79] bg-[#f8fafc]", number: "text-[#344054]", word: "text-[#98a2b3]" },
  unset: { skin: "border-dashed border-[#d9dee7] bg-white", number: "text-[#b7bec8]", word: "text-[#c2c9d3]" },
} as const;

/** Which of the four readings this group is: the same words Capacity uses. */
function seatsVerdict(placed: number, seats: number): keyof typeof SEATS {
  if (!seats) return "unset";
  if (placed > seats) return "over";
  if (placed === seats) return "full";
  return "room";
}

function Seats({ placed, seats, dim }: { placed: number; seats: number; dim: boolean }) {
  const verdict = seatsVerdict(placed, seats);
  const skin = SEATS[verdict];
  return (
    <span
      title={seats ? `${placed} of ${seats} seats taken` : `${placed} placed, no capacity set`}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 ${dim ? "border-[#f2f5f9] bg-white" : skin.skin}`}
    >
      <Armchair size={11} aria-hidden="true" className={dim ? "text-[#e4e9ef]" : skin.word} />
      <span className={`text-[13px] font-semibold leading-none tabular-nums ${dim ? "text-[#d5dce4]" : skin.number}`}>
        {placed}
        <span className="opacity-45">/{seats || "—"}</span>
      </span>
      <span className={`text-[10px] font-semibold uppercase leading-none tracking-wide ${dim ? "text-[#e4e9ef]" : skin.word}`}>
        seats
      </span>
    </span>
  );
}

/**
 * How full the group is, drawn along the foot of its card.
 *
 * The numbers were already there — "30/40 placed" — and were read by nobody, because
 * reading fifteen cards means reading thirty numbers and doing thirty divisions. A room
 * that is nearly full and a room that is over are the same sentence at a glance and
 * completely different problems. The bar is the answer to "which of these needs a bigger
 * room" without asking anything of the reader.
 *
 * The track is the group's seats, so a full bar is a full class and anything red is a
 * class that has outgrown the room it was given — the same reading as the bars on
 * Capacity, so the two pages do not have to be reconciled in the head.
 *
 * It says nothing of its own: the seats figure above states the numbers, and a second
 * voice repeating them is one more thing for a screen reader to read out.
 */
function Fullness({ placed, seats, dim }: { placed: number; seats: number; dim: boolean }) {
  const share = seats ? Math.min(1, placed / seats) : 0;
  const tone = !seats
    ? "#e4e8ef"
    : placed > seats
      ? "#a6292f"
      : placed === seats
        ? "#2e7d55"
        : placed === 0
          ? "#e4e8ef"
          : "#1f4e79";
  return (
    <span
      aria-hidden="true"
      className={`-mx-3.5 -mb-3 mt-3 block h-1 overflow-hidden rounded-b-lg ${dim || !seats ? "bg-[#f7f9fb]" : "bg-[#eef1f5]"}`}
    >
      <span
        className="block h-full"
        style={{ width: `${share * 100}%`, backgroundColor: dim ? "#eef1f5" : tone, opacity: dim ? 0.6 : 1 }}
      />
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
 * One stretch of a section's teaching, inside the section's own card.
 *
 * For the ordinary section — one professor, first week to last — this is the whole body of
 * the card and reads exactly as the card did before parts existed. For a course handed
 * over at mid-semester it is one of two, told apart by a rule above it and by its own
 * press: each half is a different CRN, a different name and different weeks, so each is
 * opened and edited on its own.
 */
function PartLine({
  part,
  only,
  first,
  teacherName,
  portal,
  teacherDrift,
  onEdit,
  label,
}: {
  part: SectionPart;
  /** True when the section has no other part, in which case nothing divides it. */
  only: boolean;
  first: boolean;
  teacherName: (id: string) => string;
  portal: TermCrns | null;
  teacherDrift: Set<string>;
  /** Absent for an undivided section: the card's own press already opens it. */
  onEdit?: () => void;
  label: string;
}) {
  const portalRow = portal && part.crn ? (portal.crns[part.crn] ?? null) : undefined;
  const chosen = part.teacherId ? teacherName(part.teacherId) : "";
  const drifted = Boolean(part.crn) && teacherDrift.has(part.crn);
  const asked = asks(part);

  const body = (
    <>
      {/* The CRN sits with its own half rather than on the card's title line, which can
          only ever carry one of them. */}
      {only ? null : (
        <p className="flex items-baseline gap-2">
          {part.crn ? (
            <span className={`text-sm tabular-nums ${part.retired ? "text-[#c8d0da]" : "text-[#667085]"}`}>{part.crn}</span>
          ) : (
            <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>no CRN</span>
          )}
          {part.retired ? <span className={`${chip} bg-[#f8fafc] text-[#c8d0da]`}>retired</span> : null}
        </p>
      )}

      <p className={`mt-1 truncate text-sm ${part.retired ? "text-[#c8d0da]" : ""}`}>
        {chosen ? (
          <span className={part.retired ? "" : "text-[#344054]"}>{chosen}</span>
        ) : part.teacher ? (
          <span className="text-[#667085]" title="Named on the row, but not chosen from Active teachers yet">
            {part.teacher} <span className="text-[11px] text-[#98a2b3]">not confirmed</span>
          </span>
        ) : (
          <span className="text-[#c8d0da]">nobody yet</span>
        )}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <Figure label="hours" value={part.hours} dim={part.retired} />
        <Figure label="expected" value={part.anticipated ? String(part.anticipated) : ""} dim={part.retired} />
      </div>

      {part.sessionsPerWeek || part.duration || part.weeks ? (
        /* How the hours are spread. Detail, under the figures they add up to. */
        <p className={`mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums ${part.retired ? "text-[#d5dce4]" : "text-[#98a2b3]"}`}>
          {part.sessionsPerWeek ? <span>{part.sessionsPerWeek}/week</span> : null}
          {part.duration ? <span>{part.duration} h each</span> : null}
          {part.weeks ? <span>weeks {part.weeks}</span> : null}
        </p>
      ) : null}

      {asked ? <p className="mt-1.5 text-xs leading-5 text-[#667085]">{asked}</p> : null}
      {part.crn && portalRow === null ? (
        <p className="mt-1 text-[11px] text-[#a6292f]">Not in the portal&apos;s list for this semester.</p>
      ) : null}
      {portalRow?.teacherName && drifted ? (
        <p className="mt-1 text-[11px] text-[#98a2b3]">Portal: {portalRow.teacherName}</p>
      ) : null}
    </>
  );

  if (!onEdit) return body;
  return (
    <button
      type="button"
      aria-label={`Edit ${label}`}
      /*
       * Its own press, and it stops the card's — the card opens the first part, and a
       * click on the second half must not open the first professor's row instead.
       */
      onClick={(event) => {
        event.stopPropagation();
        onEdit();
      }}
      className={`-mx-1 block w-full rounded px-1 py-1 text-left hover:bg-[#f6f8fb] ${
        first ? "" : "mt-2 border-t border-[#eef1f5] pt-2"
      }`}
    >
      {body}
    </button>
  );
}

/**
 * One section, as a block rather than a row of a wide table.
 *
 * The table this replaces had ten columns and scrolled sideways inside a card, which put
 * the constraint — the sentence the timetabler most needs to read — in a squeezed column
 * off the right edge. Here the numbers sit on one line and the sentence has the width of
 * the block, which is what it needs.
 */
function SectionBlock({
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
  const parts = partsOf(row.section);
  const held = parts[0] ?? EMPTY_PART;
  const split = parts.length > 1;
  const label = `${row.scope.code} ${row.group.label} ${row.course.code}`;
  // Dim the whole card only when NOTHING it teaches is still running.
  const dim = parts.length > 0 && parts.every((part) => part.retired);

  return (
    <article
      role="button"
      tabIndex={0}
      /*
       * Pressing the card edits its FIRST part, which for a section taught by one person
       * is the section. A split section's other stretches are pressed on their own rows
       * below, because each is a different CRN with a different name and different weeks.
       */
      onClick={() => onEdit(row.section ? held : null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onEdit(row.section ? held : null);
        }
      }}
      aria-label={split ? `Edit ${label}, first part` : `Edit ${label}`}
      /*
       * A column, so the fullness bar can be held to the bottom edge.
       *
       * The cards sit in a grid whose default align-items is stretch, so every card in a
       * row is as tall as the tallest. A block box given a height larger than its content
       * leaves the surplus BELOW its last child, which floated the bar by exactly the
       * height difference — visible on every card except the tallest in each row, which
       * is why it read as "some cards".
       */
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-lg border px-3.5 py-3 text-left transition hover:border-[#b7c6d8] hover:shadow-sm ${
        dim ? "border-dashed border-[#eef1f5] bg-[#fdfefe]" : "border-[#e4e8ef] bg-white"
      }`}
    >
      <header className="flex items-baseline gap-2">
        <h4 className={`text-sm font-semibold ${dim ? "text-[#c8d0da]" : "text-[#171717]"}`}>
          {row.scope.code} {row.group.label}
        </h4>
        {/*
          * Said on the card, not on each part: it is one thing to know about the section
          * before reading down it, and the parts below carry their own weeks and names.
          */}
        {split ? (
          <span className={`${chip} bg-[#eef4fa] text-[#1f4e79]`} title="Taught in more than one stretch, by more than one person">
            {parts.length} parts
          </span>
        ) : null}
        {!split && held.retired ? <span className={`${chip} bg-[#f8fafc] text-[#c8d0da]`}>retired</span> : null}
        {/*
          * The CRN, and nothing about it.
          *
          * A tick or a warning here answered a different question — whether the CRN turned
          * up in the imported timetable — and read as a verdict on the CRN itself. Only the
          * Foundation Year timetable has ever been imported, so most sections wore a red
          * mark for a file that was never uploaded. That check belongs on a page of its own.
          */}
        {/* One CRN belongs on the title line; several belong beside the parts that own
            them, where each sits with the name and the weeks it goes with. */}
        <span className="ml-auto inline-flex items-center gap-1 tabular-nums">
          {split ? null : held.crn ? (
            <span className={`text-sm ${held.retired ? "text-[#c8d0da]" : "text-[#667085]"}`}>{held.crn}</span>
          ) : held.retired ? null : (
            <span className={`${chip} bg-[#fdf3f3] text-[#a6292f]`}>no CRN</span>
          )}
        </span>
        {/*
          * Who is in this group — the first question anybody asks about one, and until now
          * the only one this card could not answer. It needed the Students page, a cohort
          * filter and a group filter to read eighteen names off a table built for three
          * thousand rows.
          *
          * Its own button rather than part of the card's own press, which opens the editor:
          * looking at a group is not editing it, and a roster appearing over a form
          * somebody had just opened would be worse than the walk to the other page.
          */}
        {onShowGroup ? (
          <button
            type="button"
            aria-label={`Who is in ${row.scope.code} ${row.group.label}`}
            title="Who is in this group"
            onClick={(event) => {
              event.stopPropagation();
              onShowGroup();
            }}
            className="shrink-0 rounded p-0.5 text-[#c8d0da] hover:bg-[#eef1f5] hover:text-[#1f4e79]"
          >
            <Eye size={13} aria-hidden="true" />
          </button>
        ) : null}
        <Pencil size={13} className="shrink-0 text-transparent group-hover:text-[#98a2b3]" aria-hidden="true" />
      </header>

      {/*
        * One block per stretch of teaching.
        *
        * Undivided when there is one — the block IS the section and reads exactly as it
        * did before parts existed. Divided by a rule when there are two, each with the CRN,
        * the name and the weeks that go together, so the card answers "who teaches this,
        * and when" without the eye travelling between two cards to do it.
        */}
      {parts.map((part, index) => (
        <PartLine
          key={part.part}
          part={part}
          only={!split}
          first={index === 0}
          teacherName={teacherName}
          portal={portal}
          teacherDrift={teacherDrift}
          onEdit={split ? () => onEdit(part) : undefined}
          label={`${label}, part ${part.part}`}
        />
      ))}

      {/*
        * The group's own facts, said once however many stretches it is taught in: the same
        * people sit in every part, so a seat count per part would read as twice the class.
        */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {row.exempt ? <Figure label="exempt" value={String(row.exempt)} dim={dim} /> : null}
        <Seats placed={row.group.assigned} seats={row.group.capacity} dim={dim} />
      </div>

      {/*
        * Absorbs whatever height the grid row hands this card over its own content.
        *
        * A spacer rather than mt-auto on the bar itself: on the card that SETS the row
        * height the auto margin resolves to 0, so the bar would butt against the text
        * with no gap — a subtler regression on exactly the cards that look right today.
        * Keeping Fullness's mt-3 preserves the 12px gap on every card.
        */}
      <span aria-hidden="true" className="flex-1" />
      <Fullness placed={row.group.assigned} seats={row.group.capacity} dim={dim} />
    </article>
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
}: {
  card: Card;
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
  unassigned: Record<string, string[]>;
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
  const [asking, setAsking] = useState<CardSet | null>(null);
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
        <p className="text-[#344054]">{card.name || <span className="text-[#98a2b3]">untitled</span>}</p>
        {card.ue ? <span className="text-xs tabular-nums text-[#98a2b3]">{card.ue}</span> : null}
        {card.active?.mutualized ? (
          <span className={`${chip} ${card.active.mutualized === "yes" ? "bg-[#e8edf3] text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"}`}>
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
          {/*
            * Which portal term this semester is, said where the semester is named.
            *
            * It lived only on the Semesters page, which is the Student Hub's page and the
            * one nobody opens now the upload is retired — while every consequence of the
            * link missing shows up HERE: no registrar timetable, no clashes, no
            * collisions, every section reading "no timetable yet". The place to fix it
            * should be the place you notice it.
            */}
          {card.termId ? <PortalTermLink termId={card.termId} /> : null}
          {action}
        </span>
      </header>

      <div className="relative space-y-6 px-5 py-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-none">
        {card.sets.map((set) => {
          const missing = unassigned[set.scope.code] ?? [];
          const left = missing.length;
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
          const spare = set.rows.filter((row) => !row.section);
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
                {set.scope.openToAll ? (
                  <span className={`${chip} bg-[#e8edf3] text-[#1f4e79]`}>Across cohorts</span>
                ) : null}
                {left ? (
                  /*
                   * The count is the question; the students are the answer.
                   *
                   * "6 in no group" told a coordinator there was work to do and then made
                   * them go and find who it was for, in a table of three thousand rows.
                   * Pressing it opens the Cohorts page on this cohort and exactly those
                   * six — that page being where a student is put into a block.
                   */
                  <button
                    type="button"
                    disabled={!onPlaceStudents}
                    onClick={() => onPlaceStudents?.(card.cohortId, missing)}
                    title={onPlaceStudents ? `Place the ${left} student${left === 1 ? "" : "s"} in no ${set.scope.code} group` : undefined}
                    className={`${chip} inline-flex items-center gap-1 bg-[#fdf9ee] text-[#8a6116] ${
                      onPlaceStudents ? "hover:bg-[#f9efd6] hover:underline" : "cursor-default"
                    }`}
                  >
                    <AlertTriangle size={11} aria-hidden="true" /> {left} in no group
                  </button>
                ) : null}
                {cohort ? (
                  <button
                    type="button"
                    onClick={() => setFilling(set)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                  >
                    <Wand2 size={13} aria-hidden="true" /> Fill {set.scope.code}
                  </button>
                ) : null}
              </div>

              {/*
                * What the course asks, above the sections that answer it. One per set: a
                * lecture is twenty-four hours and a tutorial thirty-six, and the two are
                * not one request with an exception.
                */}
              <CourseRequestLine request={set.course.request} scopeCode={set.scope.code} onEdit={() => setAsking(set)} />

              <div className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                {live.map((row) => (
                  <SectionBlock key={row.group.id} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing({ ...row, section: part, parts: partsOf(row.section).length })} onShowGroup={() => setShowingGroup(row)} />
                ))}
              </div>

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
                    <div className="mt-2 grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-3">
                      {retired.map((row) => (
                        <SectionBlock key={row.group.id} row={row} teacherName={teacherName} portal={portal} teacherDrift={teacherDrift} onEdit={(part) => setEditing({ ...row, section: part, parts: partsOf(row.section).length })} onShowGroup={() => setShowingGroup(row)} />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {spare.length ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#98a2b3]">
                  <span>Add a section in</span>
                  {spare.map((row) => (
                    <button
                      key={row.group.id}
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

      {asking ? (
        <CourseRequestDialog
          courseId={asking.course.id}
          title={`${card.code} · ${asking.scope.code}`}
          description={`What ${card.name || card.code} asks of the timetable for every ${asking.scope.code} section of it, in ${card.cohortName}, ${card.termName || "this semester"}.`}
          held={asking.course.request}
          teachers={teachers}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setAsking(null);
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
