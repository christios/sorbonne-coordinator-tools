import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { CourseLeadPicker, CoursePlanEditor } from "@/components/CoursePlanDialog";
import { CourseHours, CourseRequestDialog, CourseRequestLine } from "@/components/CourseRequest";
import { CrnRecord } from "@/components/CrnRecord";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { usePortalSemester } from "@/components/PortalSemesterMenu";
import { SelectMenu } from "@/components/SelectMenu";
import { SectionTimetable } from "@/components/SectionTimetable";
import { TimetablesButton } from "@/components/TimetablesButton";
import { buildCards, rowsPerPart, teaches, type Card as CourseCard, type CardSet } from "@/services/courseCards";
import { fetchCoursePlans } from "@/services/coursePlans";
import { filled } from "@/services/courseRequest";
import {
  fetchActiveCourses,
  fetchActiveCrns,
  fetchActiveTeachers,
  fetchRegisterCheck,
  fetchTermCrns,
  fetchTermLinks,
  updateActiveCourse,
  type ActiveCourse,
  type ActiveCrn,
  type Mutualized,
} from "@/services/portalLists";
import { fetchCourseCards } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";
import { exportCrnTimetable } from "@/services/timetableExports";

/**
 * One course, in full — what the student record is for a person.
 *
 * A course was the only thing on these pages with no place of its own. Its CRNs were a
 * filtered view of the register, where it is taught was a card on another page, and what
 * was wrong with it was a line in a banner that named it in passing. Answering "what is
 * the state of MATH-351" meant three pages and holding the answer in your head.
 *
 * Three questions, in the order they get asked:
 *
 *   what the registrar has — the CRNs, who they say teaches each, how many registered
 *   where we teach it     — every cohort, set and group, and the section each holds
 *   what is wrong with it — the differences that name this course, and nothing else's
 *
 * Everything here is already fetched by some page or other, under the same query keys, so
 * opening this costs nothing that was not already in hand.
 */
