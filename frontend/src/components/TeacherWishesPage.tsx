import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Link2Off, LockOpen, RefreshCw, Send, Settings } from "lucide-react";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { InviteDialog } from "@/components/InviteDialog";
import { BAR_BUTTON, ICON_BUTTON, ListSearch, SEGMENTS, SegmentCount, ShownCount, segment } from "@/components/ListLook";
import { LabelledFigure, RECORD_CARD, RecordList, RecordRow, RecordToolbar } from "@/components/RecordList";
import { useStaffUser } from "@/components/useStaffUser";
import { InfoTip, TipButton, TipDo, TipPage, TipPoint, TipUsage } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { usePortalSemester } from "@/components/PortalSemesterMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TableFilterBar } from "@/components/TableFilterBar";
import { TeacherAvatar } from "@/components/TeacherDatabase";
import { usePageState } from "@/components/usePageState";
import { WishesForm } from "@/components/WishesForm";
import { WishesSummary, answeredBy } from "@/components/WishesSummary";
import {
  COLLECTION_DEFAULTS,
  DAY_SHORT,
  closeAgain,
  fetchWishSemester,
  openCollection,
  recurringConstraintHours,
  reopenFor,
  saveWishes,
  withdrawInvitation,
  type CollectionInput,
  type WishCollection,
  type WishTeacher,
  type WishesInput,
} from "@/services/teacherWishes";
import { optionsFor } from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import { isoToday } from "@/services/weekSchedule";
import { WISH_COLUMNS, enteredBy, invitationStage } from "@/services/wishFilters";

const field = "w-full rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm";
const label = "text-xs font-semibold text-[#344054]";

const STATUS = {
  submitted: { words: "Submitted", tone: "bg-[#e7f4ec] text-[#2e7d55]" },
  draft: { words: "Draft", tone: "bg-[#fdf6e3] text-[#8a6116]" },
  none: { words: "Not started", tone: "bg-[#eaecf0] text-[#475467]" },
} as const;

/** "10 Jan 2027". */
const dated = (value: string) =>
  value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

type Shown = "all" | "submitted" | "draft" | "none";
const statusOf = (row: WishTeacher): Exclude<Shown, "all"> => row.wishes?.status ?? "none";

/**
 * The list's columns, shared by its heading and every row so they line up — the department's
 * Record list, as on Part-time Teachers and Hour reductions: who, where their answer stands
 * and when it last changed, what it holds, how far their invitation got, and what can be done.
 */
// Narrower screens keep the name readable: the figures go on two lines in a narrower Answer column.
const ROW_GRID =
  "gap-x-4 gap-y-2 px-4 sm:grid-cols-[minmax(9.5rem,2fr)_minmax(6rem,1fr)_9.5rem_minmax(7rem,1fr)_5.75rem] xl:grid-cols-[minmax(11rem,2fr)_minmax(7rem,1fr)_15.5rem_minmax(7.5rem,1fr)_6rem] sm:items-center";

/** What an answer holds, as the Record list shows figures: each over what it counts, in small capitals. */
function AnswerFigures({ row, cap }: { row: WishTeacher; cap: number }) {
  if (!row.wishes) return <span />;
  const blocks = row.wishes.blocks;
  const constraints = blocks.filter((block) => block.kind === "constraint").length;
  const preferences = blocks.filter((block) => block.kind === "preference").length;
  const weekly = recurringConstraintHours(blocks);
  const over = weekly > cap;
  return (
    <span className="flex flex-wrap items-start gap-x-3 gap-y-1">
      {/* Each figure as wide as its word, never cut: on a narrow screen the third goes under the first two. */}
      <span className="shrink-0" title="Hard constraints: they can't teach then">
        <LabelledFigure value={constraints} label="hard" tone="text-[#a6292f]" faint={!constraints} className="shrink-0" />
      </span>
      {/* The constraints' hours a week, against the cap: red once over it. */}
      <span className="shrink-0" title={`${weekly} h a week marked as hard constraints for the whole semester${over ? `: more than the ${cap} h allowed without a reason` : ""}`}>
        <LabelledFigure value={`${weekly} h`} label="a week" tone={over ? "text-[#a6292f]" : "text-[#344054]"} faint={!weekly} className="shrink-0" />
      </span>
      <span className="shrink-0" title="Soft constraints: they'd rather not teach then">
        <LabelledFigure value={preferences} label="soft" tone="text-[#8a6116]" faint={!preferences} className="shrink-0" />
      </span>
    </span>
  );
}

