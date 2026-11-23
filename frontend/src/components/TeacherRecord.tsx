import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState } from "react";

import { CrnRecord } from "@/components/CrnRecord";
import { SourceMark } from "@/components/DataTable";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { usePortalSemester } from "@/components/PortalSemesterMenu";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { SessionChangeList } from "@/components/SessionChangeList";
import { adjustmentsFor, fetchSessionChanges } from "@/services/sessionChanges";
import { STAFF_STATUSES, bucketLabel, statusFromPortal } from "@/services/cohortLoads";
import { buildCards, parentsOf } from "@/services/courseCards";
import {
  fetchActiveCourses,
  fetchActiveCrns,
  fetchActiveTeachers,
  fetchFacilityHours,
  fetchTermLinks,
  setStaffStatus,
  type ActiveCrn,
  type ActiveTeacher,
} from "@/services/portalLists";
import { requisitionCheck, semesterContract, semesterDaysOf } from "@/services/requisitionCheck";
import { teacherTimetable } from "@/services/personTimetable";
import { requisitionHours, totalAdminHours } from "@/services/requisitions";
import type { ColumnSource } from "@/services/studentColumns";
import {
  type BookedHours,
  type TaughtSection,
  bookedHoursOf,
  portalShareOf,
  registrarHoursFor,
  sameTeacher,
  sectionsTaughtBy,
} from "@/services/teacherLoad";
import { getTeacherRequisition, listTeacherRequisitions } from "@/services/teachers";
import { fetchPlans } from "@/services/semesterPlans";
import { semesterAsItWent } from "@/services/teacherHoursRows";
import { fetchCohorts, fetchCourseCards } from "@/services/studentDatabase";
import { requestSheets } from "@/services/timetableExport";
import { fetchTimetableTerms } from "@/services/timetables";
import { useGroupCohorts } from "@/services/groupCohorts";

/**
 * Enough of a teacher to open their record.
 *
 * A row from the department's list is one of these already; a row from the portal's own
 * list has no id of ours and calls its address `psuadEmail`, so both spellings are taken.
 */
export type TeacherRef = Pick<ActiveTeacher, "id" | "fullName"> & Partial<ActiveTeacher> & { psuadEmail?: string };

const round = (value: number) => Math.round(value * 100) / 100;

/** One fact, with room for the answer to be missing. */
function Fact({ label, value, source }: { label: string; value: string; source?: ColumnSource }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
        {label}
        {source ? <SourceMark source={source} /> : null}
      </p>
      <p className={`mt-0.5 text-sm ${value ? "text-[#344054]" : "text-[#c8d0da]"}`}>{value || "not said"}</p>
    </div>
  );
}

/**
 * What they are for the budget — full-time, part-time, visiting professor, PhD or postdoc —
 * which Teacher hours splits each cohort's hours by. The department's word where it has
 * given one, and the portal's type read as one where it has not: the portal lists some PhD
 * students as full time, and some part-timers as a local professional assignment.
 */
export function StaffStatusFact({ teacher }: { teacher: ActiveTeacher | null }) {
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => setStaffStatus(id, status),
    onSuccess: () => client.invalidateQueries({ queryKey: ["active-teachers"] }),
  });
  if (!teacher) return <Fact label="Status for the budget" value="" source="planning" />;
  const fromPortal = statusFromPortal(teacher.type, teacher.source);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
        Status for the budget
        <SourceMark source="planning" />
      </p>
      <select
        aria-label="Status for the budget"
        value={(teacher.staffStatus ?? "").toUpperCase()}
        disabled={save.isPending}
        onChange={(event) => save.mutate({ id: teacher.id, status: event.target.value })}
        className="mt-0.5 max-w-full rounded-md border border-[#cbd5e1] bg-white px-2 py-1 text-sm text-[#344054]"
      >
        <option value="">As the portal says ({fromPortal ? bucketLabel(fromPortal) : "nothing"})</option>
        {STAFF_STATUSES.map(({ status, label, long }) => (
          <option key={status} value={status}>
            {label} — {long}
          </option>
        ))}
      </select>
      {save.error ? <p role="alert" className="mt-1 text-xs text-[#a6292f]">{(save.error as Error).message}</p> : null}
    </div>
  );
}

/**
 * One teacher, in full: who the portal and the department say they are, and what they
 * are actually teaching.
 *
 * The list pages answer "who is on the department's list" and stop there, so "what does
 * Samar teach, and how much of it" meant reading Groups & CRNs course by course. Both
 * halves are here, and the second is read the way the workbook reads it — through each
 * course's request — so a section that names nobody but whose course names this teacher
 * is counted as theirs, exactly as it will be in the file the timetabler receives.
 */
