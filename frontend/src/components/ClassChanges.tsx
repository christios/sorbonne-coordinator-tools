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
 * What comes back after an approval is only what has changed since it: the section is
 * measured from the approval, not from the start of term again. What was answered stays
 * readable in the history, which is always one click away, banner or not, and on each
 * CRN's own record — and the latest approval of a section can be withdrawn from either.
 *
 * Opening it draws the months. A count cannot show this and a calendar can — three
 * squares left across three months is not a course being taught, and it reads at a glance
 * in a way that "6 h against 26 h" never did.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, History, RotateCcw } from "lucide-react";
import { Tooltip } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CourseRecord } from "@/components/CourseRecord";
import { CrnRecord } from "@/components/CrnRecord";
import { Modal } from "@/components/Modal";
import { TeacherRecord } from "@/components/TeacherRecord";
import { hoursIn, minutesOf, monthsOfDiff, stillToLookAt, unexpected, type DiffDay, type Meeting } from "@/services/classDiff";
import { formatRoom } from "@/services/weekSchedule";
import { useRooms } from "@/services/rooms";
import {
  fetchActiveCrns,
  fetchActiveTeachers,
  fetchChangeHistory,
  fetchChangedClasses,
  fetchSweptTerms,
  type ChangeHistory,
  type ChangeHistoryEntry,
  type ChangedClasses,
} from "@/services/portalLists";
import { sameTeacher } from "@/services/teacherLoad";
import { dismissalsByKey, fetchDismissals, setDismissal } from "@/services/warningDismissals";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A record to open over the changes: a course's, a CRN's or a teacher's (user, 24 Nov 2026). */
type RecordAsked = { kind: "course"; code: string } | { kind: "crn"; crn: string } | { kind: "teacher"; name: string };

/**
 * A course code, CRN or teacher's name in a section's header, pressed to open its record.
 *
 * Dotted rather than blue, so the header still reads as a header; it turns to a link under the
 * pointer. Inside a history entry's summary it must not also fold the entry open or shut.
 */
function RecordLink({ children, title, onOpen }: { children: ReactNode; title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen();
      }}
      className="rounded-sm underline decoration-[#c8d0da] decoration-dotted underline-offset-[3px] hover:text-[#1f4e79] hover:decoration-[#1f4e79] hover:decoration-solid focus-visible:outline-2 focus-visible:outline-[#1f4e79]"
    >
      {children}
    </button>
  );
}

/** "MATH-001 · CRN 22151", each half opening its record; the CRN only when the register holds it. */
function SectionName({
  courseCode,
  crn,
  known,
  onRecord,
}: {
  courseCode: string;
  crn: string;
  known: Set<string>;
  onRecord: (asked: RecordAsked) => void;
}) {
  return (
    <>
      {courseCode ? (
        <RecordLink title={`Open ${courseCode}'s record`} onOpen={() => onRecord({ kind: "course", code: courseCode })}>
          {courseCode}
        </RecordLink>
      ) : (
        crn
      )}{" "}
      · CRN{" "}
      {known.has(crn) ? (
        <RecordLink title={`Open CRN ${crn}'s record`} onOpen={() => onRecord({ kind: "crn", crn })}>
          {crn}
        </RecordLink>
      ) : (
        crn
      )}
    </>
  );
}

/** The teacher the portal names, opening their record; "Nobody named" when it names none. */
function TeacherName({ name, onRecord, nobody = "Nobody named" }: { name: string; onRecord: (asked: RecordAsked) => void; nobody?: string }) {
  if (!name) return <>{nobody}</>;
  return (
    <RecordLink title={`Open ${name}'s record`} onOpen={() => onRecord({ kind: "teacher", name })}>
      {name}
    </RecordLink>
  );
}

/**
 * The record asked for, over the changes and the history.
 *
 * A CRN's record needs the register's own row, so a CRN the register does not hold is not
 * offered. A teacher is found on Active teachers by the portal's spelling of their name, and
 * opened by that name when they are not there, the way the portal's teacher list opens one.
 */
