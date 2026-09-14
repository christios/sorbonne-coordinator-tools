import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightCircle, Check, ChevronDown, EyeOff, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { CommentThread } from "@/components/CommentThread";
import { CrnRecord } from "@/components/CrnRecord";
import { Modal } from "@/components/Modal";
import { PlaceInBlock } from "@/components/PlaceInBlock";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import {
  STATUS_FIELD,
  STATUS_OPTIONS,
  arrivalsFor,
  describeWarning,
  labelOf,
  rulesFor,
  warningsForCohort,
  type Change,
  type Options,
} from "@/services/discrepancies";
import {
  type Mismatch,
  describeMismatch,
  fetchActiveCrns,
  fetchRegistrationCheck,
  fetchRegistrations,
  fetchTermLinks,
  type ActiveCrn,
} from "@/services/portalLists";
import { allChanges, historyFor, type PullHistory } from "@/services/pullHistory";
import { reconcile, tally } from "@/services/registrationLists";
import type { StudentRow } from "@/services/rosterView";
import { fetchSchema } from "@/services/scenRosters";
import {
  clearExemption,
  fetchAssignments,
  fetchCatalogue,
  fetchDiscrepancyRules,
  fetchExemptions,
  partsOf,
  setExemption,
  type Cohort,
} from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";
import { afterPlacement } from "@/services/afterPlacement";

/*
 * The portal's fields, sorted into the questions a coordinator actually asks. Anything
 * not named here is still shown, folded away, so nothing the portal said is lost.
 */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Programme", keys: ["MAJOR_CODE_DESC", "MAJOR_CODE", "PROGRAM_CODE", "PROGRAM_DESC", "YEARLEVEL_CODE", "LEVEL_CODE", "DEPT_DESC", "DEPT_CODE", "COLLEGE_CODE", "COLLEGE_DESC", "CAMPUS_CODE"] },
  { title: "Status", keys: ["STST_CODE", "STST_DESC", "ESTS_CODE", "ESTS_DESC", "STYP_DESC", "STYP_CODE", "TERM_CODE", "RE_COURSES_COUNT", "ABSENCE_PER"] },
  { title: "Contact", keys: ["PSUAD_EMAIL", "FIRST_NAME", "LAST_NAME"] },
];
const NAMED = new Set(GROUPS.flatMap((group) => group.keys).concat(["FULL_NAME", "SPRIDEN_ID"]));

const LABELS: Record<string, string> = {
  STST_DESC: "student status",
  ESTS_DESC: "enrolment status",
  MAJOR_CODE: "major code",
  PROGRAM_DESC: "programme",
  DEPT_DESC: "department",
  DEPT_CODE: "department code",
  COLLEGE_CODE: "college",
  LEVEL_CODE: "level",
  CAMPUS_CODE: "campus",
  STYP_DESC: "student type",
  STYP_CODE: "student type code",
  TERM_CODE: "term",
  RE_COURSES_COUNT: "registered courses",
  ABSENCE_PER: "absence %",
  FIRST_NAME: "first name",
  LAST_NAME: "last name",
};