export function CourseRecord({
  open,
  courseCode,
  onClose,
  planTerm: termGiven,
  planSemesterName,
}: {
  open: boolean;
  courseCode: string;
  onClose: () => void;
  /**
   * The semester whose plan is shown, as the portal numbers it, and its name: a Groups & CRNs
   * card's own, which need not be the header's. Left out, the header's semester.
   */
  planTerm?: string;
  planSemesterName?: string;
}) {
  const code = courseCode.trim().toUpperCase();
  const client = useQueryClient();
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: () => fetchActiveCourses(), enabled: open });
  const crns = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns(), enabled: open });
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards, enabled: open });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open });
  const check = useQuery({ queryKey: ["register-check"], queryFn: () => fetchRegisterCheck(), enabled: open });
  /*
   * The department's teachers, so a section can be named by the one somebody chose for it.
   *
   * A section carries two: the name the registrar's row happened to say, and the Active
   * teacher chosen here afterwards. Choosing one fills the id and leaves the written name
   * empty, so a card that printed only the written name showed a dash for every section
   * anybody had actually staffed — the better-staffed a course was, the emptier it looked.
   */
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: () => fetchActiveTeachers(), enabled: open });
  const nameOf = (teacherId: string) =>
    (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "";

  const course = (courses.data ?? []).find((row) => row.courseCode.toUpperCase() === code) ?? null;
  const held = (crns.data ?? []).filter((row) => row.courseCode.toUpperCase() === code);
  const term = held[0]?.termCode ?? "";
  // The portal's own word about these CRNs — who it says teaches them, and how many it has
  // registered. Asked for the term the register holds them in, which is the only one it has.
  const portal = useQuery({
    queryKey: ["term-crns", term],
    queryFn: () => fetchTermCrns(term),
    enabled: open && Boolean(term),
  });

  const termName = (termId: string) => (terms.data ?? []).find((row) => row.id === termId)?.name ?? termId;
  const cards = buildCards(catalogues.data ?? [], termName, courses.data ?? []).filter(
    (card) => card.code.toUpperCase() === code,
  );

  /*
   * The group each CRN teaches, so the calendar's boxes say "TD 3" rather than a number
   * — walked off the cards, since nothing indexes the matrix by CRN.
   */
  const groupOf = new Map<string, string>();
  for (const card of cards) {
    for (const set of card.sets) {
      for (const entry of set.rows.filter((row) => teaches(row)).flatMap((row) => rowsPerPart(row))) {
        if (entry.section?.crn) groupOf.set(entry.section.crn, `${set.scope.code} ${entry.group.label}`);
      }
    }
  }
  const timetable = held.map((row) => ({
    termCode: row.termCode,
    crn: row.crn,
    code: row.courseCode,
    title: `CRN ${row.crn}`,
    label: groupOf.get(row.crn) ?? row.portalTitle ?? row.crn,
    group: groupOf.get(row.crn) ?? "",
    staff: portal.data?.crns[row.crn]?.teacherName || row.teacherName,
    // One colour per section, not per course: every box here is the same course.
    colorKey: row.crn,
  }));

  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  /*
   * Its plan in the semester shown — the header's, or a Groups & CRNs card's — set here,
   * wherever the record is opened from (user, 23 Nov 2026: one record, the same on Active
   * courses, Active CRNs and Groups & CRNs): the course's facts and lead, each set's hours and
   * session length and what else it asks, and the weeks.
   */
  const { semester, term: headerTerm } = usePortalSemester();
  const planTerm = termGiven ?? headerTerm;
  const planSemester = termGiven !== undefined ? (planSemesterName ?? "") : (semester?.name ?? "");
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open, retry: false });
  // The course's cards in that semester, whichever cohorts take it: their sets carry its hours.
  const inSemester = cards.filter(
    (card) => (links.data?.[card.termId] ?? (card.termId.startsWith("plan:") ? card.termId.slice(5) : "")) === planTerm,
  );
  const several = inSemester.length > 1;
  const [asking, setAsking] = useState<{ card: CourseCard; set: CardSet } | null>(null);
  const refreshPlan = () => {
    void client.invalidateQueries({ queryKey: ["course-cards"] });
    void client.invalidateQueries({ queryKey: ["course-plans"] });
  };
  const plans = useQuery({
    queryKey: ["course-plans", planTerm],
    queryFn: () => fetchCoursePlans(planTerm),
    enabled: open && Boolean(planTerm),
    retry: false,
  });
  const plan = (plans.data?.courses ?? []).find((row) => row.courseCode.toUpperCase() === code) ?? null;

  const report = check.data;
  const differences = report
    ? [
        ...report.gone.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — we hold it, the portal has stopped listing it`),
        ...report.arrived.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — the portal lists it and we have not taken it in`),
        ...report.unregistered.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} — on a card, and registered nowhere`),
        ...report.teacherDiffers.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} ${row.groupLabel} — we say ${row.ours}, the portal says ${row.theirs}`),
        ...report.teacherUnnamed.filter((row) => row.courseCode.toUpperCase() === code).map((row) => `${row.crn} ${row.groupLabel} — the portal staffs it ${row.theirs} and we have not`),
        ...report.collides.filter((row) => row.ourCourse.toUpperCase() === code).map((row) => `${row.ourCrn} — ${row.weekday} ${row.startsAt}–${row.endsAt} against ${row.theirs.map((other) => other.courseCode || other.crn).join(", ")}`),
      ]
    : [];

  return (
    <Modal
      open={open}
      size="wide"
      title={code}
      description={course?.title || undefined}
      onClose={onClose}
      header={
        <dl className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
          <Field label="CRNs registered">{held.length || <Nothing />}</Field>
          <Field label="Taught in">{cards.length ? `${cards.length} cohort-semester${cards.length === 1 ? "" : "s"}` : <Nothing />}</Field>
        </dl>
      }
    >
      {/*
       * In rows, so the cards line up across the page: what we say about the course beside
       * where we teach it; then the register and what is wrong with it, beside when it meets.
       * Each row's cards are as tall as each other — two columns stacked on their own ended
       * wherever their cards happened to.
       */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* The course's plan, first and the width of the record: what is asked about a course most. */}
        <Card
          title={`Course plan${planSemester ? ` · ${planSemester}` : ""}`}
          note="The course's facts and its lead; each set's hours and session length, and what else it asks; and the weeks the lead lays its sessions out in."
          className="lg:col-span-2"
        >
          <div className="space-y-4">
            {/* The course's facts and its lead first, side by side. */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">The course</p>
                {course ? (
                  <CourseFacts
                    key={course.id}
                    inline
                    course={course}
                    onSaved={() => {
                      client.invalidateQueries({ queryKey: ["active-courses"] });
                      client.invalidateQueries({ queryKey: ["active-crns"] });
                    }}
                  />
                ) : (
                  <Empty>Not in the register, so there is nothing to say about it yet.</Empty>
                )}
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">Course lead</p>
                {/* Labelled as the course's fields are, so its menu sits on their line. */}
                <p className="text-xs font-semibold text-[#344054]">Lead this semester</p>
                <div className="mt-1">
                  {plan ? (
                    <CourseLeadPicker term={planTerm} plan={plan} semesterName={planSemester} />
                  ) : (
                    <Empty>Not active in {planSemester || "this semester"}, so it has no plan here.</Empty>
                  )}
                </div>
              </div>
            </div>
            {inSemester.length ? (
              <>
                <CourseHours
                  key={inSemester.flatMap((card) => card.sets.map((set) => `${set.course.id}:${set.course.request.hours}:${set.course.request.duration}`)).join("|")}
                  sets={inSemester.flatMap((card) => card.sets)}
                  labelOf={(set) => {
                    const card = inSemester.find((each) => each.sets.includes(set));
                    return several && card ? `${card.cohortName} · ${set.scope.code}` : set.scope.code;
                  }}
                  plan={plan}
                  onSaved={refreshPlan}
                />
                <div className="space-y-1">
                  <p className="pb-0.5 text-xs font-semibold uppercase tracking-wide text-[#667085]">What else each set asks</p>
                  {inSemester.map((card) => (
                    <div key={card.key} className="space-y-1">
                      {several ? <p className="text-xs font-semibold text-[#475467]">{card.cohortName}</p> : null}
                      {card.sets.map((set) => (
                        // The hours and session length are in the table above: the line says the rest.
                        <CourseRequestLine
                          key={set.scope.id}
                          request={{ ...set.course.request, hours: "", duration: "" }}
                          scopeCode={set.scope.code}
                          onEdit={() => setAsking({ card, set })}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Empty>On no set in Groups &amp; CRNs for {planSemester || "this semester"}: its hours are set on its sets there.</Empty>
            )}
            {plan?.active ? (
              <CoursePlanEditor
                term={planTerm}
                plan={plan}
                weeks={plans.data?.weeks ?? []}
                semesterName={planSemester}
                hoursAbove
                leadAbove
              />
            ) : null}
          </div>
          {asking ? (
            <CourseRequestDialog
              courseId={asking.set.course.id}
              title={`${code} · ${asking.set.scope.code}`}
              description={`What ${asking.card.name || code} asks of the timetable for every ${asking.set.scope.code} section of it, in ${asking.card.cohortName}, ${asking.card.termName || "this semester"}.`}
              held={asking.set.course.request}
              teachers={teachers.data ?? []}
              onClose={() => setAsking(null)}
              onSaved={() => {
                setAsking(null);
                refreshPlan();
              }}
            />
          ) : null}
        </Card>
        {/*
          * The two things about a course that are ours to say rather than the portal's.
          *
          * They were written from a CRN's dialog, which is where they were read. Both
          * belong to the course — every CRN of it has the same UE, and a course is
          * mutualized or it is not — so editing them from one section said something
          * untrue about what they are, and left the course, which is the thing they
          * describe, with nowhere to say them.
          */}
        <Card title="Where we teach it" note="Every group of every set that holds a section of this course.">
          {cards.length === 0 ? (
            <Empty>On no course card yet. Add it to a set on Group schema.</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {cards.map((card) => (
                <TaughtIn key={card.key} card={card} nameOf={nameOf} />
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-3">
          <Card title="In the register" note="The CRNs the department answers for, and what the portal says about each.">
            {held.length === 0 ? (
              <Empty>Not in the register. Take the course in on Active CRNs and its CRNs come with it.</Empty>
            ) : (
              <ul className="divide-y divide-[#f2f4f7] text-sm">
                {held.map((row) => (
                  <RegisterLine key={row.id} row={row} portal={portal.data?.crns[row.crn] ?? null} />
                ))}
              </ul>
            )}
          </Card>
          <Card title="What is wrong with it" note="The differences that name this course, and nothing else's." className="flex-1">
            {check.isLoading ? (
              <Empty>Reading the register…</Empty>
            ) : differences.length === 0 ? (
              <Empty>Nothing. Every CRN it holds is registered, staffed as we have it, and clear of other departments.</Empty>
            ) : (
              <ul className="space-y-1 text-sm text-[#8a6116]">
                {differences.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card
          title="When it meets"
          action={
            held.length ? (
              /*
               * The course's whole semester as a PDF, a page per teaching week: every CRN
               * of it on one grid, as Active CRNs exports a ticked handful.
               */
              <TimetablesButton
                small
                label="Export timetable"
                make={() =>
                  exportCrnTimetable(client, held, {
                    title: [code, course?.title || held[0]?.courseTitle || held[0]?.portalTitle || ""].filter(Boolean).join(" · "),
                    subtitle: "Course",
                    filename: `${code.replace(/[^A-Za-z0-9-]+/g, "-")}-timetable.pdf`,
                  })
                }
              />
            ) : null
          }
        >
          <SectionTimetable
            entries={timetable}
            compact
            title={`${code} — timetable`}
            openable={(crn) => held.some((row) => row.crn === crn)}
            onOpenCrn={(crn) => setShowingCrn(held.find((row) => row.crn === crn) ?? null)}
            emptyMessage="Not in the register, so the portal has not been asked when it meets."
          />
        </Card>
      </div>
        {showingCrn ? (
          <CrnRecord
            open
            row={showingCrn}
            siblings={held.filter((row) => row.termCode === showingCrn.termCode)}
            onClose={() => setShowingCrn(null)}
            onSaved={() => void crns.refetch()}
          />
        ) : null}
    </Modal>
  );
}

/**
 * The UE, whether both degrees sit in it together, and the coefficient, written where they
 * belong. The coefficient is the one the teaching-load sheet lists beside the course, and
 * Teaching loads shows it there.
 */
function CourseFacts({ course, onSaved, inline = false }: { course: ActiveCourse; onSaved: () => void; inline?: boolean }) {
  const [ue, setUe] = useState(course.ue);
  const [mutualized, setMutualized] = useState<Mutualized>(course.mutualized);
  const [coefficient, setCoefficient] = useState(course.coefficient ?? "");
  const save = useMutation({
    mutationFn: () => updateActiveCourse(course.id, { ue: ue.trim(), mutualized, coefficient: coefficient.trim() }),
    onSuccess: onSaved,
  });
  const changed = ue.trim() !== course.ue || mutualized !== course.mutualized || coefficient.trim() !== (course.coefficient ?? "");
  // In a row of columns at the top of the course's plan (23 Nov 2026); stacked in their own card.
  const label = inline ? "block text-xs font-semibold text-[#344054]" : "block text-sm font-semibold text-[#344054]";
  // As tall as the Mutualized menu beside them, so the row lines up (h-10, the menu's own).
  const input = `${inline ? "mt-1 h-10" : "mt-1.5 py-2"} block w-full rounded-md border border-[#cbd5e1] px-3 text-sm font-normal tabular-nums`;
  // At the end of the row of fields when inline, under them when stacked.
  const saveButton = (
    <button
      type="button"
      disabled={!changed || save.isPending}
      onClick={() => save.mutate()}
      className={`rounded-md bg-[#1f4e79] font-semibold text-white disabled:bg-[#9ba8b5] ${inline ? "h-10 px-3 text-sm" : "px-4 py-2 text-sm"}`}
    >
      {save.isPending ? "Saving…" : "Save"}
    </button>
  );

  return (
    <div className={inline ? "space-y-2" : "space-y-3"}>
      <div className={inline ? "grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1.2fr)_auto]" : "space-y-3"}>
        <label className={label}>
          <span className="flex items-center gap-1">
            UE
            <InfoTip label="What the UE is">The Sorbonne unit this course is registered under in Paris.</InfoTip>
          </span>
          <input aria-label={`UE of ${course.courseCode}`} value={ue} onChange={(event) => setUe(event.target.value)} placeholder="UL1MA001" className={input} />
        </label>
        <label className={label}>
          <span className="flex items-center gap-1">
            Coefficient
            <InfoTip label="Where the coefficient is used">
              The course&apos;s coefficient, as the department&apos;s teaching-load sheet lists it. Teaching loads shows it
              beside the course.
            </InfoTip>
          </span>
          <input
            aria-label={`Coefficient of ${course.courseCode}`}
            value={coefficient}
            inputMode="decimal"
            onChange={(event) => setCoefficient(event.target.value)}
            placeholder="15"
            className={`${input} ${inline ? "" : "!w-28"}`}
          />
        </label>
        <div>
          <span className={`flex items-center gap-1 ${label}`}>
            Mutualized
            <InfoTip label="What mutualized means">
              Whether the mathematicians and the physicists are taught it together — which decides whether it needs one
              group or two.
            </InfoTip>
          </span>
          <div className={inline ? "mt-1" : "mt-1.5"}>
            <SelectMenu
              label={`Whether ${course.courseCode} is mutualized`}
              value={mutualized}
              onChange={(value) => setMutualized(value as Mutualized)}
              options={[
                { value: "", label: inline ? "Not said" : "Nobody has said" },
                { value: "yes", label: inline ? "Both degrees" : "Mutualized — both degrees together" },
                { value: "no", label: "One degree only" },
              ]}
            />
          </div>
        </div>
        {inline ? saveButton : null}
      </div>
      {save.error ? <p role="alert" className="text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
      {inline ? null : <div className="flex justify-end">{saveButton}</div>}
    </div>
  );
}

/** One CRN of the register, with the portal's own word beside ours. */
function RegisterLine({ row, portal }: { row: ActiveCrn; portal: { teacherName: string; registered?: number; status: string } | null }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5">
      <span className="font-medium tabular-nums text-[#344054]">{row.crn}</span>
      {row.parentCrn ? <span className="text-xs text-[#98a2b3]">under {row.parentCrn}</span> : null}
      <span className="text-[#667085]">{portal?.teacherName || <Nothing />}</span>
      {portal && portal.status !== "in_portal" ? (
        <span className="text-xs text-[#a6292f]">the portal has stopped listing it</span>
      ) : null}
      {portal?.registered ? (
        <span className="ml-auto text-xs tabular-nums text-[#98a2b3]">{portal.registered} registered</span>
      ) : null}
    </li>
  );
}

/** One cohort-semester's sections of this course, group by group. */
function TaughtIn({ card, nameOf }: { card: CourseCard; nameOf: (teacherId: string) => string }) {
  return (
    <li>
      <p className="font-medium text-[#344054]">
        {card.cohortName} <span className="text-xs font-normal text-[#98a2b3]">{card.termName}</span>
      </p>
      {card.sets.map((set) => (
        <div key={set.scope.id} className="mt-1 pl-3">
          <p className="text-xs uppercase tracking-wide text-[#8a94a4]">{set.scope.code}</p>
          <ul className="text-sm">
            {set.rows
              .filter((row) => teaches(row))
              .flatMap((row) => rowsPerPart(row))
              .map((row) => {
                const section = row.section ? filled(row.section, set.course.request) : null;
                // The chosen teacher where there is one, the row's own written name otherwise.
                const staff = section ? (section.teacherId && nameOf(section.teacherId)) || section.teacher : "";
                return (
                  <li key={`${row.group.id}|${row.section?.part ?? 1}`} className="flex flex-wrap items-baseline gap-x-3 py-0.5">
                    <span className="text-[#667085]">{row.group.label}</span>
                    <span className="tabular-nums text-[#344054]">{section?.crn || <Nothing />}</span>
                    <span className="text-[#667085]">{staff || <Nothing />}</span>
                    {section?.hours ? <span className="text-xs tabular-nums text-[#98a2b3]">{section.hours} h</span> : null}
                    {row.parts && row.parts > 1 ? (
                      <span className="text-xs text-[#1f4e79]">part {row.section?.part} of {row.parts}</span>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </li>
  );
}

function Card({
  title,
  note,
  action,
  className = "",
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  /** `flex-1` for the last card of a column, so it reaches the foot of its row. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-[#e4e8ef] bg-white px-4 py-3 ${className}`}>
      {/* What the card is for sits on an ⓘ by its title: read once, not paid for on every opening. */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
          {note ? <InfoTip label={`About ${title.charAt(0).toLowerCase()}${title.slice(1)}`}>{note}</InfoTip> : null}
        </div>
        {action}
      </div>
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

/** What a field says when it has nothing to say, rather than an empty space. */
function Nothing() {
  return <span className="text-[#c8d0da]">—</span>;
}
