import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { CrnDialog } from "@/components/ActiveCourses";
import { Modal } from "@/components/Modal";
import { SectionTimetable } from "@/components/SectionTimetable";
import { buildCards, rowsPerPart, teaches } from "@/services/courseCards";
import { filled } from "@/services/courseRequest";
import {
  fetchActiveCourses,
  fetchRegisterCheck,
  fetchSectionDays,
  fetchTermCrns,
  type ActiveCrn,
} from "@/services/portalLists";
import { warningsByCrn, WORDS } from "@/services/registerWarnings";
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
}: {
  open: boolean;
  row: ActiveCrn;
  /** The other CRNs of its course in the same term, for the parent picker. */
  siblings: ActiveCrn[];
  onClose: () => void;
  onSaved: () => void;
  onShowCourse?: (courseCode: string) => void;
}) {
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses, enabled: open });
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
          .filter((entry) => teaches(entry.group, entry.course))
          .flatMap((entry) => rowsPerPart(entry))
          .filter((entry) => entry.section?.crn === row.crn)
          .map((entry) => ({ card, set, entry })),
      ),
    );

  const meets = days.data?.days?.[row.crn] ?? [];
  const asked = days.data ? !days.data.blind.includes(row.crn) : false;

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
                      {section?.teacher || <Nothing />}
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

        {/*
          * The one thing on a CRN that is ours to change, kept where the CRN is looked at
          * rather than behind a second press somewhere else.
          */}
        <Card title="What it hangs from" note="The parent CRN the register holds it under, and the course's own facts.">
          <CrnDialog row={row} course={course} siblings={siblings} onClose={onClose} onSaved={onSaved} inline />
        </Card>
      </div>
    </Modal>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#e4e8ef] bg-white px-4 py-3">
      <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
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