function ChangeRecords({
  asked,
  termCode,
  onRecord,
  onClose,
}: {
  asked: RecordAsked | null;
  termCode: string;
  onRecord: (asked: RecordAsked) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const crns = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: asked?.kind === "crn" });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: () => fetchActiveTeachers(), enabled: asked?.kind === "teacher" });
  if (!asked) return null;
  if (asked.kind === "course") return <CourseRecord open courseCode={asked.code} onClose={onClose} />;
  if (asked.kind === "teacher") {
    if (teachers.isLoading) return null;
    const held = (teachers.data ?? []).find((teacher) => sameTeacher(teacher.fullName, asked.name));
    return <TeacherRecord open teacher={held ?? { id: "", fullName: asked.name }} onClose={onClose} />;
  }
  const all = crns.data ?? [];
  const row = all.find((entry) => entry.crn === asked.crn && entry.termCode === termCode) ?? all.find((entry) => entry.crn === asked.crn);
  if (!row) return null;
  return (
    <CrnRecord
      open
      row={row}
      siblings={all.filter((entry) => entry.courseCode === row.courseCode && entry.termCode === row.termCode)}
      onClose={onClose}
      onSaved={() => void client.invalidateQueries({ queryKey: ["active-crns"] })}
      onShowCourse={(code) => onRecord({ kind: "course", code })}
    />
  );
}

/** "8 h removed, 2 h added", leaving out the half that did not happen. */
function saidIn(lost: number, gained: number): string {
  const said = [
    lost ? `${Math.round(lost * 100) / 100} h removed` : "",
    gained ? `${Math.round(gained * 100) / 100} h added` : "",
  ].filter(Boolean);
  return said.join(", ");
}

/**
 * What the portal changed in our classes, for one semester.
 *
 * `term` is the semester the page is on, by its portal term. Without one the banner follows
 * the newest semester swept, which it always did, so Semester 1's changes disappeared the
 * moment Semester 2 was swept, even while Semester 1 was still being taught.
 */