/** "2026-11-20", a day that exists, with a four-digit year. */
function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** A semester's collection: when it closes, what teachers are told, and the rules of the form. */
function CollectionSettings({
  open,
  semesterName,
  initial,
  busy,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  semesterName: string;
  initial: CollectionInput;
  busy: boolean;
  error: string;
  onSave: (input: CollectionInput) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CollectionInput>(initial);
  // The weekly hours as typed: an emptied box is not 0, and 7.5 is said back, not rounded.
  const [capTyped, setCapTyped] = useState(String(initial.cantCap));
  const [problem, setProblem] = useState("");
  const set = (changes: Partial<CollectionInput>) => {
    setProblem("");
    setDraft((current) => ({ ...current, ...changes }));
  };
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  // Every hour of the grid's week: a cap this high never asks for a reason.
  const gridHours = draft.days.length * Math.max(0, draft.lastHour - draft.firstHour);
  /*
   * Saved as the settings it holds, and only those, each checked here first (17 Nov 2026): the
   * weekly hours of constraints were refused by the server again and again with only "try
   * again" to show for it. The hours are whole hours, 0 to 60, as the semester keeps them.
   */
  const save = () => {
    const deadline = draft.deadline.trim();
    if (deadline && !isRealDate(deadline)) {
      setProblem("The deadline isn't a full date: pick a day from the calendar, with a four-digit year.");
      return;
    }
    const typed = capTyped.trim();
    const cap = Number(typed);
    if (!typed || !Number.isFinite(cap)) {
      setProblem("Say how many hours of hard constraints a week are allowed before a reason is asked: 0 to 60.");
      return;
    }
    if (!Number.isInteger(cap)) {
      setProblem(`Whole hours only: ${typed} can't be kept. Use ${Math.floor(cap)} or ${Math.ceil(cap)}.`);
      return;
    }
    if (cap < 0 || cap > 60) {
      setProblem(
        `${typed} is out of range: 0 to 60 hours a week.${gridHours <= 60 ? ` To never ask for a reason, use ${gridHours}: the grid's whole week.` : ""}`,
      );
      return;
    }
    onSave({
      deadline,
      message: draft.message,
      days: draft.days,
      firstHour: draft.firstHour,
      lastHour: draft.lastHour,
      mustQuota: draft.mustQuota,
      cantCap: cap,
    });
  };
  const said = problem || error;
  return (
    <Modal
      open={open}
      title={`Preferences for ${semesterName}`}
      description="When teachers answer by, what they're told, and the rules of the form."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          {said ? (
            <span role="alert" className="mr-auto text-sm text-[#a6292f]">
              {said}
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        <label className="block">
          <span className={label}>Deadline</span>
          {/* Bounded, so the year takes four digits and no more. */}
          <input
            type="date"
            min="2020-01-01"
            max="2099-12-31"
            value={draft.deadline}
            onChange={(event) => set({ deadline: event.target.value })}
            className={`mt-1 ${field}`}
          />
        </label>
        <label className="block">
          <span className={label}>Message to teachers</span>
          <textarea
            rows={3}
            value={draft.message}
            maxLength={2000}
            onChange={(event) => set({ message: event.target.value })}
            placeholder="Please tell us by 10 January when you can't teach next semester, and when you'd rather not."
            className={`mt-1 ${field}`}
          />
        </label>
        <div>
          <span className={label}>Days on the grid</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <label key={day} className="inline-flex items-center gap-1.5 text-sm text-[#344054]">
                <input
                  type="checkbox"
                  checked={draft.days.includes(day)}
                  onChange={(event) =>
                    set({ days: event.target.checked ? [...draft.days, day].sort((a, b) => a - b) : draft.days.filter((each) => each !== day) })
                  }
                />
                {DAY_SHORT[day]}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>First hour</span>
            <select value={draft.firstHour} onChange={(event) => set({ firstHour: Number(event.target.value) })} className={`mt-1 ${field}`}>
              {hours.slice(0, 24).map((hour) => (
                <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Last hour</span>
            <select value={draft.lastHour} onChange={(event) => set({ lastHour: Number(event.target.value) })} className={`mt-1 ${field}`}>
              {hours.slice(1).map((hour) => (
                <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 block">
            <span className={label}>Hours of constraints a week, before a reason is asked</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              step={1}
              value={capTyped}
              onChange={(event) => {
                setProblem("");
                setCapTyped(event.target.value);
              }}
              className={`mt-1 ${field}`}
            />
            <span className="mt-1 block text-xs text-[#667085]">
              Whole hours, from 0 to 60.{gridHours <= 60 ? ` The grid's whole week is ${gridHours} h: at ${gridHours}, a reason is never asked.` : ""}
            </span>
          </label>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Timetable wishes: when each teacher can and can't teach, collected once a semester.
 *
 * A coordinator opens the semester's collection — a deadline, a message, the rules of the
 * form — sees who has answered, and answers for a teacher who sent theirs by email or said
 * them on the phone. The Semester plan reads the answers while classes are placed.
 */
export function TeacherWishesPage({ header }: { header?: HTMLElement | null }) {
  const client = useQueryClient();
  const { semester, term } = usePortalSemester();
  const wishes = useQuery({
    queryKey: ["wishes", term],
    queryFn: () => fetchWishSemester(term),
    enabled: Boolean(term),
    retry: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /*
   * The teacher whose wishes are open: their answer to read, or the form. An answer given is
   * read first, and changed only through "Edit their answer"; nobody's is changed by a slip.
   */
  const [answering, setAnswering] = useState<{ row: WishTeacher; editing: boolean } | null>(null);
  const [error, setError] = useState("");
  // Which answers the list shows, the search and the filters: kept ten minutes, like every list's.
  const [shown, setShown] = usePageState<Shown>("teacher-preferences:shown", "all");
  const [query, setQuery] = usePageState("teacher-preferences:search", "");
  const [filters, setFilters] = usePageState<FilterModel[]>("teacher-preferences:filters", []);
  // The form differs from what it opened with: closing it then asks first.
  const dirty = useRef(false);
  const [discarding, setDiscarding] = useState<"close" | "back" | null>(null);
  const leave = (to: "close" | "back") => {
    dirty.current = false;
    setDiscarding(null);
    setError("");
    setAnswering((current) => (to === "back" && current?.row.wishes ? { ...current, editing: false } : null));
  };
  const askToLeave = (to: "close" | "back") => {
    if (discarding) return;
    if (answering?.editing && dirty.current) setDiscarding(to);
    else leave(to);
  };

  const refresh = () => client.invalidateQueries({ queryKey: ["wishes", term] });
  const me = useStaffUser();
  // Inviting a teacher, withdrawing an invitation, and reopening one teacher after the deadline.
  const [inviting, setInviting] = useState<WishTeacher | null>(null);
  const [withdrawing, setWithdrawing] = useState<WishTeacher | null>(null);
  const [reopening, setReopening] = useState<{ row: WishTeacher; until: string } | null>(null);
  const withdraw = useMutation({
    mutationFn: (row: WishTeacher) => withdrawInvitation(term, row.teacherId),
    onSuccess: async () => {
      await refresh();
      setWithdrawing(null);
    },
  });
  const reopen = useMutation({
    mutationFn: ({ row, until }: { row: WishTeacher; until: string }) => reopenFor(term, row.teacherId, until),
    onSuccess: async () => {
      await refresh();
      setReopening(null);
    },
  });
  const closeFor = useMutation({ mutationFn: (row: WishTeacher) => closeAgain(term, row.teacherId), onSuccess: refresh });
  const open = useMutation({
    mutationFn: (input: CollectionInput) => openCollection(term, input),
    onSuccess: async () => {
      await refresh();
      setSettingsOpen(false);
      setError("");
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const save = useMutation({
    mutationFn: ({ teacherId, input }: { teacherId: string; input: WishesInput }) => saveWishes(term, teacherId, input),
    onSuccess: async () => {
      await refresh();
      dirty.current = false;
      setAnswering(null);
      setError("");
    },
    onError: (exc: Error) => setError(exc.message),
  });

  // The semester is the header's, chosen there for every page.
  const menu = null;
  const collection: WishCollection | null = wishes.data?.collection ?? null;
  const teachers = wishes.data?.teachers ?? [];
  const counted = (which: Shown) => (which === "all" ? teachers.length : teachers.filter((row) => statusOf(row) === which).length);
  const byStatus = shown === "all" ? teachers : teachers.filter((row) => statusOf(row) === shown);
  const inView = byStatus.filter((row) => `${row.name} ${row.email}`.toLowerCase().includes(query.toLowerCase()));
  const visible = applyFilters(inView, WISH_COLUMNS, filters);
  const semesterName = semester?.name ?? "this semester";
  // Past the deadline, a teacher answering for themselves needs reopening; coordinators never do.
  const today = isoToday();
  const closed = Boolean(collection?.deadline && today > collection.deadline);
  /** A week from today, or from the deadline if that is later: where a reopening starts. */
  const aWeekOn = () => {
    const at = new Date(`${today}T00:00:00`);
    at.setDate(at.getDate() + 7);
    return at.toISOString().slice(0, 10);
  };

  const tip = (
    <InfoTip label="How timetable preferences work" title="Timetable preferences">
      <TipDo>Open the collection for a semester, invite the teachers who answer themselves, and fill in for anyone who sent theirs by email.</TipDo>
      <TipPoint step={1}>
        Press <TipButton icon={Settings}>Open the collection</TipButton>: a deadline, a message, the week&rsquo;s hours.
      </TipPoint>
      <TipPoint step={2}>
        Press <TipButton icon={Send}>Invite</TipButton> on a teacher&rsquo;s row: their link goes out in an email from your own
        mailbox, and they sign in with that Google account to give their own preferences and constraints until the deadline.
      </TipPoint>
      <TipPoint step={3}>
        On <TipPage name="Semester plan" />, a class in a teacher&rsquo;s hard constraint is flagged red, in a soft one amber, and their
        week is shaded while you move it.
      </TipPoint>
      <TipUsage
        when={<>Bilal Maaz emails to say Tuesday afternoons are impossible.</>}
        todo={<>Click Bilal&rsquo;s name, mark Tuesday 14:00–18:00 as a hard constraint for the whole semester, and submit.</>}
        then={<>On the plan, Bilal&rsquo;s classes on Tuesday afternoon are flagged red.</>}
      />
    </InfoTip>
  );

  const openRow = (row: WishTeacher) => {
    setError("");
    dirty.current = false;
    setAnswering({ row, editing: !row.wishes });
  };
  const deadlineWords = collection?.deadline
    ? `${closed ? "Closed" : "Deadline"} ${dated(collection.deadline)}`
    : "No deadline";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header ? menu : <div className="flex justify-end pb-3">{menu}</div>}

      {!term ? (
        <p className="text-sm text-[#667085]">Choose a semester with a portal term.</p>
      ) : wishes.isLoading ? (
        <ScreenLoading label="Reading the preferences…" />
      ) : wishes.isError ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(wishes.error as Error).message}</p>
      ) : !collection ? (
        <div className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center">
          <CalendarHeart size={22} className="mx-auto text-[#98a2b3]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[#344054]">No preferences collected for {semesterName} yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#667085]">
            Open the collection with a deadline, and each teacher can say when they can&rsquo;t teach, and when they&rsquo;d rather not. You can also answer for
            a teacher yourself.
          </p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setSettingsOpen(true);
            }}
            className="mt-4 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
          >
            Open the collection
          </button>
        </div>
      ) : (
        <>
          {/* One bar across the top, as on Part-time Teachers: which answers, the search, the collection. */}
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
            <div role="group" aria-label="Which answers" className={SEGMENTS}>
              {(
                [
                  ["all", "All"],
                  ["submitted", "Submitted"],
                  ["draft", "Draft"],
                  ["none", "Not started"],
                ] as const
              ).map(([which, words]) => (
                <button
                  key={which}
                  type="button"
                  aria-pressed={shown === which}
                  onClick={() => setShown(which)}
                  className={segment(shown === which)}
                >
                  {words} <SegmentCount value={counted(which)} on={shown === which} />
                </button>
              ))}
            </div>
            <ListSearch label="Search teachers" value={query} onChange={setQuery} />
            <div className="ml-auto flex items-center gap-2">
              <span
                className={`whitespace-nowrap text-sm ${closed ? "font-semibold text-[#a6292f]" : "text-[#667085]"}`}
                title={`${collection.cantCap} h of constraints a week before a reason is asked`}
              >
                {deadlineWords}
              </span>
              {tip}
              <button
                type="button"
                onClick={() => {
                  setError("");
                  setSettingsOpen(true);
                }}
                className={BAR_BUTTON}
              >
                <Settings size={16} aria-hidden="true" /> Settings
              </button>
            </div>
          </div>

          <section aria-label="Teachers' answers" className={RECORD_CARD}>
            <RecordToolbar>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <TableFilterBar
                  columns={WISH_COLUMNS}
                  filters={filters}
                  optionsFor={(column) => optionsFor(inView, column)}
                  onChange={setFilters}
                />
              </div>
              <ShownCount shown={visible.length} of={inView.length} />
            </RecordToolbar>
            <RecordList
              label="Teachers"
              columns={ROW_GRID}
              isEmpty={!visible.length}
              empty={teachers.length ? "No teacher matches." : `No teacher is active in ${semesterName} yet. Add them on Active teachers.`}
              head={
                <>
                  <span>Teacher</span>
                  <span>Status</span>
                  <span>Answer</span>
                  <span>Invitation</span>
                  <span />
                </>
              }
            >
              {visible.map((row) => {
                const status = STATUS[statusOf(row)];
                const stage = invitationStage(row);
                const invitedOn = row.invitation ? row.invitation.signedInAt || row.invitation.openedAt || row.invitation.createdAt : "";
                return (
                  <RecordRow key={row.teacherId} columns={ROW_GRID}>
                    {/* The name opens the answer, as a name opens a profile on Part-time Teachers. */}
                    <button
                      type="button"
                      onClick={() => openRow(row)}
                      aria-label={`${row.wishes ? "Open" : "Fill in"} ${row.name}'s preferences`}
                      title={row.wishes ? "Open their answer" : "Fill in for them"}
                      className="flex min-w-0 items-center gap-3 text-left"
                    >
                      <TeacherAvatar fullName={row.name} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-[#171717] group-hover:text-[#1f4e79]">{row.name}</span>
                        <span className={`block truncate text-xs ${row.email ? "text-[#475467]" : "italic text-[#667085]"}`}>
                          {row.email || "No email"}
                        </span>
                      </span>
                    </button>
                    {/* Where the answer stands, and under it when it last changed and by whom. */}
                    <span className="flex min-w-0 flex-col items-start gap-1">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.words}</span>
                      {row.wishes ? (
                        <span
                          className="block max-w-full truncate text-xs text-[#475467]"
                          title={row.wishes.updatedBy ? `Entered by ${row.wishes.updatedBy}` : undefined}
                        >
                          {dated(row.wishes.updatedAt)} ·{" "}
                          {enteredBy(row) === "A coordinator"
                            ? `entered by ${row.wishes.updatedBy || "a coordinator"}`
                            : "by the teacher"}
                        </span>
                      ) : null}
                      {closed && row.reopenedUntil ? (
                        <span className="text-xs text-[#2e7d55]">
                          Reopened until {dated(row.reopenedUntil)}
                          <button
                            type="button"
                            onClick={() => closeFor.mutate(row)}
                            aria-label={`Close ${row.name}'s answer again`}
                            className="ml-1 font-semibold text-[#667085] hover:underline"
                          >
                            Close
                          </button>
                        </span>
                      ) : null}
                    </span>
                    <AnswerFigures row={row} cap={collection.cantCap} />
                    <span className="min-w-0 leading-tight">
                      {row.invitation ? (
                        <>
                          <span className="block text-sm text-[#344054]">{`${stage} ${dated(invitedOn)}`}</span>
                          <span
                            className="block truncate text-xs text-[#475467]"
                            title={`${row.invitation.email}${row.invitation.createdBy ? ` · made by ${row.invitation.createdBy}` : ""}`}
                          >
                            {row.invitation.email}
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="flex flex-nowrap items-center justify-end gap-1">
                      {closed && !row.reopenedUntil ? (
                        <button
                          type="button"
                          onClick={() => setReopening({ row, until: aWeekOn() })}
                          aria-label={`Reopen ${row.name}'s answer`}
                          title="Reopen: let them answer past the deadline"
                          className={ICON_BUTTON}
                        >
                          <LockOpen size={15} aria-hidden="true" />
                        </button>
                      ) : null}
                      {row.invitation ? (
                        <button
                          type="button"
                          onClick={() => setWithdrawing(row)}
                          aria-label={`Withdraw ${row.name}'s invitation`}
                          title="Withdraw the invitation"
                          className={ICON_BUTTON}
                        >
                          <Link2Off size={15} aria-hidden="true" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setInviting(row)}
                        aria-label={`${row.invitation ? "Make a new invitation for" : "Invite"} ${row.name}`}
                        title={row.invitation ? "New link: the old one stops working" : "Invite them to answer themselves"}
                        className={ICON_BUTTON}
                      >
                        {row.invitation ? <RefreshCw size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                      </button>
                    </span>
                  </RecordRow>
                );
              })}
            </RecordList>
          </section>
        </>
      )}

      {settingsOpen ? (
        <CollectionSettings
          open
          semesterName={semesterName}
          initial={collection ? { ...collection } : COLLECTION_DEFAULTS}
          busy={open.isPending}
          error={error}
          onSave={(input) => open.mutate(input)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {answering && collection ? (
        <Modal
          open
          size="wide"
          title={answering.row.wishes ? `${answering.row.name}'s preferences` : `Answer for ${answering.row.name}`}
          description={`Timetable preferences and constraints request · ${semesterName}${answering.row.wishes ? ` · ${STATUS[answering.row.wishes.status].words.toLowerCase()}` : ""}`}
          onClose={() => askToLeave("close")}
        >
          {answering.editing ? (
            <WishesForm
              collection={collection}
              calendar={wishes.data?.calendar}
              initial={answering.row.wishes}
              busy={save.isPending}
              error={error}
              noticeTone={answering.row.wishes ? "warning" : "info"}
              notice={
                answering.row.wishes ? (
                  <>
                    You&rsquo;re changing {answering.row.name}&rsquo;s answer. {answeredBy(answering.row.name, answering.row.wishes)}. What you
                    save replaces it, as entered by you.
                  </>
                ) : (
                  <>
                    You&rsquo;re answering on <b>{answering.row.name}</b>&rsquo;s behalf, from what they told you. It&rsquo;s kept as
                    entered by you.
                  </>
                )
              }
              onDirtyChange={(changed) => {
                dirty.current = changed;
              }}
              onSave={(input) => save.mutate({ teacherId: answering.row.teacherId, input })}
              onCancel={() => askToLeave("back")}
            />
          ) : answering.row.wishes ? (
            <WishesSummary
              name={answering.row.name}
              collection={collection}
              wishes={answering.row.wishes}
              onEdit={() => {
                setError("");
                dirty.current = false;
                setAnswering({ ...answering, editing: true });
              }}
            />
          ) : null}
        </Modal>
      ) : null}
      {inviting && collection ? (
        <InviteDialog
          term={term}
          semesterName={semesterName}
          teacher={inviting}
          collection={collection}
          sender={me?.name ?? ""}
          onClose={() => setInviting(null)}
          onInvited={() => void refresh()}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(withdrawing)}
        title="Withdraw the invitation?"
        description={
          withdrawing
            ? `${withdrawing.name}'s link stops working at once. Anything they have answered stays, and you can invite them again.`
            : ""
        }
        confirmLabel="Withdraw"
        busy={withdraw.isPending}
        onConfirm={() => withdrawing && withdraw.mutate(withdrawing)}
        onClose={() => setWithdrawing(null)}
      />
      {reopening ? (
        <Modal
          open
          title={`Reopen ${reopening.row.name}'s answer`}
          description={`The deadline has passed. ${reopening.row.name} may change their answer themselves until the day you choose.`}
          onClose={() => setReopening(null)}
          footer={
            <div className="flex items-center justify-end gap-3">
              {reopen.isError ? (
                <span role="alert" className="mr-auto text-sm text-[#a6292f]">
                  {(reopen.error as Error).message}
                </span>
              ) : null}
              <button type="button" onClick={() => setReopening(null)} className="text-sm font-semibold text-[#667085]">
                Cancel
              </button>
              <button
                type="button"
                disabled={!reopening.until || reopen.isPending}
                onClick={() => reopen.mutate(reopening)}
                className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
              >
                {reopen.isPending ? "Reopening…" : "Reopen"}
              </button>
            </div>
          }
        >
          <label className="block max-w-xs">
            <span className={label}>Until</span>
            <input
              type="date"
              value={reopening.until}
              min={today}
              onChange={(event) => setReopening({ ...reopening, until: event.target.value })}
              className={`mt-1 ${field}`}
            />
          </label>
        </Modal>
      ) : null}
      <ConfirmDialog
        open={Boolean(discarding)}
        title="Discard your changes?"
        description={`What you changed in ${answering?.row.name ?? "this teacher"}'s preferences hasn't been saved.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => discarding && leave(discarding)}
        onClose={() => setDiscarding(null)}
      />
    </div>
  );
}