export function TeacherRecord({
  open,
  teacher,
  onClose,
}: {
  open: boolean;
  teacher: TeacherRef;
  onClose: () => void;
}) {
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open, retry: false });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: () => fetchActiveCourses(), enabled: open });
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: open });
  // A teacher opened from the portal's list may not be on the department's; if they are,
  // their sections are found by our id rather than by the spelling of their name.
  const active = useQuery({ queryKey: ["active-teachers"], queryFn: () => fetchActiveTeachers(), enabled: open });
  const held =
    (teacher.id ? (active.data ?? []).find((row) => row.id === teacher.id) : null) ??
    (teacher.portalTeacherId
      ? (active.data ?? []).find((row) => row.portalTeacherId === teacher.portalTeacherId)
      : null) ??
    null;

  const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? (id ? "unknown semester" : "");
  // A section's parent in its own semester: the registrar reuses CRN numbers term to term.
  const linked = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open, retry: false });
  const parentOf = useMemo(() => parentsOf(registered.data ?? [], linked.data ?? {}), [registered.data, linked.data]);
  const cards = useMemo(
    () => buildCards(catalogues.data ?? [], termName, courses.data ?? [], parentOf),
    [catalogues.data, terms.data, courses.data, parentOf], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const groupCohorts = useGroupCohorts(open);
  const sections = useMemo(
    () => sectionsTaughtBy(cards, held?.id ?? teacher.id ?? "", teacher.fullName, groupCohorts),
    [cards, held, teacher.id, teacher.fullName, groupCohorts],
  );

  /*
   * The third count: what their requisitions pay for. Only a part-time teacher has one,
   * and it is read through the part-time database they are linked to.
   */
  const partTimeId = held?.partTimeTeacherId ?? "";
  const requisitionList = useQuery({
    queryKey: ["teacher-requisitions", partTimeId],
    queryFn: () => listTeacherRequisitions(partTimeId),
    enabled: open && Boolean(partTimeId),
    retry: false,
  });
  const { requisitions, requisitionsLoading } = useQueries({
    queries: (requisitionList.data ?? []).map((item) => ({
      queryKey: ["teacher-requisition", item.id],
      queryFn: () => getTeacherRequisition(item.id),
      enabled: open,
      retry: false,
    })),
    combine: (reads) => ({
      requisitions: reads.flatMap((read) => (read.data ? [read.data] : [])),
      requisitionsLoading: reads.some((read) => read.isLoading),
    }),
  });

  /*
   * The tiles, and the requisition held against the planning, are the semester chosen in
   * the header's, as Actual teaching hours always was. With Semester 2 planned, the year's
   * hours (Bilal Maaz's 110) stood beside one semester's portal hours and requisition (50).
   * A requisition names no semester: it is the one its contract dates overlap.
   */
  const { semester, term: semesterTerm } = usePortalSemester();
  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans, enabled: open, retry: false });
  const semesterDays = useMemo(
    () => semesterDaysOf(plans.data ?? [], semester ? { id: semester.id, termCode: semesterTerm } : null),
    [plans.data, semester, semesterTerm],
  );
  const contract = semester
    ? semesterContract(sections, requisitions, semesterDays, semester.id)
    : { requisitions, runsPast: [], warnings: requisitionCheck(sections, requisitions) };
  const contracted = requisitionHours(contract.requisitions);
  // Paid on the same requisitions and never taught, so said beside the teaching, not in it.
  const admin = contract.requisitions.reduce((sum, requisition) => sum + totalAdminHours(requisition.content), 0);
  // The contract against the cards, both ways — only once every requisition has been read,
  // or a course still loading would read as one the requisition never paid for.
  const contractRead = Boolean(partTimeId) && !requisitionList.isLoading && !requisitionsLoading && !plans.isLoading;
  const contractWarnings = contractRead && requisitions.length ? contract.warnings : [];

  /*
   * When they teach, from the registrar's sweep.
   *
   * Two ways a section is theirs: our planning names them on it, or the portal's own list
   * staffs it with them. The second catches what the first has not been told yet — a CRN
   * the registrar gave them that nobody has put on a card — and both are hours they are
   * in a room, which is what a calendar is for.
   */
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open, retry: false });
  const live = sections.filter((section) => !section.retired);
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);

  /*
   * What happened to their classes, and the classes they stood in for.
   *
   * Their CRNs are the calendar's; a note on one of those is theirs whichever way it
   * went. A note naming them as the cover is theirs too, on somebody else's class.
   *
   * Asked of every semester that is linked to a portal term, not only of the ones their
   * own sections fall in. Somebody who covers a class in a semester they teach nothing in
   * would otherwise never have that note read — and the covers are exactly what this is
   * for.
   */
  const noteTermCodes = [...new Set(Object.values(links.data ?? {}).filter(Boolean))];
  const { notes } = useQueries({
    queries: noteTermCodes.map((termCode) => ({
      queryKey: ["session-changes", termCode],
      queryFn: () => fetchSessionChanges(termCode),
      enabled: open,
      retry: false,
    })),
    combine: (reads) => ({ notes: reads.flatMap((read) => read.data ?? []) }),
  });
  const me = { id: held?.id ?? teacher.id ?? "", name: teacher.fullName };
  // Their week — see services/personTimetable, which the timetable export reads too.
  const timetable: TimetableEntry[] = useMemo(
    () =>
      teacherTimetable({
        cards,
        links: links.data ?? {},
        registered: registered.data ?? [],
        notes,
        teacher: { id: me.id, fullName: me.name },
      }),
    [cards, links.data, registered.data, notes, me.id, me.name],
  );
  const mine = timetable.filter((entry) => !entry.standingIn);
  const ownCrns = new Set(mine.map((entry) => entry.crn));
  // The header's semester's too, for the tile: the portal may book them where we plan nothing.
  const termCodes = [...new Set([...mine.map((entry) => entry.termCode), semesterTerm].filter(Boolean))];
  const concerning = notes.filter(
    (note) =>
      ownCrns.has(note.crn) ||
      (note.kind === "covered" && ((me.id && note.coverTeacherId === me.id) || sameTeacher(note.coverTeacherName, me.name))),
  );
  const adjusted = adjustmentsFor(notes, me, ownCrns, sameTeacher);
  // The registrar's count of their teaching, beside ours in the tiles. No warning on it.
  const { registrarByTerm, booked } = useQueries({
    queries: termCodes.map((termCode) => ({
      queryKey: ["facility-hours", termCode],
      queryFn: () => fetchFacilityHours(termCode),
      enabled: open,
      retry: false,
    })),
    combine: (reads) => ({
      registrarByTerm: new Map(
        reads.map((read, index) => [termCodes[index], registrarHoursFor(read.data ?? {}, teacher.fullName, sameTeacher)] as const),
      ),
      /*
       * And per section, for the table: `term|crn -> their hours on it`, with the terms that have
       * answered at all, so a section the registrar has no timetable for can be told from
       * one whose answer has not arrived.
       */
      booked: {
        hours: new Map(
          reads.flatMap((read, index) =>
            Object.entries(read.data ?? {}).map(
              ([crn, section]) => [`${termCodes[index]}|${crn}`, portalShareOf(section, teacher.fullName, sameTeacher)] as const,
            ),
          ),
        ),
        answered: new Set(termCodes.filter((_, index) => reads[index]?.data)),
      },
    }),
  });
  const courseOf = new Map(timetable.map((entry) => [entry.crn, `${entry.code} · CRN ${entry.crn}`]));
  const tally = [
    adjusted.cancelled ? `${adjusted.cancelled} h cancelled` : "",
    adjusted.coveredByOthers ? `${adjusted.coveredByOthers} h covered by others` : "",
    adjusted.coveredForOthers ? `${adjusted.coveredForOthers} h covered for others` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  /*
   * What they actually taught in the semester chosen in the header: the figure their row on
   * Teacher hours shows in its Total column, worked out the same way. The line under it
   * says how it is made.
   */
  const cohorts = useQuery({ queryKey: ["cohorts"], queryFn: fetchCohorts, enabled: open });
  const semesterNotes = useQuery({
    queryKey: ["session-changes", semesterTerm],
    queryFn: () => fetchSessionChanges(semesterTerm),
    enabled: open && Boolean(semesterTerm),
    retry: false,
  });
  const went = useMemo(() => {
    if (!semester) return null;
    const nameOf = (teacherId: string) => (active.data ?? []).find((row) => row.id === teacherId)?.fullName ?? "";
    const cohortOf = (cohortId: string) => (cohorts.data ?? []).find((cohort) => cohort.id === cohortId) ?? { name: "" };
    const sheets = requestSheets(cards, semester.id, semester.name, () => "", nameOf, cohortOf);
    return semesterAsItWent(sheets, active.data ?? [], semesterNotes.data ?? [], { id: me.id, name: me.name });
  }, [semester, cards, active.data, cohorts.data, semesterNotes.data, me.id, me.name]);
  const readingSemester =
    catalogues.isLoading || active.isLoading || cohorts.isLoading || (Boolean(semesterTerm) && semesterNotes.isLoading);
  const wentSaid = !semester
    ? "no semester chosen"
    : readingSemester
      ? "reading the semester…"
      : !went
        ? "nothing this semester"
        : went.cancelled || went.coveredByOthers || went.coveredForOthers
          ? [
              `${round(went.planned)} h planned`,
              went.cancelled ? `−${round(went.cancelled)} h cancelled` : "",
              went.coveredByOthers ? `−${round(went.coveredByOthers)} h covered by others` : "",
              went.coveredForOthers ? `+${round(went.coveredForOthers)} h covered for others` : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "as planned";
  const inRegister = (crn: string) => (registered.data ?? []).find((row) => row.crn === crn) ?? null;
  // The tiles' sections: the header's semester's, or every one while no semester is chosen.
  const sectionsHere = semester ? sections.filter((section) => section.termId === semester.id) : sections;
  const liveHere = sectionsHere.filter((section) => !section.retired);
  const hoursOf = (list: TaughtSection[]) => round(list.reduce((sum, section) => sum + (Number(section.hours) || 0), 0));
  const hours = hoursOf(liveHere);
  const yearHours = hoursOf(live);
  const students = liveHere.reduce((sum, section) => sum + section.students, 0);
  const registrarHours = semester
    ? (registrarByTerm.get(semesterTerm) ?? 0)
    : [...registrarByTerm.values()].reduce((sum, value) => sum + value, 0);
  // Said only where there is something to say: a semester with nothing planned or paid is no news.
  const contractShown = contractRead && requisitions.length > 0 && (contract.requisitions.length > 0 || liveHere.length > 0);
  const facts = held ?? teacher;

  return (
    <Modal
      open={open}
      size="record"
      title={teacher.fullName || "This teacher"}
      description={[facts.type, facts.department, facts.institution].filter(Boolean).join(" · ") || undefined}
      onClose={onClose}
    >
      {/*
        * Three counts of the same teaching, side by side: what our planning asks for, what
        * the registrar has booked, and what the contract pays for. A comparison, not a
        * verdict — hours move during a semester — but one that used to take three pages.
        * Beside the plan, what it came to once classes were cancelled or covered: the Total
        * on their Teacher hours row. Every tile is the header's semester's, said once above
        * them; the plan says the year's beside it when the year holds more.
        *
        * The pill on each label says where its number comes from, so the hours tiles carry
        * no line underneath saying it again; a line under one is a figure.
        */}
      {/*
        * Two to a row on a phone, where one each made five screens-widths of tiles to
        * scroll past before the week. The requisition tile, whose line underneath is the
        * longest, goes last there and takes the row.
        */}
      {semester ? (
        <p className="mb-2 text-xs text-[#667085]">
          <span className="font-semibold text-[#344054]">{semester.name}</span>, the semester chosen in the page header.
          What they teach, further down, lists every semester.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Sections</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]" aria-label="Sections">{liveHere.length}</p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">
            {[
              sectionsHere.length > liveHere.length ? `${sectionsHere.length - liveHere.length} more retired` : "",
              semester && live.length > liveHere.length ? `${live.length - liveHere.length} more in other semesters` : "",
            ]
              .filter(Boolean)
              .join(" · ") || (semester ? "this semester" : "this year")}
          </p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Planned hours <SourceMark source="planning" /></p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]" aria-label="Planned hours">{hours || "—"}</p>
          {semester && yearHours !== hours ? <p className="mt-0.5 text-xs text-[#98a2b3]">{yearHours} h over the year</p> : null}
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3 max-sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Actual teaching hours <SourceMark source="planning" /></p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]" aria-label="Actual teaching hours">
            {went && !readingSemester ? round(went.total) : "—"}
          </p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">{wentSaid}</p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Portal hours <SourceMark source="registrar" /></p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]" aria-label="Portal hours">{round(registrarHours) || "—"}</p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3 max-sm:order-last max-sm:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Requisition teaching hours <SourceMark source="part-time" /></p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]" aria-label="Requisition hours">
            {partTimeId && contracted.total ? contracted.total : "—"}
          </p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">
            {!partTimeId
              ? "not a part-time teacher"
              : requisitionList.isLoading || requisitionsLoading || plans.isLoading
                ? "reading the requisitions…"
                : contracted.byLabel.length
                  ? [
                      ...contracted.byLabel.map(
                        (entry, index) =>
                          `${entry.label}: ${entry.hours} h${
                            contract.runsPast.includes(contract.requisitions[index]) ? ", for more than this semester" : ""
                          }`,
                      ),
                      ...(admin ? [`and ${Math.round(admin * 1000) / 1000} h of admin`] : []),
                    ].join(" · ")
                  : semester && requisitions.length
                    ? `none for ${semester.name} yet`
                    : "no requisition yet"}
          </p>
        </div>
        <div className="rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Students</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-[#171717]">{students || "—"}</p>
          <p className="mt-0.5 text-xs text-[#98a2b3]">placed in their groups</p>
        </div>
      </div>


      {/*
        * The contract against the planning, both ways. A course on the cards the
        * requisition does not pay for, a course paid for that the cards never give them,
        * and hours that differ where both name the course. Said only for a part-time
        * teacher with a requisition; the hours tiles above are the comparison for everyone.
        */}
      {contractShown ? (
        <section className="mt-5" aria-label="Requisition against planning">
          <h4 className="text-sm font-semibold text-[#171717]">
            Requisition against planning <SourceMark source="part-time" /> <SourceMark source="planning" />
            {semester ? <span className="ml-1.5 text-xs font-normal text-[#98a2b3]">{semester.name}</span> : null}
          </h4>
          {contractWarnings.length === 0 ? (
            <p className="mt-1 text-sm text-[#2f6b3d]">The requisition and the planning name the same courses for the same hours.</p>
          ) : (
            <ul className="mt-1.5 space-y-1" aria-label="Requisition warnings">
              {contractWarnings.map((warning) => (
                <li
                  key={`${warning.kind}|${warning.courseCode}`}
                  className="flex items-start gap-1.5 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-2.5 py-1.5 text-xs text-[#8a6116]"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>{warning.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/*
       * Who they are beside when they teach. The facts are nine short lines and the week
       * is a small grid; each on a row of its own left half the width empty.
       */}
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4 rounded-lg border border-[#e4e8ef] bg-[#fbfcfe] px-4 py-3 sm:grid-cols-2">
          <Fact label="E-mail" value={facts.email || teacher.psuadEmail || ""} source="portal" />
          <Fact label="Rank" value={facts.rank ?? ""} source="portal" />
          <Fact label="Category" value={facts.category ?? ""} source="portal" />
          <StaffStatusFact teacher={held ?? null} />
          <Fact label="Department" value={facts.department ?? ""} source="portal" />
          <Fact label="Institution" value={facts.institution ?? ""} source="portal" />
          <Fact label="Last term in the portal" value={facts.lastTerm ?? ""} source="portal" />
          <Fact label="Portal ID" value={facts.portalTeacherId ?? ""} source="portal" />
          <Fact
            source="planning"
            label="On the department's list"
            value={held ? `yes, since ${held.addedAt.slice(0, 10)}` : "no — chosen on the Teachers page"}
          />
          <Fact label="Courses the portal lists" value={facts.courses ?? ""} source="portal" />
        </div>
        <section>
          <h4 className="mb-2 text-sm font-semibold text-[#171717]">When they teach <SourceMark source="registrar" /></h4>
          <SectionTimetable
            entries={timetable}
            compact
            title={`${teacher.fullName || "This teacher"} — timetable`}
            openable={(crn) => Boolean(inRegister(crn))}
            onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
            emptyMessage="No section of theirs carries a CRN yet, so there is no week to show."
          />
        </section>
      </div>

      <div className="mt-6 mb-2">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-semibold text-[#171717]">Changes to their classes <SourceMark source="planning" /></h4>
          <InfoTip label="About changes to their classes">
            Cancelled, covered by somebody else, or covered by them — as said on the CRNs&apos; calendars.
          </InfoTip>
        </div>
        {/* The tally is figures, so it stays on the page; what the list holds is on the ⓘ. */}
        {tally ? <p className="text-xs text-[#98a2b3]">{tally}.</p> : null}
      </div>
      <SessionChangeList
        changes={concerning}
        nameOf={(crn) => courseOf.get(crn) ?? `CRN ${crn}`}
        empty="Nothing noted on their classes this semester."
      />

      <h4 className="mt-6 text-sm font-semibold text-[#171717]">What they teach <SourceMark source="planning" /></h4>
      {catalogues.isLoading ? (
        <p className="mt-2 text-sm text-[#667085]">Reading the sections…</p>
      ) : sections.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-6 text-center text-sm text-[#667085]">
          No section names them. A section is given its teacher on Groups &amp; CRNs.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
          {/*
            * Seven columns do not fit a phone, and a table read sideways loses its course
            * the moment the numbers come into view. There a section is three lines: the
            * course; its group, cohort and CRN; its hours and students, each named.
            */}
          <table className="w-full border-collapse text-sm max-sm:block sm:min-w-[38rem]">
            <thead className="max-sm:hidden">
              <tr className="border-b border-[#e4e8ef] text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">
                <th scope="col" className="px-3 py-2 text-left">Course</th>
                <th scope="col" className="px-3 py-2 text-left">Section</th>
                <th scope="col" className="px-3 py-2 text-left">Cohort</th>
                <th scope="col" className="px-3 py-2 text-right">CRN</th>
                <th scope="col" className="px-3 py-2 text-right">Hours</th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right"
                  title="What the portal's timetable books for the CRN over the whole semester, on the classes that name them"
                >
                  Hours <SourceMark source="registrar" />
                </th>
                <th scope="col" className="px-3 py-2 text-right">Students</th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {sections.map((section) => (
                <tr
                  key={section.key}
                  className={`border-b border-[#f2f4f7] last:border-0 max-sm:grid max-sm:grid-cols-3 max-sm:gap-x-2 max-sm:gap-y-0.5 max-sm:px-3 max-sm:py-2 ${
                    section.retired ? "text-[#c8d0da]" : ""
                  }`}
                >
                  <td className="px-3 py-2 max-sm:col-span-3 max-sm:p-0">
                    <span className="whitespace-nowrap font-medium tabular-nums">{section.courseCode}</span>
                    <span className={`ml-2 ${section.retired ? "" : "text-[#667085]"}`}>{section.courseName}</span>
                    {section.retired ? <span className="ml-2 text-[11px]">retired</span> : null}
                  </td>
                  <td className="px-3 py-2 max-sm:col-span-2 max-sm:p-0 max-sm:text-xs">
                    {section.scopeCode} {section.groupLabel}
                    <span className={`sm:hidden ${section.retired ? "" : "text-[#667085]"}`}>
                      {" "}
                      · {section.cohorts.join(", ")} · {section.termName || "no semester"}
                    </span>
                  </td>
                  <td className={`px-3 py-2 max-sm:hidden ${section.retired ? "" : "text-[#667085]"}`}>
                    {section.cohorts.join(", ")} · {section.termName || "no semester"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums max-sm:p-0 max-sm:text-xs">
                    <PhoneLabel>CRN</PhoneLabel>
                    {section.crn || <span className="text-[#c8d0da]">none</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums max-sm:p-0 max-sm:text-left max-sm:text-xs">
                    <PhoneLabel>Hours</PhoneLabel>
                    {section.hours || <span className="text-[#c8d0da]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums max-sm:p-0 max-sm:text-left max-sm:text-xs">
                    <PhoneLabel>Portal</PhoneLabel>
                    <RegistrarHours
                      termCode={links.data?.[section.termId] ?? ""}
                      crn={section.crn}
                      booked={booked}
                    />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums max-sm:p-0 max-sm:text-xs">
                    <PhoneLabel>Students</PhoneLabel>
                    {section.students}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(registered.data ?? []).filter((row) => row.courseCode === showingCrn.courseCode && row.termCode === showingCrn.termCode)}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void registered.refetch()}
        />
      ) : null}
    </Modal>
  );
}

/** A column's name beside its figure, on a phone, where the table has no header row. */
function PhoneLabel({ children }: { children: string }) {
  return <span className="mr-1 text-[#98a2b3] sm:hidden">{children}</span>;
}

/** One section's registrar hours, or a quiet mark saying why there are none — see bookedHoursOf. */
function RegistrarHours({ termCode, crn, booked }: { termCode: string; crn: string; booked: BookedHours }) {
  const said = bookedHoursOf(booked, termCode, crn);
  if (typeof said === "number") return <>{said}</>;
  if (said === "waiting") return <span className="text-[#c8d0da]">…</span>;
  if (said === "none") {
    return (
      <span className="text-[#c8d0da]" title="The portal's timetable has no meetings for this CRN">
        none
      </span>
    );
  }
  return <span className="text-[#c8d0da]">—</span>;
}
