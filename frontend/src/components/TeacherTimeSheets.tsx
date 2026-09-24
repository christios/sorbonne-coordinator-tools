/**
 * A teacher's time sheets, as links to where the workbooks actually live.
 *
 * The sheets are Excel files in OneDrive, owned and edited by the people who keep them.
 * Copying one into this database would make a second, staler copy of somebody else's
 * file, and nobody would know which of the two was the real one. What was missing was
 * never the file: it was knowing, from the teacher's profile, which sheet is theirs.
 *
 * So this card holds a label, an academic year and a link, and the link opens in a new
 * tab. Who may open it is OneDrive's decision, not ours — a coordinator without access
 * sees Microsoft's own sign-in, which is the right place for that conversation.
 *
 * It is laid out by pay period rather than by sheet, because a missing sheet is the thing
 * worth seeing and a list of the ones that exist cannot show it. Each period says what
 * the teacher actually taught in it — the classes that met, less the cancelled, plus any
 * they stood in for — beside the sheet claiming it, or beside the fact that none is
 * filed. Sheets from before this way of working, or filed against no period at all, keep
 * a place of their own underneath: nothing that was here disappears.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, ExternalLink, FileSpreadsheet, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SelectMenu } from "@/components/SelectMenu";
import { buildCards } from "@/services/courseCards";
import { asHours, hoursTaught, minutesByTeacher } from "@/services/hoursInPeriod";
import { fetchActiveTeachers, fetchFacilitySections, fetchTermLinks } from "@/services/portalLists";
import { fetchSessionChanges } from "@/services/sessionChanges";
import { fetchCourseCards } from "@/services/studentDatabase";
import { sectionsTaughtBy } from "@/services/teacherLoad";
import { fetchPayCycles, fetchTeacherSummary } from "@/services/teachers";
import { fetchTimetableTerms } from "@/services/timetables";
import {
  type SubmittedTimeSheet,
  type TeacherTimeSheet,
  createTeacherTimeSheet,
  deleteTeacherTimeSheet,
  listSubmittedTimeSheets,
  listTeacherTimeSheets,
  updateTeacherTimeSheet,
} from "@/services/teachers";
import {
  opensOnFor,
  periodChoices,
  periodContaining,
  periodEnd,
  periodLabel,
  PERIOD_OPENS_ON,
} from "@/services/payPeriods";
import { isWebLink, linkHost } from "@/services/timeSheetLinks";

type Draft = { label: string; academicYear: string; url: string; periodStart: string };

export function TimeSheetsCard({ teacherId, className = "" }: { teacherId: string; className?: string }) {
  const client = useQueryClient();
  /*
   * The period a new sheet is for defaults to the one running now, because that is the
   * one being filed nearly every time. The list runs back far enough to file a late one
   * and one ahead for a sheet handed in early.
   */
  const offered = periodChoices();
  const blank: Draft = { label: "", academicYear: "2026-2027", url: "", periodStart: periodContaining(new Date()) };
  const sheets = useQuery({
    queryKey: ["teacher-time-sheets", teacherId],
    queryFn: () => listTeacherTimeSheets(teacherId),
  });
  /*
   * What the Part-Time Timesheets app has had approved. A period answered there is
   * answered: the row shows the claim rather than "No sheet filed", and there is nothing
   * here to edit or delete, because the sheet is theirs and lives in their app.
   */
  const submitted = useQuery({
    queryKey: ["submitted-time-sheets", teacherId],
    queryFn: () => listSubmittedTimeSheets(teacherId),
  });
  // One form for both jobs: adding, or correcting the one being edited. A pasted link is
  // got wrong often enough that fixing it must not mean deleting the row and retyping.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<TeacherTimeSheet | null>(null);

  /*
   * What the teacher actually taught, so a period can be read beside the sheet claiming
   * it. The semester is asked for because a period alone cannot say which term's classes
   * to count, and a semester carries no dates of its own to work it out from.
   */
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const [termId, setTermId] = useState("");
  const actives = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const mine = (actives.data ?? []).find((teacher) => teacher.partTimeTeacherId === teacherId) ?? null;
  const cards = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const cycles = useQuery({ queryKey: ["pay-cycles"], queryFn: fetchPayCycles });
  const summary = useQuery({ queryKey: ["teacher-summary"], queryFn: fetchTeacherSummary });
  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? id;
  const built = useMemo(
    () => buildCards(cards.data ?? [], termName, []),
    [cards.data, terms.data], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /*
   * Opens on a semester this teacher actually teaches in.
   *
   * The first semester in the list is whichever the Hub returns first, and for a part-time
   * teacher that is as likely as not one they have no classes in — so the card opened on
   * "0 h, 0 classes" and looked broken rather than empty.
   */
  const taughtIn = useMemo(() => {
    if (!mine) return [];
    return [
      ...new Set(
        sectionsTaughtBy(built, mine.id, mine.fullName)
          .map((section) => section.termId)
          .filter(Boolean),
      ),
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the id and name are what is read
  }, [built, mine?.id, mine?.fullName]);
  const chosenTerm = termId || taughtIn[0] || terms.data?.[0]?.id || "";

  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const termCode = links.data?.[chosenTerm] ?? "";
  const notes = useQuery({
    queryKey: ["session-changes", termCode],
    queryFn: () => fetchSessionChanges(termCode),
    enabled: Boolean(termCode),
    retry: false,
  });
  const opensOn = opensOnFor(cycles.data?.cycles ?? {}, chosenTerm, cycles.data?.default ?? PERIOD_OPENS_ON);

  /** Their own sections this semester, and any CRN they stood in on. */
  const crns = useMemo(() => {
    if (!mine) return [];
    const own = sectionsTaughtBy(built, mine.id, mine.fullName)
      .filter((section) => section.termId === chosenTerm && section.crn)
      .map((section) => section.crn);
    const stoodIn = (notes.data ?? [])
      .filter((note) => note.kind === "covered" && note.coverTeacherId === mine.id)
      .map((note) => note.crn);
    return [...new Set([...own, ...stoodIn])];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the id and name are what is read
  }, [built, notes.data, mine?.id, mine?.fullName, chosenTerm]);

  const met = useQuery({
    queryKey: ["facility-sections", termCode, crns.join(",")],
    queryFn: () => fetchFacilitySections(termCode, crns),
    enabled: Boolean(termCode) && crns.length > 0,
    retry: false,
  });

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["teacher-time-sheets", teacherId] });
    // The period's task closes itself once a sheet claims the period, so the list of
    // tasks on this same profile is stale the moment one is filed.
    void client.invalidateQueries({ queryKey: ["tasks", "teacher"] });
  };
  const close = () => {
    setDraft(null);
    setEditingId(null);
  };
  const save = useMutation({
    mutationFn: (input: Draft) =>
      editingId
        ? updateTeacherTimeSheet(teacherId, editingId, input)
        : createTeacherTimeSheet(teacherId, input),
    onSuccess: () => {
      close();
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTeacherTimeSheet(teacherId, id),
    onSuccess: () => void refresh(),
  });

  // Its own memo: an empty array made fresh each render would rebuild the periods below
  // on every keystroke in the form.
  const rows = useMemo(() => sheets.data ?? [], [sheets.data]);
  const ready = Boolean(draft?.label.trim()) && isWebLink(draft?.url ?? "");

  /** One row per pay period something happened in: a class that met, or a sheet filed. */
  const periods = useMemo(() => {
    const met_in = (met.data?.sections ?? []).flatMap((section) =>
      section.meetings.map((meeting) => periodContaining(new Date(`${meeting.meetsOn}T00:00:00`), opensOn)),
    );
    const filed = rows.map((sheet) => sheet.periodStart).filter(Boolean);
    const approved = (submitted.data ?? []).map((sheet) => sheet.periodStart).filter(Boolean);
    return [...new Set([...met_in, ...filed, ...approved])]
      .sort()
      .reverse()
      .map((start) => {
        const { hours, stranded } = hoursTaught({
          sections: met.data?.sections ?? [],
          changes: notes.data ?? [],
          period: { from: start, to: periodEnd(start) },
          staffing: () => ({ id: mine?.id ?? "", name: mine?.fullName ?? "" }),
        });
        const ours = hours.filter((hour) => hour.teacherId === (mine?.id ?? ""));
        return {
          start,
          minutes: minutesByTeacher(hours)[mine?.id ?? ""] ?? 0,
          classes: ours.length,
          covered: ours.filter((hour) => hour.covered).length,
          stranded: stranded.length,
          sheet: rows.find((sheet) => sheet.periodStart === start) ?? null,
          submitted: (submitted.data ?? []).find((sheet) => sheet.periodStart === start) ?? null,
        };
      });
  }, [met.data, notes.data, rows, submitted.data, opensOn, mine?.id, mine?.fullName]);

  /** Sheets against no period, or a period nothing else knows about. Nothing disappears. */
  const loose = rows.filter((sheet) => !periods.some((period) => period.sheet?.id === sheet.id));
  const contracted = summary.data?.[teacherId]?.contractedHours ?? 0;

  const fileFor = (start: string) => {
    setEditingId(null);
    setDraft({ label: periodLabel(start), academicYear: "2026-2027", url: "", periodStart: start });
    save.reset();
  };
  const editSheet = (sheet: TeacherTimeSheet) => {
    setEditingId(sheet.id);
    setDraft({
      label: sheet.label,
      academicYear: sheet.academicYear,
      url: sheet.url,
      periodStart: sheet.periodStart,
    });
    save.reset();
  };

  return (
    <section className={`${className} rounded-lg border border-[#d9dee7] bg-white p-5`}>
      {/*
        * The description sits under the whole header rather than beside the button. This
        * card shares a row with Requisitions, so its column is half a page wide, and a
        * sentence squeezed next to a button there wraps to four lines and pushes the
        * button off the heading it belongs to.
        */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Time sheets</h3>
        <button
          type="button"
          onClick={() => {
            if (draft && !editingId) close();
            else {
              setEditingId(null);
              setDraft(blank);
              save.reset();
            }
          }}
          title="For a period with no class in it, or a teacher with no classes at all"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
        >
          {/*
            * The escape hatch, not the main road: each period files its own sheet now.
            * It stays because two things still need it — a period where no class was
            * scheduled, and a teacher nobody has joined to an Active teacher, who has no
            * periods at all and could otherwise file nothing.
            */}
          <Plus size={16} /> Add one by hand
        </button>
      </div>
      <p className="mt-1 text-sm text-[#667085]">
        One row per pay period: what they actually taught in it, and the sheet claiming it.
        The workbooks stay in OneDrive where they are kept.
        {contracted ? ` Contracted for ${contracted} h.` : ""}
      </p>
      <div className="mt-3 w-52">
        <SelectMenu
          label="Semester for the hours"
          value={chosenTerm}
          onChange={setTermId}
          options={(terms.data ?? []).map((term) => ({ value: term.id, label: term.name }))}
          placeholder="Which semester…"
        />
      </div>

      {draft ? (
        <form
          className="mt-4 grid gap-3 rounded-md bg-[#f8fafc] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) save.mutate({ ...draft, url: draft.url.trim() });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <Field
              label="Label"
              value={draft.label}
              placeholder="Semester 1 time sheet"
              onChange={(label) => setDraft({ ...draft, label })}
            />
            <Field
              label="Academic year"
              value={draft.academicYear}
              placeholder="2026-2027"
              onChange={(academicYear) => setDraft({ ...draft, academicYear })}
            />
          </div>
          {/*
            * One choice, not a pair of months. The department's period runs the 15th to
            * the 14th, which is why a sheet covering "August and September" is a single
            * period rather than two.
            */}
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            <span>Period it covers</span>
            <SelectMenu
              label="Period it covers"
              value={draft.periodStart}
              onChange={(periodStart) => setDraft({ ...draft, periodStart })}
              placeholder="Not said"
              options={[
                { value: "", label: "Not said" },
                /* A sheet filed long ago keeps its own period even once it drops off the list. */
                ...(draft.periodStart && !offered.includes(draft.periodStart)
                  ? [draft.periodStart, ...offered]
                  : offered
                ).map((start) => ({ value: start, label: periodLabel(start) })),
              ]}
            />
          </label>
          <Field
            label="Link"
            value={draft.url}
            placeholder="https://…sharepoint.com/…"
            onChange={(url) => setDraft({ ...draft, url })}
          />
          {/*
            * Said before the press, not after it. Pasting the file path from Explorer
            * instead of the share link is the mistake this catches, and a round trip to
            * the server to be told so is a round trip too many.
            */}
          {draft.url.trim() && !isWebLink(draft.url) ? (
            <p className="text-sm text-[#8a6116]">
              That is not a web address. In OneDrive use Share, then Copy link, and paste what it gives you.
            </p>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-sm text-[#8f1f25]">
              {(save.error as Error).message}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!ready || save.isPending}
              className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : editingId ? "Save changes" : "Add the link"}
            </button>
            <button type="button" onClick={close} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {sheets.isLoading ? <p className="mt-4 text-sm text-[#667085]">Reading the time sheets…</p> : null}
      {sheets.error ? (
        <p role="alert" className="mt-4 text-sm text-[#8f1f25]">
          {(sheets.error as Error).message}
        </p>
      ) : null}

      {/*
        * No breakpoint on a row below, and nothing in one that cannot shrink. The card
        * sits in half a page's width whatever the window is doing, so a `sm:` rule would
        * be answering a question about the window rather than about the column, and the
        * created/updated chips a requisition shows would push the buttons straight out of
        * the card. `min-w-0` on the row is load-bearing for the same reason: a grid item
        * is allowed to be as wide as its longest unbreakable line, and a truncated label
        * is exactly that, so without it a long label pushes the buttons past the edge
        * instead of being cut.
        */}
      {periods.length ? (
        <div role="list" className="mt-4 grid gap-3" aria-label="Pay periods">
          {periods.map((period) => (
            <article
              key={period.start}
              role="listitem"
              className="flex min-w-0 items-center gap-3 rounded-lg border border-[#d9dee7] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold text-[#344054]">{periodLabel(period.start)}</span>
                  <span className="tabular-nums text-[#1f4e79]">{asHours(period.minutes)} h</span>
                  <span className="text-xs text-[#98a2b3]">
                    {period.classes} class{period.classes === 1 ? "" : "es"}
                    {period.covered ? ` · ${period.covered} covered for somebody` : ""}
                  </span>
                </p>
                {period.sheet ? (
                  <a
                    href={period.sheet.url}
                    target="_blank"
                    rel="noreferrer"
                    title={period.sheet.url}
                    className="mt-1 flex max-w-full items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
                  >
                    <FileSpreadsheet size={14} className="shrink-0 text-[#1f6b47]" aria-hidden="true" />
                    <span className="truncate">{period.sheet.label}</span>
                    <ExternalLink size={13} className="shrink-0" aria-hidden="true" />
                  </a>
                ) : period.submitted ? (
                  <Submitted sheet={period.submitted} taught={asHours(period.minutes)} />
                ) : (
                  <span className="mt-1 block text-sm text-[#a6292f]">No sheet filed</span>
                )}
                {period.stranded ? (
                  <span className="mt-1 block text-xs text-[#8a6116]">
                    {period.stranded} note{period.stranded === 1 ? "" : "s"} about an hour the portal has moved
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {period.submitted && !period.sheet ? null : period.sheet ? (
                  <>
                    <button
                      type="button"
                      aria-label={`Edit ${period.sheet.label}`}
                      onClick={() => period.sheet && editSheet(period.sheet)}
                      className="rounded p-1.5 text-[#344054] hover:bg-[#eef1f5]"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      disabled={remove.isPending}
                      aria-label={`Remove ${period.sheet.label}`}
                      onClick={() => setPendingDeletion(period.sheet)}
                      className="rounded p-1.5 text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`File a sheet for ${periodLabel(period.start)}`}
                    onClick={() => fileFor(period.start)}
                    className="rounded-md border border-[#b7bec8] px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                  >
                    File one
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {/* Filed before this way of working, or against no period at all. Nothing vanishes. */}
      {loose.length ? (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">Not against a period here</p>
          <div role="list" className="mt-2 grid gap-2" aria-label="Other time sheets">
            {loose.map((sheet) => (
              <article key={sheet.id} role="listitem" className="flex min-w-0 items-center gap-3 rounded-lg border border-[#e4e8ef] p-3">
                <FileSpreadsheet size={16} className="shrink-0 text-[#1f6b47]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <a href={sheet.url} target="_blank" rel="noreferrer" title={sheet.url} className="flex max-w-full items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline">
                    <span className="truncate">{sheet.label}</span>
                    <ExternalLink size={13} className="shrink-0" aria-hidden="true" />
                  </a>
                  <span className="mt-0.5 block truncate text-xs text-[#667085]">
                    {[periodLabel(sheet.periodStart) || "no period said", sheet.academicYear, linkHost(sheet.url)].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" aria-label={`Edit ${sheet.label}`} onClick={() => editSheet(sheet)} className="rounded p-1.5 text-[#344054] hover:bg-[#eef1f5]">
                    <Pencil size={16} />
                  </button>
                  <button type="button" disabled={remove.isPending} aria-label={`Remove ${sheet.label}`} onClick={() => setPendingDeletion(sheet)} className="rounded p-1.5 text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50">
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!periods.length && !loose.length && !sheets.isLoading && !draft ? (
        <p className="py-6 text-sm text-[#667085]">
          {mine
            ? "No class of theirs met in this semester, and no sheet is filed."
            : "Not joined to an Active teacher, so there are no classes to count. Link them on Active teachers, or add a sheet by hand."}
        </p>
      ) : null}
      {remove.error ? (
        <p role="alert" className="mt-2 text-sm text-[#8f1f25]">
          {(remove.error as Error).message}
        </p>
      ) : null}

      {/*
        * Only the link goes. Saying so is the whole point of the wording: nobody should
        * hesitate over whether this deletes the workbook in OneDrive.
        */}
      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Remove this link?"
        description={`Remove the link to ${pendingDeletion?.label ?? "this time sheet"}? The workbook in OneDrive is untouched.`}
        confirmLabel="Remove the link"
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => {
          if (pendingDeletion) remove.mutate(pendingDeletion.id);
          setPendingDeletion(null);
        }}
      />
    </section>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#344054]">
      <span>{label}</span>
      <span className="relative">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-8 font-normal"
        />
        {value ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[#98a2b3] hover:bg-[#eef1f5] hover:text-[#344054]"
          >
            <X size={14} />
          </button>
        ) : null}
      </span>
    </label>
  );
}

/**
 * A period the Part-Time Timesheets app has had approved.
 *
 * The claim and what the registrar's timetable says was taught, side by side. They will
 * not always agree and a difference is not a fault — a class swapped with a colleague,
 * an hour of something the timetable does not hold — but it is the one thing worth
 * reading here, and nobody was going to compare them by hand.
 *
 * Nothing to edit. The sheet is theirs, it lives in their app, and a correction made here
 * would be overwritten by the next push of the same period.
 */
function Submitted({ sheet, taught }: { sheet: SubmittedTimeSheet; taught: number }) {
  const [open, setOpen] = useState(false);
  const apart = Math.round((sheet.claimedHours - taught) * 100) / 100;
  return (
    <span className="mt-1 block text-sm">
      {/*
        * The summary opens the sheet. What arrived is the days somebody worked, and a
        * total with no way to see the days behind it is a number to be taken on trust —
        * which is the opposite of why the claim and the timetable are shown together.
        */}
      <button
        type="button"
        onClick={() => setOpen((showing) => !showing)}
        aria-expanded={open}
        className="flex flex-wrap items-baseline gap-x-2 rounded text-left hover:underline"
      >
        <span className="inline-flex items-center gap-1.5 font-semibold text-[#1f6b47]">
          <CheckCircle2 size={14} className="shrink-0" aria-hidden="true" />
          Submitted {sheet.claimedHours} h
        </span>
        {apart ? (
          <span className="text-[#8a6116]">
            {apart > 0 ? `${apart} h more than` : `${Math.abs(apart)} h less than`} the timetable has
          </span>
        ) : (
          <span className="text-[#667085]">matching the timetable</span>
        )}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`shrink-0 text-[#98a2b3] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      <span className="mt-0.5 block text-xs text-[#98a2b3]">
        {sheet.days.length} day{sheet.days.length === 1 ? "" : "s"}
        {sheet.approvedBy ? ` · approved by ${sheet.approvedBy}` : ""}
      </span>
      {open ? <Days sheet={sheet} /> : null}
    </span>
  );
}

/**
 * The days as they were entered, in the order they were worked.
 *
 * Read-only, and it says so by having nothing to press. The sheet belongs to the person
 * who filed it and lives in their app; a correction made here would be overwritten by
 * the next push of the same period.
 */
function Days({ sheet }: { sheet: SubmittedTimeSheet }) {
  const added = Math.round(sheet.days.reduce((sum, day) => sum + (Number(day.hours) || 0), 0) * 100) / 100;
  if (!sheet.days.length) {
    return (
      <span className="mt-2 block rounded-md border border-dashed border-[#d0d5dd] px-3 py-2 text-xs text-[#667085]">
        The sheet came through with no days on it. The total above is what it claimed.
      </span>
    );
  }
  return (
    <span className="mt-2 block overflow-hidden rounded-md border border-[#e4e8ef]">
      <table className="w-full text-left text-xs">
        <thead className="bg-[#f8f9fb] text-[#667085]">
          <tr>
            <th scope="col" className="px-2 py-1 font-medium">Day</th>
            <th scope="col" className="px-2 py-1 font-medium">Time</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Hours</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#f2f4f7]">
          {sheet.days.map((day, index) => (
            <tr key={`${day.date}-${day.from}-${index}`}>
              <td className="px-2 py-1 align-top text-[#344054]">
                <span className="font-medium">{dayLabel(day.date) || day.day}</span>
                {day.details ? <span className="block text-[#98a2b3]">{day.details}</span> : null}
              </td>
              <td className="px-2 py-1 align-top tabular-nums text-[#667085]">
                {day.from && day.to ? `${day.from}–${day.to}` : "—"}
              </td>
              <td className="px-2 py-1 text-right align-top tabular-nums text-[#344054]">{day.hours}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-[#e4e8ef] bg-[#f8f9fb]">
          <tr>
            <td className="px-2 py-1 font-medium text-[#667085]" colSpan={2}>
              {sheet.approvedOn ? `Approved ${dayLabel(sheet.approvedOn.slice(0, 10))}` : "These days"}
            </td>
            <td className="px-2 py-1 text-right font-semibold tabular-nums text-[#344054]">{added}</td>
          </tr>
          {/*
            * The total the app sent, when the days do not come to it. Printing the claim
            * under the lines as though it were their sum would be the one thing this
            * table must not do: it exists so a number can be checked, not restated.
            */}
          {added === sheet.claimedHours ? null : (
            <tr>
              <td className="px-2 py-1 text-[#8a6116]" colSpan={3}>
                The app sent a total of {sheet.claimedHours} h, which these days do not come to.
              </td>
            </tr>
          )}
        </tfoot>
      </table>
    </span>
  );
}

/** "Mon 19 Oct" — the date said the way somebody reading a week would say it. */
function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((day || "").trim());
  if (!match) return "";
  const when = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(when.getTime())) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[when.getDay()]} ${when.getDate()} ${months[when.getMonth()]}`;
}