export function ClassChangesBanner({ className = "", term = "" }: { className?: string; term?: string }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  /*
   * How the window lists the changes (user, 24 Nov 2026): a CRN at a time, or a course's or a
   * teacher's CRNs on one calendar — where a class that only moved from one of their CRNs to
   * another at the same date and time is not news. Miklos's class went from his lecture CRN
   * to his tutorial CRN on 25 Nov: removed on one card, added on another, and there all along
   * in his timetable.
   */
  const [viewBy, setViewBy] = useState<ViewBy>("crn");
  // The entries whose changes are all approved, listed too: each opens on its whole term.
  const [withApproved, setWithApproved] = useState(false);
  // Each entry's own choice: since its last approval, or its whole term.
  const [modes, setModes] = useState<Record<string, Mode>>({});
  // The history, for every section or for the ones whose History was asked for.
  const [history, setHistory] = useState<{ crns?: string[] } | null>(null);
  // The record opened from a section's course code, CRN or teacher, over whichever window is open.
  const [record, setRecord] = useState<RecordAsked | null>(null);
  const terms = useQuery({ queryKey: ["swept-terms"], queryFn: fetchSweptTerms, retry: false });
  const termCode = term || (terms.data?.[0] ?? "");
  const changed = useQuery({
    queryKey: ["changed-classes", termCode],
    queryFn: () => fetchChangedClasses(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const dismissals = useQuery({ queryKey: ["warning-dismissals"], queryFn: fetchDismissals, retry: false });
  // Which CRNs the register holds, so only those offer a record: read once a window is open.
  const register = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: open || history !== null });
  const known = useMemo(() => new Set((register.data ?? []).map((entry) => entry.crn)), [register.data]);
  const approved = useMemo(() => dismissalsByKey(dismissals.data ?? []), [dismissals.data]);
  const waiting = useMemo(
    () => stillToLookAt(changed.data ?? [], approved),
    [changed.data, approved],
  );
  // Every section from when it was first seen: each entry's whole term, and the approved ones.
  const everything = useQuery({
    queryKey: ["changed-classes", termCode, "whole"],
    queryFn: () => fetchChangedClasses(termCode, true),
    enabled: open && Boolean(termCode),
    retry: false,
  });
  const groups = useMemo(
    () => groupsOf(waiting, everything.data ?? [], viewBy, withApproved),
    [waiting, everything.data, viewBy, withApproved],
  );
  /*
   * The semester the months are drawn across: from the first class any listed section
   * has to the last. Every section is laid against the same months, the empty ones
   * included. Not from Week 1 as Settings has it: that is the week before teaching starts
   * — 24 August — and it drew an August nobody taught in.
   */
  const span = useMemo(() => {
    const dates = [...waiting, ...(everything.data ?? [])]
      .flatMap((section) => [...section.kept, ...section.removed, ...section.added].map((meeting) => meeting.meetsOn))
      .sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : undefined;
  }, [waiting, everything.data]);
  const approve = useMutation({
    // A course's or a teacher's entry approves each of its sections that waits.
    mutationFn: async (keys: string[]) => {
      for (const key of keys) await setDismissal(key, true);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["warning-dismissals"] });
      void client.invalidateQueries({ queryKey: ["changed-classes-history"] });
    },
  });
  const historyDialog = (
    <>
      <ChangeHistoryDialog
        termCode={termCode}
        crns={history?.crns}
        open={history !== null}
        onClose={() => setHistory(null)}
        known={known}
        onRecord={setRecord}
      />
      <ChangeRecords asked={record} termCode={termCode} onRecord={setRecord} onClose={() => setRecord(null)} />
    </>
  );

  const changesModal = (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Classes the portal has changed"
      description="What has changed since each section was last approved, across the months of the semester: what still meets, what has gone and what has arrived. Each one can show its whole term instead. Approving one keeps it out of the banner until something else about it changes, and then only that new change is shown."
      size="wide"
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div role="group" aria-label="View by" className="inline-flex rounded-md border border-[#d9dee7] bg-[#f8fafc] p-0.5">
          {(
            [
              ["crn", "By CRN"],
              ["course", "By course"],
              ["teacher", "By teacher"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={viewBy === value}
              onClick={() => setViewBy(value)}
              className={`rounded px-3 py-1 font-medium ${viewBy === value ? "bg-white text-[#1f4e79] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 text-[#344054]">
          <input type="checkbox" checked={withApproved} onChange={(event) => setWithApproved(event.target.checked)} />
          Show approved too
        </label>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-[#667085]">
          {withApproved && everything.isLoading
            ? "Loading every change this term…"
            : withApproved && everything.isError
              ? "The term's changes could not be read."
              : withApproved
                ? "The portal has not changed any of our classes this term."
                : "Nothing is waiting for approval."}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {groups.map((group) => {
            const keys = group.since.map((section) => section.key);
            return (
              <GroupDiff
                key={group.id}
                group={group}
                by={viewBy}
                mode={group.since.length ? (modes[group.id] ?? "since") : "whole"}
                onMode={(mode) => setModes((current) => ({ ...current, [group.id]: mode }))}
                wholeLoading={everything.isLoading}
                span={span}
                onApprove={() => approve.mutate(keys)}
                approving={approve.isPending && (approve.variables ?? []).some((key) => keys.includes(key))}
                onHistory={() => setHistory({ crns: membersOf(group).map((section) => section.crn) })}
                known={known}
                onRecord={setRecord}
              />
            );
          })}
        </div>
      )}
    </Modal>
  );

  /*
   * Nothing waiting: no warning, but a plain line where it would be, with the history on a
   * button of its own. It was a small link at the far end of the row, and read as not there
   * at all — and the history is where an approval is read, and withdrawn, once the warning
   * has gone. Nothing until both answers are in, so a page with changes waiting does not
   * first say there are none.
   */
  if (waiting.length === 0) {
    if (!termCode || changed.isLoading || dismissals.isLoading) return null;
    return (
      <>
        <div
          className={`${className} flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#d9dee7] bg-white px-4 py-2`}
        >
          <p className="flex items-center gap-2 text-sm text-[#667085]">
            {changed.isError ? (
              <>
                <AlertTriangle size={16} className="shrink-0 text-[#a6292f]" /> The portal's class changes could not be
                read.
              </>
            ) : (
              <>
                <CheckCircle2 size={16} className="shrink-0 text-[#2f6b3d]" /> No class changes waiting for approval.
              </>
            )}
          </p>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Nothing waiting is not nothing changed: the whole term stays one press away. */}
            <button
              type="button"
              onClick={() => {
                setWithApproved(true);
                setOpen(true);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
            >
              <CalendarDays size={15} /> All changes this term
            </button>
            <button
              type="button"
              onClick={() => setHistory({})}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
            >
              <History size={15} /> Class change history
            </button>
          </span>
        </div>
        {changesModal}
        {historyDialog}
      </>
    );
  }

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
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setHistory({})}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#7a5d00] hover:underline"
          >
            <History size={15} /> History
          </button>
          <button
            type="button"
            onClick={() => {
              setWithApproved(false);
              setOpen(true);
            }}
            className="rounded-md border border-[#c9a227] bg-white px-3 py-1.5 text-sm font-semibold text-[#7a5d00] hover:bg-[#fffaf0]"
          >
            Show what changed
          </button>
        </div>
      </div>
      {changesModal}
      {historyDialog}
    </>
  );
}

type ViewBy = "crn" | "course" | "teacher";
type Mode = "since" | "whole";

/** One entry of the changes window: a CRN, or one course's or one teacher's changed CRNs. */
type ChangeGroup = {
  id: string;
  /** Its sections with something waiting, each measured from its last approval. */
  since: ChangedClasses[];
  /** Its sections from when each was first seen, approved or not. */
  whole: ChangedClasses[];
};

/** What an entry draws: one section, or a course's or a teacher's sections on one calendar. */
type ShownSection = {
  courseCode: string;
  title: string;
  crn: string;
  teacherName: string;
  kept: Meeting[];
  removed: Meeting[];
  added: Meeting[];
  /** Classes that only moved from one of its CRNs to another, at the same date and time. */
  moved: number;
};

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

function groupKey(section: ChangedClasses, by: ViewBy): string {
  if (by === "course") return `course:${section.courseCode || section.crn}`;
  if (by === "teacher") return `teacher:${nameKey(section.teacherName)}`;
  return `crn:${section.crn}`;
}

/** Its sections, once each, whichever of the two readings they came from. */
function membersOf(group: ChangeGroup): ChangedClasses[] {
  const seen = new Map<string, ChangedClasses>();
  for (const section of [...group.since, ...group.whole]) if (!seen.has(section.crn)) seen.set(section.crn, section);
  return [...seen.values()];
}

/** The window's entries: what waits first, then — when asked — the ones all approved. */
function groupsOf(waiting: ChangedClasses[], whole: ChangedClasses[], by: ViewBy, withApproved: boolean): ChangeGroup[] {
  const held = new Map<string, ChangeGroup>();
  const take = (section: ChangedClasses, into: "since" | "whole") => {
    const id = groupKey(section, by);
    const group = held.get(id) ?? { id, since: [], whole: [] };
    group[into].push(section);
    held.set(id, group);
  };
  for (const section of waiting) take(section, "since");
  for (const section of whole) take(section, "whole");
  return [...held.values()]
    .filter((group) => group.since.length || (withApproved && group.whole.length))
    .sort((a, b) => Number(b.since.length > 0) - Number(a.since.length > 0) || a.id.localeCompare(b.id));
}

const bySlot = (a: Meeting, b: Meeting) => `${a.meetsOn}${a.startsAt}`.localeCompare(`${b.meetsOn}${b.startsAt}`);

/**
 * Sections laid on one calendar, each class carrying its CRN.
 *
 * A class removed from one of them and added to another at the same date and time only moved
 * between them: for the course or the teacher it is still there, so it is drawn as unchanged
 * and counted as moved. One the department had cancelled is not netted: the registrar putting
 * it back elsewhere is news.
 */
function shownOf(sections: ChangedClasses[]): ShownSection {
  const many = sections.length > 1;
  const tag = (meeting: Meeting, crn: string): Meeting => (many ? { ...meeting, crn } : meeting);
  const kept: Meeting[] = sections.flatMap((section) => section.kept.map((meeting) => tag(meeting, section.crn)));
  let removed: Meeting[] = sections.flatMap((section) => section.removed.map((meeting) => tag(meeting, section.crn)));
  let added: Meeting[] = sections.flatMap((section) => section.added.map((meeting) => tag(meeting, section.crn)));
  let moved = 0;
  if (many) {
    const slot = (meeting: Meeting) => `${meeting.meetsOn}|${meeting.startsAt}|${meeting.endsAt}`;
    const arrivals = [...added];
    const losses: Meeting[] = [];
    for (const gone of removed) {
      const at = gone.weCancelled ? -1 : arrivals.findIndex((came) => slot(came) === slot(gone) && came.crn !== gone.crn);
      if (at < 0) {
        losses.push(gone);
        continue;
      }
      const [came] = arrivals.splice(at, 1);
      kept.push({ ...came, moved: { from: gone.crn ?? "", to: came.crn ?? "" } });
      moved += 1;
    }
    removed = losses;
    added = arrivals;
  }
  const once = (values: string[]) => [...new Set(values.filter(Boolean))];
  const titles = once(sections.map((section) => section.title));
  return {
    courseCode: once(sections.map((section) => section.courseCode)).join(", "),
    title: titles.length === 1 ? titles[0] : "",
    crn: sections.map((section) => section.crn).join(", "),
    teacherName: once(sections.map((section) => section.teacherName)).join(", "),
    kept: kept.sort(bySlot),
    removed: removed.sort(bySlot),
    added: added.sort(bySlot),
    moved,
  };
}

/** "Since approval" or "Whole term", for one entry. */
function ModeSwitch({ mode, onMode, label }: { mode: Mode; onMode: (mode: Mode) => void; label: string }) {
  return (
    <div role="group" aria-label={`Changes shown for ${label}`} className="inline-flex rounded-md border border-[#d9dee7] bg-[#f8fafc] p-0.5 text-xs">
      {(
        [
          ["since", "Since approval"],
          ["whole", "Whole term"],
        ] as const
      ).map(([value, text]) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onMode(value)}
          className={`rounded px-2 py-0.5 font-medium ${mode === value ? "bg-white text-[#1f4e79] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** "PHYS-208 · CRN 24092; PHYS-210 · CRN 24233", each part opening its record. */
function SectionNames({ sections, known, onRecord }: { sections: ChangedClasses[]; known: Set<string>; onRecord: (asked: RecordAsked) => void }) {
  return (
    <>
      {sections.map((section, index) => (
        <span key={section.crn}>
          {index ? "; " : ""}
          <SectionName courseCode={section.courseCode} crn={section.crn} known={known} onRecord={onRecord} />
        </span>
      ))}
    </>
  );
}

function GroupDiff({
  group,
  by,
  mode,
  onMode,
  wholeLoading,
  span,
  onApprove,
  approving,
  onHistory,
  known: registered,
  onRecord,
}: {
  group: ChangeGroup;
  by: ViewBy;
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** The whole term is still being read, so an entry showing it has nothing to draw yet. */
  wholeLoading: boolean;
  /** The CRNs the register holds: only those open a record. */
  known: Set<string>;
  onRecord: (asked: RecordAsked) => void;
  /** The semester's months, so a section with nothing in September still shows September. */
  span?: { from: string; to: string };
  onApprove: () => void;
  approving: boolean;
  /** Everything that ever changed in its sections, and who approved what. */
  onHistory: () => void;
}) {
  const sections = mode === "since" ? group.since : group.whole;
  const section = useMemo(() => shownOf(sections), [sections]);
  const members = membersOf(group);
  const months = useMemo(
    () => monthsOfDiff(section.kept, section.removed, section.added, span),
    [section.kept, section.removed, section.added, span],
  );
  const news = unexpected(section.removed);
  const lost = hoursIn(news);
  const gained = hoursIn(section.added);
  const left = hoursIn(section.kept);
  const known = section.removed.length - news.length;
  // Whether any day here is two things at once, which is the only thing the ring says.
  const both = months.some((month) =>
    month.days.some((day) => day && day.removed.length > 0 && day.added.length > 0),
  );
  const said = [
    news.length ? `${news.length} class${news.length === 1 ? "" : "es"} gone (${lost} h)` : "",
    known ? `${known} you had cancelled` : "",
    section.added.length ? `${section.added.length} arrived (${gained} h)` : "",
    section.moved ? `${section.moved} moved between ${by === "teacher" ? "their" : "its"} CRNs` : "",
    `${section.kept.length} unchanged (${left} h)`,
  ].filter(Boolean);
  const teachers = [...new Set(members.map((each) => each.teacherName).filter(Boolean))];
  const label = by === "teacher" ? members[0]?.teacherName || "Nobody named" : by === "course" ? members[0]?.courseCode || members[0]?.crn : `CRN ${members[0]?.crn}`;
  const waits = group.since.length;
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-[#344054]">
            {by === "teacher" ? (
              <TeacherName name={members[0]?.teacherName ?? ""} onRecord={onRecord} />
            ) : by === "course" && members.length > 1 ? (
              <>
                {members[0].courseCode ? (
                  <RecordLink title={`Open ${members[0].courseCode}'s record`} onOpen={() => onRecord({ kind: "course", code: members[0].courseCode })}>
                    {members[0].courseCode}
                  </RecordLink>
                ) : null}{" "}
                · CRN{" "}
                {members.map((each, index) => (
                  <span key={each.crn}>
                    {index ? ", " : ""}
                    {registered.has(each.crn) ? (
                      <RecordLink title={`Open CRN ${each.crn}'s record`} onOpen={() => onRecord({ kind: "crn", crn: each.crn })}>
                        {each.crn}
                      </RecordLink>
                    ) : (
                      each.crn
                    )}
                  </span>
                ))}
              </>
            ) : (
              <SectionName courseCode={members[0]?.courseCode ?? ""} crn={members[0]?.crn ?? ""} known={registered} onRecord={onRecord} />
            )}
          </h4>
          <p className="mt-0.5 text-sm text-[#667085]">
            {by === "teacher" ? (
              <SectionNames sections={members} known={registered} onRecord={onRecord} />
            ) : teachers.length ? (
              teachers.map((name, index) => (
                <span key={name}>
                  {index ? ", " : ""}
                  <TeacherName name={name} onRecord={onRecord} />
                </span>
              ))
            ) : (
              "Nobody named"
            )}
            {sections.length ? ` · ${said.join(", ")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {waits ? <ModeSwitch mode={mode} onMode={onMode} label={label} /> : null}
          <button
            type="button"
            onClick={onHistory}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1f4e79] hover:underline"
          >
            <History size={15} /> History
          </button>
          {waits ? (
            <button
              type="button"
              onClick={onApprove}
              disabled={approving}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60"
            >
              <Check size={16} /> {waits === 1 ? "Approve" : `Approve all ${waits}`}
            </button>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#eef7f1] px-2.5 py-1 text-xs font-semibold text-[#2f6b3d]">
              <Check size={13} /> Approved
            </span>
          )}
        </div>
      </div>
      {!sections.length ? (
        <p className="mt-4 text-sm text-[#667085]">{wholeLoading ? "Loading the whole term…" : "Nothing to show."}</p>
      ) : (
        <>
          {/*
            * Every month the section touches on one row, however many there are. A semester
            * read as a strip is the whole point of drawing it — three squares left across
            * September, October and November is a course that stopped, and that only shows
            * when the months are side by side. Wrapped, the last month dropped under the
            * first and the shape went with it. So the columns share the width and the days
            * shrink to fit rather than the row breaking.
            *
            * A month is never wider than a quarter of the row, though: a section that touches
            * one month drew it the whole width across, squares the size of buttons, and two
            * sections one under the other stopped looking like the same kind of thing.
            */}
          <div className="mt-4 grid auto-cols-[minmax(9rem,calc((100%-3rem)/4))] grid-flow-col gap-4 overflow-x-auto pb-1">
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
                    <Square key={day?.day ?? `blank-${index}`} day={day} section={section} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[#667085]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm bg-[#cfe2ff]" /> unchanged
              {section.moved ? ", or only moved between these CRNs" : ""}
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
            {known ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-3 rounded-sm bg-[#e9ecef]" /> you had cancelled it
              </span>
            ) : null}
          </p>
        </>
      )}
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
function DayCard({ day, section }: { day: DiffDay; section: ShownSection }) {
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
                  key={`${meeting.startsAt}|${meeting.room}|${meeting.crn ?? ""}`}
                  meeting={meeting}
                  tone={group.tone}
                  note={
                    meeting.weCancelled
                      ? "you had cancelled it"
                      : meeting.moved
                        ? `moved from CRN ${meeting.moved.from} to ${meeting.moved.to}`
                        : meeting.crn
                          ? `CRN ${meeting.crn}`
                          : undefined
                  }
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

function Square({ day, section }: { day: DiffDay | null; section: ShownSection }) {
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
          : day.outside
            ? "text-[#d5dce4]"
            : "text-[#98a2b3]";
  const also = arrived && gone ? " ring-2 ring-inset ring-[#e07c84]" : "";
  const said = [
    gone ? `${day.removed.length} class${day.removed.length === 1 ? "" : "es"} removed` : "",
    ours ? "which you had cancelled" : "",
    arrived ? `${day.added.length} added` : "",
    meets ? "still meets" : "",
  ].filter(Boolean);
  const square = (
    <span
      tabIndex={said.length ? 0 : undefined}
      aria-label={said.length ? `${day.day}: ${said.join(", ")}` : day.day}
      className={`flex aspect-square w-full items-center justify-center rounded-sm text-[11px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79] ${paint}${also} ${gone && !arrived ? "line-through" : ""}`}
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

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 9 Nov", for the day a class was or is on. */
function classDay(iso: string): string {
  const [year, month, date] = iso.split("-").map(Number);
  const made = new Date(year, month - 1, date);
  return Number.isNaN(made.getTime()) ? iso : `${SHORT_DAYS[made.getDay()]} ${date} ${SHORT_MONTHS[month - 1]}`;
}

/** "4 Nov 2026, 09:03", in the reader's own time, for when something was noticed or approved. */
function moment(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return iso;
  const time = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  return `${when.getDate()} ${SHORT_MONTHS[when.getMonth()]} ${when.getFullYear()}, ${time}`;
}

/**
 * What was answered, kept readable. The banner only asks about what changed since a
 * section's last approval, so this is where a class that went in October is still found in
 * December — each sweep that changed something, and each approval, newest first.
 */
function ChangeHistoryDialog({
  termCode,
  crns,
  open,
  onClose,
  known,
  onRecord,
}: {
  termCode: string;
  /** The history of these sections, opened from an entry; every section's when left out. */
  crns?: string[];
  open: boolean;
  onClose: () => void;
  known: Set<string>;
  onRecord: (asked: RecordAsked) => void;
}) {
  const history = useQuery({
    queryKey: ["changed-classes-history", termCode],
    queryFn: () => fetchChangeHistory(termCode),
    enabled: open && Boolean(termCode),
    retry: false,
  });
  const shown = (history.data ?? []).filter((section) => !crns || crns.includes(section.crn));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={crns?.length ? `Change history · CRN ${crns.join(", ")}` : "Class change history"}
      description="Every change the portal has made to these classes this term, newest first, with who approved it and when."
      size="wide"
    >
      {history.isLoading ? (
        <p className="text-sm text-[#667085]">Loading the history…</p>
      ) : history.isError ? (
        <p className="text-sm text-[#842029]">The history could not be loaded.</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-[#667085]">The portal has not changed any of our classes this term.</p>
      ) : (
        <div className="grid gap-3">
          {shown.map((section) => (
            <SectionHistory key={section.crn} section={section} opened={Boolean(crns?.length)} known={known} onRecord={onRecord} />
          ))}
        </div>
      )}
    </Modal>
  );
}

function SectionHistory({
  section,
  opened,
  known,
  onRecord,
}: {
  section: ChangeHistory;
  opened: boolean;
  known: Set<string>;
  onRecord: (asked: RecordAsked) => void;
}) {
  return (
    <details open={opened} className="group rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
      <summary className="cursor-pointer list-none">
        <span className="font-semibold text-[#344054]">
          <SectionName courseCode={section.courseCode} crn={section.crn} known={known} onRecord={onRecord} />
        </span>
        <span className="text-sm text-[#667085]">
          {" "}
          · <TeacherName name={section.teacherName} onRecord={onRecord} /> · last {moment(section.lastAt)}
        </span>
      </summary>
      <ChangeHistoryEntries entries={section.entries} className="mt-3" />
    </details>
  );
}

/**
 * Withdraw an approval, for everybody.
 *
 * The approval goes and the section is measured from the one before it again, so what it
 * approved is back in the banner on Active CRNs and Active teachers until somebody
 * approves it again. Everything that reads approvals is refreshed: the banner, the
 * history and the CRN record.
 */
function useUnapprove() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => setDismissal(key, false),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["warning-dismissals"] });
      void client.invalidateQueries({ queryKey: ["changed-classes"] });
      void client.invalidateQueries({ queryKey: ["changed-classes-history"] });
    },
  });
}

/**
 * One section's history, newest first: each sweep that changed its classes, and each
 * approval. The CRN record shows it too, since the banner is gone once nothing waits.
 *
 * The section's latest approval can be withdrawn here. Only the latest: it is the one the
 * banner measures from, so withdrawing it brings back exactly what it approved. An older
 * one withdrawn under a newer would change nothing anybody could see, which is worse than
 * not offering it. Once the latest has gone, the one before it is the latest and can go
 * in its turn.
 */
export function ChangeHistoryEntries({ entries, className = "" }: { entries: ChangeHistoryEntry[]; className?: string }) {
  const newest = [...entries].reverse();
  const latest = newest.find((entry) => entry.kind === "approved");
  const unapprove = useUnapprove();
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <>
      <ol className={`space-y-3 border-l-2 border-[#e4e7ec] pl-4 ${className}`}>
        {newest.map((entry, index) =>
          entry.kind === "approved" ? (
            <li key={`a${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#0f5132]">
              <span>
                <span className="font-semibold">{moment(entry.at)}</span> · approved
                {entry.by ? ` by ${entry.by}` : ""}
              </span>
              {entry === latest && entry.key ? (
                <button
                  type="button"
                  onClick={() => setAsking(entry.key ?? null)}
                  disabled={unapprove.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-[#b7bec8] bg-white px-2 py-0.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:opacity-60"
                >
                  <RotateCcw size={12} /> Unapprove
                </button>
              ) : null}
            </li>
          ) : (
            <li key={`c${index}`} className="text-sm">
              <p className="font-semibold text-[#344054]">{moment(entry.at)} · the portal changed</p>
              <ul className="mt-1 space-y-0.5">
                {entry.removed.map((meeting) => (
                  <HistoryLine key={`r${meeting.meetsOn}${meeting.startsAt}`} gone meeting={meeting} />
                ))}
                {entry.added.map((meeting) => (
                  <HistoryLine key={`a${meeting.meetsOn}${meeting.startsAt}`} gone={false} meeting={meeting} />
                ))}
              </ul>
            </li>
          ),
        )}
      </ol>
      {unapprove.isError ? (
        <p role="alert" className="mt-2 text-sm text-[#a6292f]">{unapprove.error.message}</p>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        title="Unapprove this change?"
        description="What it approved goes back in the warning on Active CRNs and Active teachers, for everybody, until somebody approves it again."
        confirmLabel="Unapprove"
        cancelLabel="Keep it approved"
        tone="primary"
        busy={unapprove.isPending}
        onConfirm={() => {
          if (asking) unapprove.mutate(asking, { onSettled: () => setAsking(null) });
        }}
        onClose={() => setAsking(null)}
      />
    </>
  );
}

function HistoryLine({ meeting, gone }: { meeting: Meeting; gone: boolean }) {
  return (
    <li className="flex flex-wrap gap-x-2 text-[#475467]">
      <span className={`w-16 shrink-0 font-semibold ${gone ? "text-[#842029]" : "text-[#0f5132]"}`}>
        {gone ? "Removed" : "Added"}
      </span>
      <span className="tabular-nums">
        {classDay(meeting.meetsOn)} · {meeting.startsAt}–{meeting.endsAt}
      </span>
      {meeting.room ? <span>room {formatRoom(meeting.room)}</span> : null}
      {meeting.weCancelled ? <span className="text-[#98a2b3]">you had cancelled it</span> : null}
    </li>
  );
}
