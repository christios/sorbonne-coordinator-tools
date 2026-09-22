import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { CrnDialog } from "@/components/ActiveCourses";
import { Modal } from "@/components/Modal";
import { SectionTimetable } from "@/components/SectionTimetable";
import { SessionChangeDialog } from "@/components/SessionChangeDialog";
import { SessionChangeList } from "@/components/SessionChangeList";
import { fetchSessionChanges, noteOn, slotKey } from "@/services/sessionChanges";
import { fieldHeld, namesHeld } from "@/services/rosterStore";
import type { PlacedSession } from "@/services/weekSchedule";
import { buildCards, rowsPerPart, teaches } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import {
  fetchActiveCourses,
  fetchActiveTeachers,
  fetchCrnStudents,
  fetchFacilitySections,
  fetchRegisterCheck,
  fetchSectionDays,
  fetchTermCrns,
  type ActiveCrn,
} from "@/services/portalLists";
import { warningsByCrn, WORDS } from "@/services/registerWarnings";
import { CopyButton } from "@/components/CopyButton";
import { asMailList, emailsFor } from "@/services/studentEmails";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/**
 * One CRN, in full — the section, not the course it belongs to.
 *
 * Pressing a row used to open a form about one field of it: which CRN this one hangs from.
 * That is a real question and it is not the question a row raises. "What is 23436" was
 * answered by reading across eleven columns and then going to two other pages for the rest.
 *
 * The course's record is the sibling of this one and answers a different question — every
 * CRN of MATH-351 at once. This is one of them, with the group that teaches it, what the
 * timetabler was asked for, what the registrar booked, and what is wrong with it.
 *
 * The parent-CRN form is folded in rather than replaced: it is the one thing on a CRN that
 * is ours to change, and it belongs where the CRN is looked at.
 */