function nameOf(field: string): string {
  const label = LABELS[field] ?? labelOf(field);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Everything this application knows about one student, on one screen.
 *
 * Read top to bottom the way the question is asked: who they are, what the portal says
 * about them, where the department put them, what the registrar actually registered, and
 * what has changed. The portal's facts are this browser's — the server holds no name —
 * and the record says so once rather than on every line.
 */
export function StudentRecord({
  open,
  row,
  cohorts,
  history,
  onClose,
}: {
  open: boolean;
  row: StudentRow;
  cohorts: Cohort[];
  history: PullHistory;
  onClose: () => void;
}) {
  const cohortId = row.cohortId ?? "";
  const cohort = cohorts.find((candidate) => candidate.id === cohortId) ?? null;
  /*
   * The record modal is where a student's groups are proposed, because it is the only
   * surface organised BY STUDENT — every other one is organised by set or by cohort — and
   * a student arriving mid-term is a question about one person, not about a set.
   */
  const [placing, setPlacing] = useState(false);
  const registrations = useQuery({
    queryKey: ["registrations", row.studentId],
    queryFn: () => fetchRegistrations(row.studentId),
    enabled: open,
    retry: false,
  });
  const check = useQuery({
    queryKey: ["registration-check", cohortId],
    queryFn: () => fetchRegistrationCheck(cohortId),
    enabled: open && Boolean(cohortId),
    retry: false,
  });
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, enabled: open });
  // The register says which CRN hangs from which, which is what lets the list below read
  // as courses with their sections rather than as a flat pile of numbers.
  const register = useQuery({ queryKey: ["active-crns", ""], queryFn: () => fetchActiveCrns(), enabled: open, retry: false });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open, retry: false });
  /*
   * With the sets shared across cohorts, or a language group is invisible here.
   *
   * A set open to every cohort lives on one cohort's row — the languages under Foundation
   * Year — so asking for L2's catalogue alone returned nothing to match an L2 student's
   * language placement against, and the group was silently dropped from this page while
   * the Students table, which reads them straight from the server, showed it. It also
   * left the registration check below judging them against half their groups.
   */
  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, "", "with-shared"],
    queryFn: () => fetchCatalogue(cohortId, undefined, true),
    enabled: open && Boolean(cohortId),
  });
  const assignments = useQuery({
    queryKey: ["assignments", cohortId],
    queryFn: () => fetchAssignments(cohortId),
    enabled: open && Boolean(cohortId),
  });

  // The rules, judged for this one student: the same engine as the Cohorts page, on one row.
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules, enabled: open });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: open, staleTime: 60_000 });
  const [changes, setChanges] = useState<Change[] | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void allChanges().then((held) => {
      if (live) setChanges(held.get(row.studentId) ?? []);
    });
    return () => {
      live = false;
    };
  }, [open, row.studentId]);
  const judged = useMemo(() => {
    if (!rules.data || !changes) return null;
    const options: Options = (field) =>
      field === STATUS_FIELD
        ? STATUS_OPTIONS
        : (schema.data?.fields.find((candidate) => candidate.key.toUpperCase() === field)?.options ?? []);
    const now = { ...row.portal, [STATUS_FIELD]: row.status };
    const placed = [{ studentId: row.studentId, cohortId: row.cohortId, cohortSince: row.cohortSince }];
    const current = () => now;
    const changesOf = () => changes;
    const own = cohort
      ? warningsForCohort({ cohort, students: placed, rules: rulesFor(rules.data, cohort.id), current, changes: changesOf, options }).filter(
          (warning) => warning.kind !== "no_baseline",
        )
      : [];
    // The other direction: a cohort they belong to by its expectations, that they are not
    // in — where that cohort has a rule asking to know.
    const arrivals = cohorts
      .filter((candidate) => candidate.id !== row.cohortId)
      .flatMap((candidate) =>
        arrivalsFor({ cohort: candidate, rules: rulesFor(rules.data, candidate.id), students: placed, current, changes: changesOf, options }).map(
          (arrival) => ({ ...arrival, cohort: candidate }),
        ),
      );
    return { own, arrivals };
  }, [rules.data, schema.data, changes, row, cohort, cohorts]);

  const termName = (termId: string) => (terms.data ?? []).find((term) => term.id === termId)?.name ?? termId;
  const held = assignments.data?.[row.studentId] ?? {};
  const placements = (catalogue.data?.scopes ?? [])
    .filter((scope) => held[scope.id])
    .map((scope) => {
      const group = scope.groups.find((candidate) => candidate.id === held[scope.id]);
      return {
        scope,
        group,
        /*
         * One line per PART, not per course. A course handed from one professor to
         * another at mid-semester is taught under a CRN per half, and both are this
         * student's — a list carrying only the first would show the registrar's second
         * half as a registration nobody placed them in.
         */
        crns: scope.courses.flatMap((course) => {
          const parts = partsOf(group?.crns[course.id]).filter((part) => part.crn);
          return parts.length
            ? parts.map((part) => ({ courseId: course.id, courseCode: course.code, courseName: course.name, crn: part.crn }))
            : [{ courseId: course.id, courseCode: course.code, courseName: course.name, crn: "" }];
        }),
      };
    });
  const client = useQueryClient();
  const registered = new Set((registrations.data ?? []).filter((r) => r.status === "in_portal").map((r) => r.crn));
  /*
   * Which of their group's courses this student does not take.
   *
   * A course they hold credit for elsewhere, or have already passed. Without it the
   * register reports them as missing from a section that was never theirs to be in, in the
   * same words it uses for a real fault.
   */
  const exemptions = useQuery({
    queryKey: ["exemptions", cohortId ?? ""],
    queryFn: () => fetchExemptions(cohortId ?? ""),
    enabled: open && Boolean(cohortId),
  });
  const excused = useMemo(
    () =>
      new Set(
        (exemptions.data ?? [])
          .filter((entry) => entry.studentId === row.studentId)
          .map((entry) => entry.courseId),
      ),
    [exemptions.data, row.studentId],
  );
  const exempt = useMutation({
    mutationFn: ({ courseId, on }: { courseId: string; on: boolean }) =>
      on ? setExemption(row.studentId, courseId) : clearExemption(row.studentId, courseId),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["exemptions", cohortId ?? ""] });
      void client.invalidateQueries({ queryKey: ["course-cards"] });
      void client.invalidateQueries({ queryKey: ["registration-check"] });
    },
  });
  /*
   * The two lists side by side: what the groups come to, and what the registrar has.
   *
   * Everything worth knowing about a registration is the difference between them, and it
   * used to have to be assembled by eye from a list of groups on one side of the page and
   * a list of courses on the other, with the warnings folded in among the courses.
   */
  const lines = reconcile(placements, registrations.data ?? []);
  const counted = tally(lines);
  const mismatches: Mismatch[] = (check.data?.mismatches ?? []).filter(
    (mismatch) => mismatch.studentId === row.studentId,
  );
  /*
   * Whether the check actually looked at THIS student, rather than merely not complaining.
   *
   * A student the registrations pull did not return is skipped by the check — deliberately,
   * since there is nothing to hold them against — and used to come out the far end looking
   * exactly like a student whose registrations were perfect. The coverage names them, so
   * the difference can be said out loud.
   */
  const seenByTheCheck = (check.data?.coverage ?? []).some(
    (term) => term.judged > 0 && !term.skipped.includes(row.studentId),
  );
  /*
   * A class on the calendar opens its CRN's record, where the register holds one. An
   * elective of another department is drawn — it is where the student will be — but is
   * nothing of ours to open.
   */
  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  const inRegister = (crn: string) => (register.data ?? []).find((entry) => entry.crn === crn) ?? null;
  const entries = historyFor(history, row.studentId);
  const portal = Object.fromEntries(Object.entries(row.portal).filter(([, value]) => String(value ?? "").trim()));
  const rest = Object.keys(portal)
    .filter((key) => !NAMED.has(key))
    .sort();
  const noLink = links.data && Object.keys(links.data).length === 0;
  /*
   * Their week, as the registrar has booked it.
   *
   * Two lists again, drawn as one: every section their groups stand for, and every one
   * the registrar has registered them in. Where the two agree the box is solid. A group's
   * section they are not registered for is dashed — the class we expect them at and the
   * registrar does not — and a registration outside any group of theirs, a language or an
   * option, is drawn like any other, because it is where they will be on that afternoon
   * and it is exactly the class our groups cannot see a clash with.
   */
  const placedCrns = new Set(placements.flatMap(({ crns }) => crns.map((cell) => cell.crn)).filter(Boolean));
  const timetable: TimetableEntry[] = [
    ...placements.flatMap(({ scope, crns }) =>
      crns
        .filter((cell) => cell.crn && !excused.has(cell.courseId))
        .map((cell) => ({
          termCode: links.data?.[scope.termId ?? ""] ?? "",
          crn: cell.crn,
          code: cell.courseCode,
          title: cell.courseName,
          tone: registered.has(cell.crn) ? ("solid" as const) : ("outline" as const),
        })),
    ),
    ...(registrations.data ?? [])
      .filter((registration) => registration.status === "in_portal" && !placedCrns.has(registration.crn))
      .map((registration) => ({
        termCode: registration.termCode,
        crn: registration.crn,
        code: registration.courseCode,
        title: registration.title,
        staff: registration.teacherName,
      })),
  ];

  return (
    <Modal
      open={open}
      size="wide"
      title={row.name || row.studentId}
      onClose={onClose}
      header={
        <dl className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2 text-sm">
          {/*
            * Each pill says what it is. Unlabelled, the row was five chips of the same
            * shape whose meaning had to be inferred from the value — and a value that
            * could belong to more than one field made the reader guess. A dl, because
            * that is what a row of field-and-value is.
            */}
          <Field label="ID">
            <span className="font-mono text-[#667085]">{row.studentId}</span>
          </Field>
          <Field label="Registrar">
            {row.status === "not_in_portal" ? <Pill tone="bad">Not in portal</Pill> : <Pill tone="good">In portal</Pill>}
          </Field>
          <Field label="Cohort">
            {cohort ? <Pill tone="accent">{cohort.name}</Pill> : <Pill tone="muted">No cohort</Pill>}
          </Field>
          {row.yearLevel ? (
            <Field label="Year">
              <Pill tone="muted">{row.yearLevel}</Pill>
            </Field>
          ) : null}
          {row.major ? (
            <Field label="Major">
              <Pill tone="muted">{row.major}</Pill>
            </Field>
          ) : null}
          {row.email ? (
            <Field label="E-mail">
              <a href={`mailto:${row.email}`} className="text-[#1f4e79] underline">
                {row.email}
              </a>
            </Field>
          ) : null}
        </dl>
      }
    >
      {/* --------------------------------------------------------------- warnings */}
      {judged && (judged.own.length || judged.arrivals.length) ? (
        <ul className="mb-5 space-y-1.5" aria-label="Warnings">
          {judged.own.map((warning) => (
            <li key={warning.key} className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                {describeWarning(warning)}
                {cohort ? <span className="text-[#b08a2e]"> — by the rules, in {cohort.name}</span> : null}
              </span>
            </li>
          ))}
          {judged.arrivals.map((arrival) => (
            <li key={arrival.cohort.id} className="flex items-start gap-2 rounded-md border border-[#bcd3ea] bg-[#eef5fb] px-3 py-2 text-sm text-[#1f4e79]">
              <ArrowRightCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Belongs to {arrival.cohort.name} by what it expects ({arrival.major}
                {arrival.moved
                  ? `, from ${arrival.moved.from} on ${new Date(arrival.moved.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
                  : ""}
                ), and is {cohort ? `in ${cohort.name}` : "in no cohort"}.
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------------------------------------ the portal */}
        <div className="space-y-5">
        <Card title="From the portal" note="As this browser last saw it. Nothing here is on the server.">
          {Object.keys(portal).length === 0 ? (
            <Empty>No portal pull holds this student. Sync a portal filter on the Students page.</Empty>
          ) : (
            <div className="space-y-4">
              {GROUPS.map((group) => {
                const present = group.keys.filter((key) => portal[key] !== undefined);
                if (!present.length) return null;
                return (
                  <div key={group.title}>
                    <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">{group.title}</h4>
                    <Facts entries={present.map((key) => [nameOf(key), String(portal[key])])} />
                  </div>
                );
              })}
              {rest.length ? (
                <Folded label={`${rest.length} more portal field${rest.length === 1 ? "" : "s"}`}>
                  <Facts entries={rest.map((key) => [nameOf(key), String(portal[key])])} />
                </Folded>
              ) : null}
            </div>
          )}
        </Card>

          {/* ---------------------------------------------------------- timetable */}
        <Card
          title="Timetable"
          note="Their week as the registrar has booked it: the sections they are registered in, and the ones their groups stand for."
        >
          <SectionTimetable
            entries={timetable}
            compact
            title={`${row.name || row.studentId} — timetable`}
            openable={(crn) => Boolean(inRegister(crn))}
            onOpenCrn={(crn) => setShowingCrn(inRegister(crn))}
            emptyMessage="In no group and registered in nothing, so there is no week to show."
          />
        </Card>
        </div>

        <div className="space-y-5">
          {/* ------------------------------------------------------------ groups */}
          <Card title="Groups" note={cohort ? `Where ${cohort.name} put them, and the CRNs each group stands for.` : "Where the department put them."}>
            {cohort ? (
              <button
                type="button"
                onClick={() => setPlacing(true)}
                className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
              >
                <Wand2 size={13} aria-hidden="true" /> Place in every set…
              </button>
            ) : null}
            {!cohortId ? (
              <Empty>In no cohort, so in no group.</Empty>
            ) : catalogue.isLoading || assignments.isLoading ? (
              <Empty>Reading…</Empty>
            ) : placements.length === 0 ? (
              <Empty>In no group yet.</Empty>
            ) : (
              <ul className="space-y-2.5" aria-label="Groups">
                {placements.map(({ scope, group, crns }) => (
                  <li key={scope.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <span className="inline-flex items-center rounded-full bg-[#eef1f5] px-2.5 py-0.5 text-sm font-semibold text-[#344054]">
                      {scope.code} {group?.label ?? "?"}
                    </span>
                    <span className="pt-0.5 text-xs text-[#98a2b3]">{termName(scope.termId ?? "")}</span>
                    <ul className="flex basis-full flex-wrap gap-x-4 gap-y-0.5 pl-1 text-xs text-[#667085]">
                      {crns.map((cell) => {
                        // A course handed over mid-semester is two CRNs of one course, so
                        // the code alone is no longer unique down this list.
                        const off = excused.has(cell.courseId);
                        return (
                          <li key={`${cell.courseId}|${cell.crn}`} className="inline-flex items-center gap-1 tabular-nums">
                            <span className={off ? "text-[#c8d0da] line-through" : "text-[#344054]"}>{cell.courseCode}</span>{" "}
                            <span className={off ? "text-[#c8d0da]" : ""}>{cell.crn || "—"}</span>
                            {cell.crn && registered.has(cell.crn) && !off ? (
                              <Check size={12} className="text-[#2f6b3d]" aria-label="registered" />
                            ) : null}
                            {/*
                              * Marked here as well as on the group's roster: this is the
                              * one surface organised by student, so somebody's whole
                              * situation — every set, every course — is settled in one pass.
                              */}
                            <button
                              type="button"
                              aria-pressed={off}
                              disabled={exempt.isPending}
                              title={
                                off
                                  ? `Exempt from ${cell.courseCode}. Press to put them back in it.`
                                  : `Mark as not taking ${cell.courseCode}`
                              }
                              onClick={() => exempt.mutate({ courseId: cell.courseId, on: !off })}
                              className="rounded px-1 text-[10px] font-semibold text-[#c8d0da] hover:bg-[#f2f4f7] hover:text-[#8a6116]"
                            >
                              {off ? "exempt" : "exempt?"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            {cohort ? (
              <PlaceInBlock
                open={placing}
                cohort={cohort}
                studentIds={[row.studentId]}
                opens="proposed"
                onClose={() => setPlacing(false)}
                onPlaced={() => {
                  setPlacing(false);
                  // The same list the roster uses after a placement. Invalidating only the
                  // groups and the catalogue left the row behind this record — its Groups
                  // column and its registration warnings — reading as before until reload.
                  afterPlacement(client);
                }}
              />
            ) : null}
          </Card>

          {/* --------------------------------------------- ours against the portal */}
          <Card
            title="CRNs"
            note="What their groups come to, what the registrar has, and where the two part company."
          >
            {catalogue.isLoading || registrations.isLoading ? (
              <Empty>Reading…</Empty>
            ) : lines.length === 0 ? (
              <Empty>No CRNs on either side yet.</Empty>
            ) : (
              <>
                <p className="mb-2 text-xs text-[#98a2b3]">
                  {counted.agree} agree
                  {counted.onlyOurs ? ` · ${counted.onlyOurs} not registered` : ""}
                  {counted.onlyPortal ? ` · ${counted.onlyPortal} registered that is no group of theirs` : ""}
                </p>
                <table className="w-full border-collapse text-sm" aria-label="CRNs">
                  <thead>
                    <tr className="border-b border-[#e4e8ef] text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                      <th scope="col" className="py-1.5 pr-3 text-left">CRN</th>
                      <th scope="col" className="py-1.5 pr-3 text-left">Course</th>
                      <th scope="col" className="py-1.5 pr-3 text-left">Their group</th>
                      <th scope="col" className="py-1.5 pr-3 text-left">Registrar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line) => (
                      <tr key={line.crn} className="border-b border-[#f2f4f7] last:border-0 align-top">
                        <td className="py-1.5 pr-3 tabular-nums text-[#344054]">{line.crn}</td>
                        <td className="py-1.5 pr-3">
                          <span className="text-[#344054]">{line.courseCode}</span>
                          {line.title ? <span className="ml-2 text-xs text-[#98a2b3]">{line.title}</span> : null}
                        </td>
                        {/*
                          * A blank on one side is the whole point of the table, so it is
                          * said rather than left empty: an empty cell reads as "not looked
                          * at", and these have been looked at.
                          */}
                        <td className="py-1.5 pr-3">
                          {line.ours ? (
                            <span className="text-[#344054]">{line.from}</span>
                          ) : (
                            <span className="text-[#a6292f]">no group of theirs</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3">
                          {line.portal ? (
                            <span className="inline-flex items-center gap-1 text-[#2f6b3d]">
                              <Check size={13} aria-hidden="true" /> registered
                            </span>
                          ) : (
                            <span className="text-[#a6292f]">not registered</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {registrations.error ? <p className="mt-2 text-sm text-[#a6292f]">{(registrations.error as Error).message}</p> : null}
            {/*
              * The check's own verdicts, in its own words. The table above says which CRNs
              * are on one side only; the check says what that comes to for a course — a
              * doubled group, a collision — which no one row of the table can.
              */}
            {mismatches.length ? (
              <ul className="mt-3 space-y-1" aria-label="What the check says">
                {mismatches.map((warning) => (
                  <li
                    key={`${warning.termCode}|${warning.courseCode}|${warning.kind}|${warning.scopeCode ?? ""}`}
                    className="flex items-start gap-1.5 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-2.5 py-1.5 text-xs text-[#8a6116]"
                  >
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{describeMismatch(warning)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {!mismatches.length && cohortId && check.data && (registrations.data ?? []).length ? (
              seenByTheCheck ? (
                <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#2f6b3d]">
                  <Check size={14} aria-hidden="true" /> Registrations agree with the groups.
                </p>
              ) : (
                <p className="mt-3 inline-flex items-start gap-1.5 text-xs text-[#98a2b3]">
                  <EyeOff size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
                  No registrations pull has returned this student for their semester, so nothing above has been
                  compared against their groups. Sync a Registrations filter that covers them.
                </p>
              )
            ) : null}
            {noLink && cohortId ? (
              <p className="mt-3 text-xs text-[#98a2b3]">
                No semester is linked to a portal term yet, so nothing is compared. Set the portal term on the Semesters page.
              </p>
            ) : null}
          </Card>

        </div>
      </div>


      {/*
        * The second row: what people have said, beside what the portal's record has done.
        * Both are short and both are read after the facts, so they share a row rather than
        * each taking a full one with half of it empty.
        */}
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* ----------------------------------------------------------- comments */}
          <Card title="Comments" note="On the server: every coordinator who opens this student reads the same thread.">
            <CommentThread studentId={row.studentId} label={row.name || row.studentId} />
          </Card>
      {/* ---------------------------------------------------------------- history */}
      <Card title="History" note="What changed in the portal's record, from this browser's pull history.">
        {entries.length === 0 ? (
          <Empty>No changes recorded.</Empty>
        ) : (
          <ol className="space-y-2" aria-label="History">
            {entries.map((entry) => (
              <li key={entry.pullId} className="grid grid-cols-[6.5rem_1fr] gap-x-3 text-sm">
                <span className="tabular-nums text-[#98a2b3]">{new Date(entry.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                {entry.kind === "arrived" ? (
                  <span className="text-[#2f6b3d]">First seen in a pull</span>
                ) : entry.kind === "departed" ? (
                  <span className="text-[#a6292f]">No longer returned by the portal</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {entry.changes.map((change) => (
                      <span key={change.field} className="inline-flex items-center gap-1 rounded-full bg-[#fff6e5] px-2 py-0.5 text-xs text-[#8a6d00]">
                        <span className="font-semibold">{labelOf(change.field)}:</span> {change.from || "—"} → {change.to || "—"}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>
      </div>
      {showingCrn ? (
        <CrnRecord
          open
          row={showingCrn}
          siblings={(register.data ?? []).filter((entry) => entry.courseCode === showingCrn.courseCode && entry.termCode === showingCrn.termCode)}
          onClose={() => setShowingCrn(null)}
          onSaved={() => void client.invalidateQueries({ queryKey: ["active-crns"] })}
        />
      ) : null}

    </Modal>
  );
}

function Card({ title, note, className = "", children }: { title: string; note?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`rounded-lg border border-[#e4e8ef] bg-white px-4 py-3 ${className}`}>
      <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
      {note ? <p className="mb-2 text-xs text-[#98a2b3]">{note}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

function Facts({ entries }: { entries: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1 text-sm">
      {entries.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-[#667085]">{label}</dt>
          <dd className="break-words text-[#171717]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Folded({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-semibold text-[#1f4e79]"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
        {open ? "Hide" : "Show"} {label}
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-[#667085]">{children}</p>;
}

/** A labelled value in the record's header — the label in small print above it. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10px] font-semibold uppercase leading-none tracking-[0.08em] text-[#98a2b3]">{label}</dt>
      <dd className="leading-none">{children}</dd>
    </div>
  );
}

function Pill({ tone, children }: { tone: "good" | "bad" | "muted" | "accent"; children: ReactNode }) {
  const look =
    tone === "good"
      ? "bg-[#eaf4ec] text-[#2f6b3d]"
      : tone === "bad"
        ? "bg-[#fdf3f3] text-[#a6292f]"
        : tone === "accent"
          ? "bg-[#e8edf3] text-[#1f4e79]"
          : "bg-[#eef1f5] text-[#344054]";
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${look}`}>{children}</span>;
}
