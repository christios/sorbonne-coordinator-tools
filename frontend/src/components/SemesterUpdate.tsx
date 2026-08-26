import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Modal } from "@/components/Modal";

import {
  type DiffCourse,
  type DiffFilter,
  type DiffSession,
  type TimetablePreview,
  allKeys,
  courseKey,
  courseRowMatches,
  describeSession,
  keysOf,
  operationsFrom,
  rowKey,
  studentsAffected,
  summariseCourse,
  visibleCourses,
} from "@/services/timetableDiff";
import { type TimetableTerm, applyTimetableUpdate, previewTimetableUpdate } from "@/services/timetables";

const FILTERS: { id: DiffFilter; name: string }[] = [
  { id: "all", name: "Everything to review" },
  { id: "changed", name: "Changed" },
  { id: "added", name: "New" },
  { id: "removed", name: "Cancelled" },
  { id: "course", name: "Course details" },
  { id: "unchanged", name: "Unchanged" },
];

const BADGES: Record<string, string> = {
  changed: "bg-[#fdf6e6] text-[#8a6116]",
  added: "bg-[#eef7f0] text-[#2f6b3d]",
  removed: "bg-[#fdf3f3] text-[#a6292f]",
  unchanged: "bg-[#f2f4f7] text-[#667085]",
};

const LABELS: Record<string, string> = {
  changed: "Changed",
  added: "New",
  removed: "Cancelled",
  unchanged: "Unchanged",
};

/**
 * Reviewing a fresh registrar export against a semester already uploaded.
 *
 * The registrar re-issues the whole activity list whenever anything moves, so most of what
 * arrives is noise. This screen shows only what differs, says how it decided two rows are
 * the same session, and lands nothing that has not been ticked — an update is a series of
 * decisions, not a replacement.
 */