export function CrnRecord({
  open,
  row,
  siblings,
  onClose,
  onSaved,
  onShowCourse,
  onShowStudents,
}: {
  open: boolean;
  row: ActiveCrn;
  /** The other CRNs of its course in the same term, for the parent picker. */
  siblings: ActiveCrn[];
  onClose: () => void;
  onSaved: () => void;
  onShowCourse?: (courseCode: string) => void;
  /** Take these students to the Students table, where each row opens its record. */
  onShowStudents?: (ids: string[]) => void;
}) {
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses, enabled: open });
  /*
   * Choosing an Active teacher for a section fills its id and leaves the written name
   * empty, so a card reading the written name alone had nothing to show for exactly the
   * sections somebody had staffed properly.
   */
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers, enabled: open });
  const nameOf = (teacherId: string) =>
    (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "";
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  const check = useQuery({ queryKey: ["register-check", row.termCode], queryFn: () => fetchRegisterCheck(row.termCode), enabled: open, retry: false });
  const portal = useQuery({ queryKey: ["term-crns", row.termCode], queryFn: () => fetchTermCrns(row.termCode), enabled: open });
  // Which weekdays the registrar has it meeting on, and whether it has been asked at all.
  const days = useQuery({
    queryKey: ["section-days", row.termCode],
    queryFn: () => fetchSectionDays(row.termCode),
    enabled: open,
    retry: false,
  });

  const course = (courses.data ?? []).find((entry) => entry.courseCode.toUpperCase() === row.courseCode.toUpperCase()) ?? null;
  const said = portal.data?.crns[row.crn] ?? null;
  const termName = (termId: string) => (terms.data ?? []).find((entry) => entry.id === termId)?.name ?? termId;
  const warnings = warningsByCrn(check.data).get(row.crn) ?? [];

  /*
   * The group that teaches under this CRN. Found by walking the cards rather than asked
   * for, because a CRN is a cell of the matrix and nothing indexes the matrix by it — and
   * a section handed over at mid-semester has a part each, so the part matters.
   */
  const taught = buildCards(catalogues.data ?? [], termName, courses.data ?? [])
    .flatMap((card) =>
      card.sets.flatMap((set) =>
        set.rows
          .filter((entry) => teaches(entry))
          .flatMap((entry) => rowsPerPart(entry))
          .filter((entry) => entry.section?.crn === row.crn)
          .map((entry) => ({ card, set, entry })),
      ),
    );

  const meets = days.data?.days?.[row.crn] ?? [];
  const asked = days.data ? !days.data.blind.includes(row.crn) : false;

  /*
   * What happened to its classes: said here, on the calendar, and nowhere else.
   *
   * The note is keyed to the slot. The sweep read below is the same one the calendar
   * makes, so it costs nothing, and it is what says which notes sit on an hour the
   * registrar has since moved away from.
   */
  const [noting, setNoting] = useState<PlacedSession | null>(null);
  const notes = useQuery({
    queryKey: ["session-changes", row.termCode],
    queryFn: () => fetchSessionChanges(row.termCode),
    enabled: open && Boolean(row.termCode),
    retry: false,
  });
  const sweep = useQuery({
    queryKey: ["facility-sections", row.termCode, row.crn],
    queryFn: () => fetchFacilitySections(row.termCode, [row.crn]),
    enabled: open && Boolean(row.termCode),
    retry: false,
  });
  const mine = (notes.data ?? []).filter((note) => note.crn === row.crn);
  const booked = new Set(
    (sweep.data?.sections ?? []).flatMap((section) =>
      section.meetings.map((meeting) => slotKey({ termCode: row.termCode, crn: section.crn, meetsOn: meeting.meetsOn, startsAt: meeting.startsAt })),
    ),
  );
  const orphaned = new Set(mine.filter((note) => booked.size > 0 && !booked.has(slotKey(note))).map((note) => note.id));
  /*
   * Who the registrar has in it. Ids from the server; names from this browser, which is
   * the only place they are. Beside each, the group of ours the CRN stands for — blank is
   * the line worth reading, a student in a section none of their groups gives them.
   */
  const inIt = useQuery({
    queryKey: ["crn-students", row.termCode, row.crn],
    queryFn: () => fetchCrnStudents(row.termCode, row.crn),
    enabled: open && Boolean(row.termCode),
    retry: false,
  });
  const names = useQuery({ queryKey: ["names-held"], queryFn: namesHeld, enabled: open, staleTime: 60_000 });
  /*
   * Addresses for the copy button, from the same place the names come from: the pulls this
   * browser holds. The server has neither, and a mail to a section has to be addressed
   * from somewhere.
   */
  const emails = useQuery({
    queryKey: ["field-held", "PSUAD_EMAIL"],
    queryFn: () => fieldHeld("PSUAD_EMAIL"),
    enabled: open,
    staleTime: 60_000,
  });
  const addresses = emailsFor(inIt.data ?? [], emails.data ?? {});
  const plannedTeacher = taught[0]?.entry.section ? filled(taught[0].entry.section, taught[0].set.course.request).teacher : "";

  return (
    <Modal
      open={open}
      size="wide"
      title={`CRN ${row.crn}`}
      description={`${row.courseCode}${row.portalTitle ? ` · ${row.portalTitle}` : ""}`}
      onClose={onClose}
      header={
        <dl className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
          <Field label="Course">
            {onShowCourse ? (
              <button
                type="button"
                onClick={() => onShowCourse(row.courseCode)}
                className="font-medium text-[#1f4e79] underline-offset-2 hover:underline"
              >
                {row.courseCode}
              </button>
            ) : (
              row.courseCode
            )}
          </Field>
          <Field label="Term">{row.termCode || <Nothing />}</Field>
          <Field label="Registered">{row.registered || <Nothing />}</Field>
          <Field label="Portal">{said && said.status !== "in_portal" ? "gone from the list" : "listed"}</Field>
        </dl>
      }
    >
      {/*
       * Two columns: what the section is — who teaches it and when — and what the register
       * makes of it — its verdicts and the parent it hangs from.
       */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <Card title="Who teaches it" note="The group of ours this CRN stands for, and what the timetabler was asked for.">
            {taught.length === 0 ? (
              <Empty>On no course card. Nothing of ours teaches under it.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {taught.map(({ card, set, entry }) => {
                  const section = entry.section ? filled(entry.section, set.course.request) : null;
                  return (
                    <li key={`${card.key}|${entry.group.id}|${entry.section?.part ?? 1}`}>
                      <p className="font-medium text-[#344054]">
                        {card.cohortName} · {set.scope.code} {entry.group.label}
                        <span className="ml-2 text-xs font-normal text-[#98a2b3]">{card.termName}</span>
                        {entry.parts && entry.parts > 1 ? (
                          <span className="ml-2 text-xs font-normal text-[#1f4e79]">
                            part {entry.section?.part} of {entry.parts}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[#667085]">
                        {(section && ((section.teacherId && nameOf(section.teacherId)) || section.teacher)) || <Nothing />}
                        {section?.hours ? <span className="ml-3 tabular-nums text-xs">{section.hours} h</span> : null}
                        {section?.weeks ? <span className="ml-3 text-xs">weeks {section.weeks}</span> : null}
                      </p>
                      {section?.constraints ? <p className="text-xs text-[#98a2b3]">{section.constraints}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="When the registrar has it" note="From the sweep of their timetable, not from anything we asked for.">
            {days.isLoading ? (
              <Empty>Reading the sweep…</Empty>
            ) : !days.data ? (
              <Empty>No semester is linked to a portal term, so the registrar has not been asked.</Empty>
            ) : !asked ? (
              <Empty>Nobody has asked the registrar about this CRN. Run a portal sync.</Empty>
            ) : meets.length === 0 ? (
              <Empty>Asked, and the registrar has booked no room for it.</Empty>
            ) : (
              <>
                <p className="text-sm text-[#344054]">{meets.join(" · ")}</p>
                {/* The dates under those weekdays: a handover, a moved room, a week off. */}
                <div className="mt-3">
                  <SectionTimetable
                    compact
                    title={`CRN ${row.crn} — timetable`}
                    onPickSession={setNoting}
                    entries={[
                      {
                        termCode: row.termCode,
                        crn: row.crn,
                        code: row.courseCode,
                        title: row.courseTitle || row.portalTitle,
                        staff: row.teacherName,
                      },
                    ]}
                  />
                </div>
              </>
            )}
          </Card>

          <Card
            title={`Registered in it${inIt.data ? ` · ${inIt.data.length}` : ""}`}
            note="Who the registrar has in this section, and the group of ours it stands for. Names are this browser's."
            action={
              addresses.found.length ? (
                <CopyButton
                  label={`Copy the ${addresses.found.length} e-mail addresses in this section`}
                  text={() => asMailList(addresses.found)}
                  className="shrink-0 text-xs font-semibold"
                >
                  Copy e-mails
                </CopyButton>
              ) : null
            }
          >
            {!row.termCode ? (
              <Empty>No portal term, so the registrar cannot be asked.</Empty>
            ) : inIt.isLoading ? (
              <Empty>Reading the registrations…</Empty>
            ) : inIt.error ? (
              <p className="text-sm text-[#a6292f]">{(inIt.error as Error).message}</p>
            ) : !inIt.data?.length ? (
              <Empty>Nobody, in the last registrations pull.</Empty>
            ) : (
              <>
                <ul className="max-h-72 divide-y divide-[#f2f4f7] overflow-y-auto text-sm" aria-label="Registered students">
                  {inIt.data.map((student) => (
                    <li key={student.studentId} className="flex flex-wrap items-baseline gap-x-3 py-1">
                      {onShowStudents ? (
                        <button
                          type="button"
                          onClick={() => onShowStudents([student.studentId])}
                          className="font-medium text-[#1f4e79] underline-offset-2 hover:underline"
                        >
                          {names.data?.[student.studentId] || student.studentId}
                        </button>
                      ) : (
                        <span className="font-medium text-[#344054]">{names.data?.[student.studentId] || student.studentId}</span>
                      )}
                      {names.data?.[student.studentId] ? <span className="font-mono text-xs text-[#98a2b3]">{student.studentId}</span> : null}
                      <span className="text-[#667085]">{student.cohortName || "no cohort"}</span>
                      {student.group ? (
                        <span className="text-[#667085]">{student.group}</span>
                      ) : (
                        <span className="text-xs text-[#a6292f]">no group of theirs stands for it</span>
                      )}
                    </li>
                  ))}
                </ul>
                {/*
                  * Said out loud, because a copy of twenty addresses for a section of
                  * twenty-four only shows up when four people say they never got the mail.
                  */}
                {addresses.missing.length && !addresses.found.length ? (
                  <p className="mt-2 text-xs text-[#667085]">
                    This browser holds no e-mail for anybody in this section, so there is nothing to copy. Pull the
                    students again and the addresses come with them.
                  </p>
                ) : addresses.missing.length ? (
                  <p className="mt-2 text-xs text-[#a6292f]">
                    {addresses.missing.length} of {inIt.data.length} have no e-mail in this browser, so a copy leaves
                    them out. Pull the students again to fill them in.
                  </p>
                ) : null}
                {onShowStudents ? (
                  <button
                    type="button"
                    onClick={() => onShowStudents((inIt.data ?? []).map((student) => student.studentId))}
                    className="mt-2 text-xs font-semibold text-[#1f4e79] hover:underline"
                  >
                    Show all {inIt.data.length} on the Students table
                  </button>
                ) : null}
              </>
            )}
          </Card>

          <Card
            title="Changes to its classes"
            note="Cancelled, or covered by somebody else. Press a date to say something else about that class, or that it ran as planned after all. Teacher hours read these."
          >
            <SessionChangeList
              changes={mine}
              orphaned={orphaned}
              /*
               * Straight to the class the line is about. The calendar above shows one week,
               * and a note put on the wrong class is usually noticed weeks later — from
               * this list, which knows the date exactly.
               */
              onOpen={(change) =>
                setNoting({
                  crn: change.crn,
                  termCode: row.termCode,
                  date: change.meetsOn,
                  start: change.startsAt,
                  end: change.endsAt,
                  room: "",
                  clashes: false,
                })
              }
              empty={row.termCode ? "Nothing noted. Every class stands as the registrar booked it." : "No portal term, so nothing can be noted."}
            />
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="What is wrong with it" note="The register's own verdicts about this CRN, in full.">
            {check.isLoading ? (
              <Empty>Reading the register…</Empty>
            ) : warnings.length === 0 ? (
              <Empty>Nothing. It is registered, staffed as we have it, and clear of other departments.</Empty>
            ) : (
              <ul className="space-y-1 text-sm">
                {warnings.map((warning) => (
                  <li key={`${warning.kind}|${warning.text}`}>
                    <span className="font-semibold text-[#8a6116]">{WORDS[warning.kind]}</span>{" "}
                    <span className="text-[#667085]">{warning.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/*
            * The one thing on a CRN that is ours to change, kept where the CRN is looked at
            * rather than behind a second press somewhere else.
            */}
          <Card title="What it hangs from" note="The parent CRN the register holds it under — the one thing here that is the CRN's own.">
            <CrnDialog row={row} course={course} siblings={siblings} onClose={onClose} onSaved={onSaved} inline />
          </Card>
        </div>
      </div>
      {noting ? (
        <SessionChangeDialog
          session={noting}
          label={`${row.courseCode} · CRN ${row.crn}`}
          plannedTeacher={plannedTeacher || row.teacherName}
          existing={noteOn(notes.data ?? [], noting)}
          onClose={() => setNoting(null)}
        />
      ) : null}
    </Modal>
  );
}

function Card({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  /** Something the card as a whole does, beside its heading. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#e4e8ef] bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
        {action}
      </div>
      {note ? <p className="mb-2 text-xs text-[#98a2b3]">{note}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">{label}</dt>
      <dd className="text-sm text-[#344054]">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#667085]">{children}</p>;
}

function Nothing() {
  return <span className="text-[#c8d0da]">—</span>;
}