export function SemesterUpdate({
  term,
  onBack,
  onStage,
}: {
  term: TimetableTerm;
  onBack: () => void;
  /**
   * "pick" while this is a dialog over the list, "review" once it has taken the screen.
   * The list hides itself for the second, because a long review inside a scrolling box
   * is worse than the full-screen page it replaced.
   */
  onStage?: (stage: "pick" | "review") => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TimetablePreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<DiffFilter>("all");
  const [applied, setApplied] = useState<TimetableTerm | null>(null);

  const check = useMutation({
    mutationFn: () => previewTimetableUpdate(term.id, file as File),
    onSuccess: (payload) => {
      setPreview(payload);
      setSelected(new Set());
      setApplied(null);
    },
  });

  const apply = useMutation({
    mutationFn: () =>
      applyTimetableUpdate({
        termId: term.id,
        baseUpdatedAt: (preview as TimetablePreview).baseUpdatedAt,
        filename: (preview as TimetablePreview).filename,
        operations: operationsFrom((preview as TimetablePreview).courses, selected),
      }),
    onSuccess: (updated) => {
      setApplied(updated);
      setPreview(null);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["timetable-terms"] });
    },
  });

  // Picking a file is a dialog; a diff, or the result of applying one, is the whole screen.
  const stage = preview || applied ? "review" : "pick";
  useEffect(() => onStage?.(stage), [onStage, stage]);

  const courses = useMemo(() => preview?.courses ?? [], [preview]);
  const decisions = useMemo(() => allKeys(courses), [courses]);
  const shown = useMemo(() => visibleCourses(courses, filter), [courses, filter]);
  const losing = studentsAffected(courses, selected);
  const error = check.error?.message ?? apply.error?.message ?? null;

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const setMany = (keys: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      keys.forEach((key) => (on ? next.add(key) : next.delete(key)));
      return next;
    });

  const picker = (
    <label className="block text-sm font-semibold text-[#344054]">
      New timetable export
      <input
        type="file"
        accept=".xls,.xlsx"
        autoFocus
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setPreview(null);
          setApplied(null);
        }}
        className="mt-1.5 block w-full rounded-md border border-[#c8d0db] bg-white px-3 py-2 text-sm font-normal text-[#1f2937] file:mr-3 file:rounded file:border-0 file:bg-[#eaf1f8] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#1f4e79]"
      />
      <span className="mt-1 block text-xs font-normal text-[#667085]">
        {file ? file.name : ".xls or .xlsx — the registrar's latest activity list"}
      </span>
    </label>
  );

  if (stage === "pick") {
    return (
      <Modal
        open
        title={`Update ${term.name}`}
        description="Nothing changes until you have looked at what differs and ticked it — anything you leave unticked keeps the value students see today."
        onClose={onBack}
        footer={
          <>
            <button type="button" onClick={onBack} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => check.mutate()}
              disabled={!file || check.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {check.isPending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <FileSpreadsheet size={16} aria-hidden="true" />
              )}
              See what would change
            </button>
          </>
        }
      >
        {picker}
        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]"
          >
            {error}
          </p>
        ) : null}
      </Modal>
    );
  }

  return (
    <section className="pb-28">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" /> All semesters
      </button>

      <div className="rounded-lg border border-[#d9dee7] bg-white p-6">
        <h3 className="text-lg font-semibold text-[#171717]">Update {term.name}</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
          Nothing changes until you have looked at what differs and ticked it — anything you leave
          unticked keeps the value students see today.
        </p>

        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#667085]">
          <FileSpreadsheet size={15} className="text-[#1f4e79]" aria-hidden="true" />
          <b className="font-semibold text-[#344054]">{preview?.filename ?? file?.name ?? ""}</b>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setPreview(null);
              setApplied(null);
            }}
            className="font-semibold text-[#1f4e79] underline"
          >
            Choose a different file
          </button>
        </p>

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]"
          >
            {error}
          </p>
        ) : null}

        {applied ? (
          <div className="mt-4 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={17} aria-hidden="true" /> {applied.name} updated
            </p>
            <p className="mt-1 leading-6">
              It now holds {applied.courseCount} courses, {applied.sessionCount} sessions and{" "}
              {applied.studentCount} students. Students with the page open are offered a refresh.
            </p>
          </div>
        ) : null}
      </div>

      {preview ? (
        <>
          <Summary preview={preview} />

          <div className="mt-5 flex flex-wrap gap-2">
            {FILTERS.map(({ id, name }) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={
                  filter === id
                    ? "rounded-full bg-[#1f4e79] px-3.5 py-1.5 text-sm font-semibold text-white"
                    : "rounded-full border border-[#d9dee7] bg-white px-3.5 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                }
              >
                {name}
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <p className="mt-6 rounded-lg border border-[#d9dee7] bg-white px-6 py-8 text-sm text-[#667085]">
              {decisions.length === 0
                ? "This export matches the semester exactly. There is nothing to apply."
                : "Nothing in this view. Try another filter."}
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {shown.map((course) => (
                <CourseCard
                  key={course.crn}
                  course={course}
                  filter={filter}
                  selected={selected}
                  onToggle={toggle}
                  onToggleMany={setMany}
                />
              ))}
            </div>
          )}

          <Footer
            selectedCount={selected.size}
            total={decisions.length}
            losing={losing}
            onSelectAll={() => setMany(decisions, true)}
            onClear={() => setSelected(new Set())}
            onApply={() => apply.mutate()}
            busy={apply.isPending}
          />
        </>
      ) : null}
    </section>
  );
}

function Summary({ preview }: { preview: TimetablePreview }) {
  const { summary } = preview;
  const nothingToDo =
    summary.changed + summary.added + summary.removed + summary.courseChanges + summary.coursesAdded === 0;

  return (
    <div className="mt-5 rounded-lg border border-[#d9dee7] bg-white p-5">
      <h4 className="text-base font-semibold text-[#171717]">
        {preview.filename} against {preview.term.name}
      </h4>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <Count label="Changed" value={summary.changed} />
        <Count label="New sessions" value={summary.added} />
        <Count label="Cancelled" value={summary.removed} />
        <Count label="Course details" value={summary.courseChanges} />
        <Count label="New courses" value={summary.coursesAdded} />
        <Count label="Courses dropped" value={summary.coursesRemoved} />
        <Count label="Unchanged" value={summary.unchanged} muted />
      </dl>

      {nothingToDo ? null : (
        <div className="mt-4 space-y-2">
          {summary.uncertainMatches > 0 ? (
            <Note tone="warn" icon={HelpCircle}>
              {summary.uncertainMatches} of the changed rows were matched by inference rather than certainty —
              they carry a note saying how. If a pairing looks wrong, leave it unticked and it stays as it is.
            </Note>
          ) : null}
          {summary.coursesRemoved > 0 ? (
            <Note tone="danger" icon={AlertTriangle}>
              {summary.coursesRemoved} course(s) are missing from this export. Approving a removal also removes
              its enrolments, so {summary.studentsLosingCourses} student(s) would lose the course entirely.
            </Note>
          ) : null}
          {summary.coursesAdded > 0 ? (
            <Note tone="warn" icon={AlertTriangle}>
              {summary.coursesAdded} new course(s) have nobody enrolled yet. They stay empty until a block
              carries their CRN and the semester is published again.
            </Note>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#667085]">{label}</dt>
      <dd className={muted ? "text-lg font-semibold text-[#98a2b3]" : "text-lg font-semibold text-[#171717]"}>
        {value}
      </dd>
    </div>
  );
}

function Note({
  tone,
  icon: Icon,
  children,
}: {
  tone: "warn" | "danger";
  icon: typeof AlertTriangle;
  children: React.ReactNode;
}) {
  const skin =
    tone === "danger"
      ? "border-[#e5b7b9] bg-[#fdf3f3] text-[#a6292f]"
      : "border-[#e8d9ac] bg-[#fdf9ee] text-[#8a6116]";
  return (
    <p className={`flex items-start gap-2 rounded-md border px-4 py-3 text-sm leading-6 ${skin}`}>
      <Icon size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function CourseCard({
  course,
  filter,
  selected,
  onToggle,
  onToggleMany,
}: {
  course: DiffCourse;
  filter: DiffFilter;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], on: boolean) => void;
}) {
  const keys = keysOf(course);
  const allOn = keys.length > 0 && keys.every((key) => selected.has(key));
  const someOn = keys.some((key) => selected.has(key));
  const dropped = course.status === "removed";
  /*
   * Closed until asked. The registrar re-issues a term at a time, so a course's rows are
   * mostly the same change said forty times; the sentence in the header is what a
   * coordinator actually decides on, and the rows are there for when it is not enough.
   */
  const [open, setOpen] = useState(false);

  return (
    <article
      className={`rounded-lg border bg-white ${dropped ? "border-[#e5b7b9]" : "border-[#d9dee7]"}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e4e8ef] px-5 py-3.5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {keys.length > 0 ? (
            <input
              type="checkbox"
              checked={allOn}
              ref={(box) => {
                // Part of a course ticked is neither on nor off, and saying "off" would be
                // a lie that costs somebody the rows they already approved.
                if (box) box.indeterminate = !allOn && someOn;
              }}
              onChange={() => onToggleMany(keys, !allOn)}
              aria-label={`Approve every change to ${course.title}, CRN ${course.crn}`}
              className="mt-1 size-4 shrink-0 accent-[#1f4e79]"
            />
          ) : null}
          <div className="min-w-0">
            <h4 className="truncate text-sm font-semibold text-[#171717]">
              {course.title}
              {course.groupLabel ? <span className="text-[#667085]"> · {course.groupLabel}</span> : null}
            </h4>
            <p className="mt-0.5 text-sm text-[#344054]">{summariseCourse(course)}</p>
            <p className="mt-0.5 text-xs text-[#667085]">
              CRN {course.crn} · {course.code}
              {course.kind ? ` · ${course.kind}` : ""}
            </p>
          </div>
        </div>
        {course.sessions.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            {open ? "Hide" : `Show ${course.sessions.length}`}
          </button>
        ) : null}
      </header>

      {open ? (
      <ul className="divide-y divide-[#eef1f5]">
        {courseRowMatches(course, filter) ? (
          <CourseRow course={course} checked={selected.has(courseKey(course.crn))} onToggle={onToggle} />
        ) : null}
        {course.sessions.map((session) => (
          <SessionRow
            key={rowKey(course.crn, session)}
            crn={course.crn}
            session={session}
            /* A dropped course's sessions go with the course, so they are shown but not ticked. */
            approvable={!dropped && session.status !== "unchanged"}
            checked={selected.has(rowKey(course.crn, session))}
            onToggle={onToggle}
          />
        ))}
      </ul>
      ) : null}
    </article>
  );
}

function CourseRow({
  course,
  checked,
  onToggle,
}: {
  course: DiffCourse;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  const status = course.status === "present" ? "changed" : course.status;
  const summary =
    course.status === "added"
      ? "A course this semester has never held"
      : course.status === "removed"
        ? `Missing from this export — ${course.enrolledStudents} student(s) would lose it, and its ${course.sessions.length} session(s) go with it`
        : course.courseChanges.join(" · ");

  return (
    <li className="flex items-start gap-3 bg-[#fbfcfe] px-5 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(courseKey(course.crn))}
        aria-label={`Approve the course change for CRN ${course.crn}`}
        className="mt-1 size-4 shrink-0 accent-[#1f4e79]"
      />
      <div className="min-w-0 flex-1">
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${BADGES[status]}`}>
          {course.status === "present" ? "Course details" : LABELS[status]}
        </span>
        <p className="mt-1 text-sm text-[#344054]">{summary}</p>
      </div>
    </li>
  );
}

function SessionRow({
  crn,
  session,
  approvable,
  checked,
  onToggle,
}: {
  crn: string;
  session: DiffSession;
  approvable: boolean;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  const values = session.after ?? session.before;
  if (!values) return null;

  return (
    <li className="flex items-start gap-3 px-5 py-3">
      {approvable ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(rowKey(crn, session))}
          aria-label={`Approve ${LABELS[session.status]} on ${describeSession(values)}`}
          className="mt-1 size-4 shrink-0 accent-[#1f4e79]"
        />
      ) : (
        <span className="mt-1 size-4 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGES[session.status]}`}>
            {LABELS[session.status]}
          </span>
          <span className="text-sm tabular-nums text-[#344054]">
            {describeSession(session.before ?? values)}
          </span>
        </div>
        {session.changes.length > 0 ? (
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {session.changes.map((change) => (
              <li key={change} className="text-sm font-semibold text-[#1f4e79]">
                {change}
              </li>
            ))}
          </ul>
        ) : null}
        {session.status === "changed" && !session.isCertain ? (
          <p className="mt-1 text-xs text-[#8a6116]">
            Matched on {session.matchedOn} — check this is the same session before approving it.
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Footer({
  selectedCount,
  total,
  losing,
  onSelectAll,
  onClear,
  onApply,
  busy,
}: {
  selectedCount: number;
  total: number;
  losing: number;
  onSelectAll: () => void;
  onClear: () => void;
  onApply: () => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d9dee7] bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex max-w-[86rem] flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-[#344054]">
          <b className="tabular-nums">{selectedCount}</b> of {total} change(s) approved
          {losing > 0 ? (
            <span className="ml-2 font-semibold text-[#a6292f]">· {losing} student(s) would be unenrolled</span>
          ) : null}
          <span className="ml-3">
            <button type="button" onClick={onSelectAll} className="font-semibold text-[#1f4e79] hover:underline">
              Tick everything
            </button>
            {selectedCount > 0 ? (
              <button type="button" onClick={onClear} className="ml-3 font-semibold text-[#1f4e79] hover:underline">
                Clear
              </button>
            ) : null}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onApply}
            disabled={selectedCount === 0 || busy}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
          >
            {busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : null}
            Apply {selectedCount} change(s)
          </button>
        </div>
      </div>
    </div>
  );
}
