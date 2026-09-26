import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightCircle, Check, ChevronDown, ClipboardList, EyeOff, GraduationCap, MinusCircle, ShieldCheck, UserMinus, Wand2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { CommentThread } from "@/components/CommentThread";
import { CrnRecord } from "@/components/CrnRecord";
import { Modal } from "@/components/Modal";
import { PlaceInBlock } from "@/components/PlaceInBlock";
import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { subRowLabel } from "@/services/courseCards";
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
  type Elective,
  type Mismatch,
  describeMismatch,
  fetchActiveCrns,
  fetchRegistrationCheck,
  fetchRegistrations,
  fetchTermLinks,
  type ActiveCrn,
} from "@/services/portalLists";
import { allChanges, historyFor, type PullHistory } from "@/services/pullHistory";
import { copyTable } from "@/services/copyCells";
import { CHANGE_COLUMNS, changesRows, noteChanges, registrationChanges } from "@/services/registrationChanges";
import { reconcile, tally } from "@/services/registrationLists";
import type { StudentRow } from "@/services/rosterView";
import { fetchSchema } from "@/services/scenRosters";
import {
  type CatalogueGroup,
  type CatalogueScope,
  type Cohort,
  assignStudents,
  clearApproval,
  clearExemption,
  describeHistory,
  fetchApprovals,
  fetchAssignmentMajors,
  fetchAssignments,
  fetchCatalogue,
  fetchDiscrepancyRules,
  fetchExemptions,
  fetchStudentHistory,
  parentsOf,
  partsOf,
  sectionFor,
  setApproval,
  setExemption,
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
  { title: "Contact", keys: ["PSUAD_EMAIL", "MOBILE_NO", "FIRST_NAME", "LAST_NAME"] },
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
  MOBILE_NO: "mobile",
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
  /*
   * The electives a coordinator has approved for them, and everything the server has seen
   * happen to them. Both live on the server, so every coordinator reads the same.
   */
  const approvals = useQuery({
    queryKey: ["approvals", row.studentId],
    queryFn: () => fetchApprovals(row.studentId),
    enabled: open,
    retry: false,
  });
  const serverHistory = useQuery({
    queryKey: ["student-history", row.studentId],
    queryFn: () => fetchStudentHistory(row.studentId),
    enabled: open,
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
    queryKey: ["catalogue", cohortId, ""],
    queryFn: () => fetchCatalogue(cohortId, undefined),
    enabled: open && Boolean(cohortId),
  });
  const assignments = useQuery({
    queryKey: ["assignments", cohortId],
    queryFn: () => fetchAssignments(cohortId),
    enabled: open && Boolean(cohortId),
  });
  // Which sub-row each placement took: a mathematician in CM 1 reads the maths cells.
  const subRows = useQuery({
    queryKey: ["assignment-majors", cohortId],
    queryFn: () => fetchAssignmentMajors(cohortId),
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
  const onSubRow = subRows.data?.[row.studentId] ?? {};
  /** "doesn't go with TD 2", for a group of a linked set that does not go with their group in that set. */
  const misfitOf = (scope: CatalogueScope, group: CatalogueGroup): string => {
    if (scope.kind !== "nested") return "";
    const parent = (catalogue.data?.scopes ?? []).find((candidate) => candidate.id === scope.parentScopeId);
    const theirs = parent ? held[parent.id] : "";
    if (!parent || !theirs || parentsOf(group).includes(theirs)) return "";
    return `doesn't go with ${parent.code} ${parent.groups.find((candidate) => candidate.id === theirs)?.label ?? "?"}`;
  };
  const placements = (catalogue.data?.scopes ?? [])
    .filter((scope) => held[scope.id])
    .map((scope) => {
      const group = scope.groups.find((candidate) => candidate.id === held[scope.id]);
      const majorId = onSubRow[scope.id] ?? "";
      const major = group?.majors?.find((candidate) => candidate.id === majorId) ?? null;
      return {
        scope,
        group,
        major,
        /*
         * One line per PART, not per course. A course handed from one professor to
         * another at mid-semester is taught under a CRN per half, and both are this
         * student's — a list carrying only the first would show the registrar's second
         * half as a registration nobody placed them in. And what THEIR sub-row comes to:
         * a course the sub-row is not taught is no line at all.
         */
        crns: scope.courses.flatMap((course) => {
          if (group && majorId && group.byMajor?.[majorId]?.[course.id]?.notTaught) return [];
          const parts = partsOf(group ? sectionFor(group, majorId, course.id) : null).filter((part) => part.crn);
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
  /*
   * Exempt from a course, not from one set's row of it: "not taking PHYS-125" is its
   * lecture, its tutorial and its practical at once, which is how the register reads it.
   * Marked one set at a time, a student exempt from a course was still chased for the
   * set nobody had got round to.
   */
  const exempt = useMutation({
    mutationFn: async ({ courseCode, on }: { courseCode: string; on: boolean }) => {
      const courseIds = [
        ...new Set(placements.flatMap((placement) => placement.crns).filter((cell) => cell.courseCode === courseCode).map((cell) => cell.courseId)),
      ];
      for (const courseId of courseIds) {
        if (on) await setExemption(row.studentId, courseId);
        else await clearExemption(row.studentId, courseId);
      }
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["exemptions", cohortId ?? ""] });
      void client.invalidateQueries({ queryKey: ["course-cards"] });
      // This cohort's verdict, not every cohort's: a student belongs to one, and the
      // register's answer is the slowest thing the server builds. Asking for all four
      // put the next click behind three answers nobody was waiting for.
      void client.invalidateQueries({ queryKey: ["registration-check", cohortId] });
    },
  });
  /*
   * Taking them out of one group, from the group itself.
   *
   * It could only be done from the Students table: tick the row, "Take out of groups", and
   * then it was every group of a semester at once. Here it is one set, the one pressed on,
   * and asked once more in words before it happens — the rest of their groups stay.
   */
  const [leaving, setLeaving] = useState("");
  const takeOut = useMutation({
    mutationFn: async (scopeId: string) => {
      const report = await assignStudents(scopeId, [row.studentId], null);
      if (report.skipped.includes(row.studentId)) throw new Error("That set belongs to another cohort, so they were left in it.");
    },
    onSuccess: () => {
      setLeaving("");
      afterPlacement(client);
      // Which sub-row they sat on goes with the group.
      void client.invalidateQueries({ queryKey: ["assignment-majors"] });
    },
  });
  /*
   * Approving an elective: the register's *outside* verdict on this course goes away for
   * this student, for everybody who looks, and the History card says whose decision it was.
   */
  const approve = useMutation({
    mutationFn: async ({ termCode, courseCode, on }: { termCode: string; courseCode: string; on: boolean }) => {
      if (on) await setApproval(row.studentId, termCode, courseCode);
      else await clearApproval(row.studentId, termCode, courseCode);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["approvals", row.studentId] });
      void client.invalidateQueries({ queryKey: ["registration-check", cohortId] });
      void client.invalidateQueries({ queryKey: ["student-history", row.studentId] });
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
  const counted = tally(lines, excused);
  // What the portal has them in that no group of theirs gives them.
  const outside = lines.filter((line) => !line.ours && line.portal);
  /*
   * Who teaches a CRN, as the portal has it: from their own registration in it, else from
   * the register's list of CRNs — a section they are not registered in still has a teacher.
   */
  const portalTeacherOf = new Map((registrations.data ?? []).map((entry) => [entry.crn, entry.teacherName ?? ""]));
  const portalTeacher = (crn: string) => portalTeacherOf.get(crn) || inRegister(crn)?.teacherName || "";
  const mismatches: Mismatch[] = (check.data?.mismatches ?? []).filter(
    (mismatch) => mismatch.studentId === row.studentId,
  );
  /*
   * The courses they take outside their cohort's groups, by CRN.
   *
   * Not a fault and not a warning — sport, a language another department runs. The table
   * below draws them apart from the rest rather than calling them "no group of theirs",
   * which is true and reads as an accusation.
   */
  const theirElectives = (check.data?.electives ?? []).filter((elective) => elective.studentId === row.studentId);
  const electiveOf = new Map<string, { courseCode: string; status: Elective["status"]; termCode: string }>();
  for (const elective of theirElectives) {
    for (const crn of elective.crns) {
      electiveOf.set(crn, { courseCode: elective.courseCode, status: elective.status, termCode: elective.termCode });
    }
  }
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
  /*
   * This student's share of the registrar's worklist.
   *
   * The same two builders the Cohorts page uses, over the verdicts and warnings already
   * on screen — so a record and the table can never hand the registrar different lines
   * for the same person. The name and year are this one student's, which is all a
   * one-student copy needs.
   */
  const myChanges = [
    ...registrationChanges(mismatches, () => row.name, cohort?.name ?? "", () => row.yearLevel),
    ...noteChanges(judged?.own ?? [], () => row.name, cohort?.name ?? "", () => row.yearLevel),
  ];
  const [copied, setCopied] = useState("");
  const copyChanges = async () => {
    if (!myChanges.length) return;
    const done = await copyTable([...CHANGE_COLUMNS], changesRows(myChanges));
    setCopied(done ? `${myChanges.length} line${myChanges.length === 1 ? "" : "s"} copied` : "Could not copy");
    window.setTimeout(() => setCopied(""), 2000);
  };

  const [showingCrn, setShowingCrn] = useState<ActiveCrn | null>(null);
  const inRegister = (crn: string) => (register.data ?? []).find((entry) => entry.crn === crn) ?? null;
  /*
   * One timeline from two records: what the server saw happen (moves, placements,
   * registrations, approvals — signed) and what the portal's own record did (from this
   * browser's pull history). Newest first, whichever record it came from.
   */
  const entries = [
    ...historyFor(history, row.studentId).map((entry) => ({ at: entry.at, key: `pull|${entry.pullId}`, pull: entry, line: null })),
    ...(serverHistory.data ?? []).map((line) => ({ at: Date.parse(line.at), key: `server|${line.id}`, pull: null, line })),
  ].sort((left, right) => right.at - left.at);
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
    ...placements.flatMap(({ scope, group, major, crns }) =>
      crns
        .filter((cell) => cell.crn && !excused.has(cell.courseId))
        .map((cell) => ({
          termCode: links.data?.[scope.termId ?? ""] ?? "",
          crn: cell.crn,
          code: cell.courseCode,
          title: cell.courseName,
          group: `${scope.code} ${group ? subRowLabel(group.label, major?.program ?? "", (group.majors ?? []).length) : ""}`.trim(),
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
          <Field label="Portal">
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
          {/* The portal's number, as this browser last pulled it; a tap on a phone rings it. */}
          {(row.portal.MOBILE_NO ?? "").trim() ? (
            <Field label="Mobile">
              <a href={`tel:${row.portal.MOBILE_NO.replace(/[^\d+]/g, "")}`} className="tabular-nums text-[#1f4e79] underline">
                {row.portal.MOBILE_NO.trim()}
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
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
          note="Their week as the portal has booked it: the sections they are registered in, and the ones their groups stand for."
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
          {/* ------------------------------------------------- groups and their CRNs */}
          {/*
            * One card where there were two: "Groups" said where they sit and "CRNs" said what
            * the portal has, and every question a coordinator asks — is this student where
            * they should be, and does the registrar agree — needed both, read against each
            * other by eye. Now each set is a band, its CRNs under it with who teaches them and
            * the portal's word on each; what the portal has outside their groups comes last.
            */}
          <Card
            title="Groups and CRNs"
            note={
              cohort
                ? `Where ${cohort.name} put them, who teaches each CRN, and whether the portal has them in it.`
                : "What the portal has them in."
            }
            beside={
              <div className="flex flex-wrap items-center justify-end gap-2">
                {cohort ? (
                  <button
                    type="button"
                    onClick={() => setPlacing(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                  >
                    <Wand2 size={13} aria-hidden="true" /> Place in every set…
                  </button>
                ) : null}
                {/*
                  * The registrar's worklist for this one student. The table's copy answers
                  * "what does this cohort owe the registrar"; somebody looking at one student
                  * is asking the same question about them.
                  */}
                <button
                  type="button"
                  onClick={() => void copyChanges()}
                  disabled={!myChanges.length}
                  title={
                    myChanges.length
                      ? `Copy the ${myChanges.length} line${myChanges.length === 1 ? "" : "s"} the registrar needs for this student`
                      : "Nothing to change for this student"
                  }
                  aria-label="Copy this student's registrations to change"
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2 py-1 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc] disabled:cursor-not-allowed disabled:text-[#c8d0da]"
                >
                  <ClipboardList size={13} aria-hidden="true" />
                  {copied || (myChanges.length ? `Copy ${myChanges.length}` : "Nothing to copy")}
                </button>
              </div>
            }
          >
            {/*
              * The exemptions are waited for too. They decide whether a row reads "exempt"
              * or "not registered" in red, and arriving a moment late drew the red first.
              */}
            {catalogue.isLoading || assignments.isLoading || registrations.isLoading || exemptions.isLoading ? (
              <Empty>Reading…</Empty>
            ) : placements.length === 0 && outside.length === 0 ? (
              <Empty>{cohortId ? "In no group yet, and registered in nothing." : "In no cohort, so in no group, and registered in nothing."}</Empty>
            ) : (
              <>
                <p className="mb-2 text-xs text-[#98a2b3]">
                  {counted.agree} registered as placed
                  {counted.onlyOurs ? ` · ${counted.onlyOurs} not registered` : ""}
                  {counted.exempt ? ` · ${counted.exempt} exempt` : ""}
                  {outside.length ? ` · ${outside.length} outside their groups` : ""}
                </p>
                <table className="w-full table-fixed border-collapse text-sm" aria-label="CRNs">
                  <colgroup>
                    <col className="w-[4.5rem]" />
                    <col />
                    <col className="w-[27%]" />
                    <col className="w-[6.75rem]" />
                    <col className="w-[4.75rem]" />
                  </colgroup>
                  {placements.map(({ scope, group, major, crns }) => (
                    <tbody key={scope.id} aria-label={`${scope.code} ${group?.label ?? ""}`}>
                      <tr>
                        <th colSpan={5} scope="rowgroup" className="pb-1 pt-3 text-left font-normal first:pt-0">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="inline-flex items-center rounded-full bg-[#e8edf3] px-2.5 py-0.5 text-xs font-semibold text-[#1f4e79]">
                              {scope.code}
                            </span>
                            <span className="font-semibold text-[#171717]">
                              {group ? subRowLabel(group.label, major?.program ?? "", (group.majors ?? []).length) : "?"}
                            </span>
                            {/* The semester by name; a code this browser cannot name is no help. */}
                            {scope.termId && termName(scope.termId) !== scope.termId ? (
                              <span className="text-xs text-[#98a2b3]">{termName(scope.termId)}</span>
                            ) : null}
                            {/*
                              * A group of a linked set that does not go with their group in the
                              * set it is linked to: Philosophy 1 under TD 2. Said, not fixed — a
                              * few sit there on purpose, and moving them is a decision.
                              */}
                            {group && misfitOf(scope, group) ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#fdf9ee] px-2 py-0.5 text-xs font-semibold text-[#8a6116]">
                                <AlertTriangle size={11} aria-hidden="true" /> {misfitOf(scope, group)}
                              </span>
                            ) : null}
                            {group ? (
                              leaving === scope.id ? (
                                <span className="ml-auto inline-flex items-center gap-2 text-xs">
                                  <span className="text-[#a6292f]">Take them out of {scope.code} {group.label}?</span>
                                  <button
                                    type="button"
                                    disabled={takeOut.isPending}
                                    onClick={() => takeOut.mutate(scope.id)}
                                    className="rounded bg-[#a6292f] px-2 py-0.5 font-semibold text-white disabled:opacity-60"
                                  >
                                    {takeOut.isPending ? "Taking out…" : "Take out"}
                                  </button>
                                  <button type="button" onClick={() => setLeaving("")} className="font-semibold text-[#667085]">
                                    Keep
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Take out of ${scope.code} ${group.label}`}
                                  title={`Take them out of ${scope.code} ${group.label}. Their other groups stay.`}
                                  onClick={() => {
                                    takeOut.reset();
                                    setLeaving(scope.id);
                                  }}
                                  className="ml-auto rounded p-1 text-[#c8d0da] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                                >
                                  <UserMinus size={14} aria-hidden="true" />
                                </button>
                              )
                            ) : null}
                          </span>
                        </th>
                      </tr>
                      {crns.map((cell) => (
                        <CrnRow
                          // A course handed over mid-semester is two CRNs of one course.
                          key={`${cell.courseId}|${cell.crn}`}
                          crn={cell.crn}
                          courseCode={cell.courseCode}
                          courseName={cell.courseName}
                          teacher={cell.crn ? portalTeacher(cell.crn) : ""}
                          state={
                            excused.has(cell.courseId)
                              ? "exempt"
                              : !cell.crn
                                ? "no crn"
                                : registered.has(cell.crn)
                                  ? "registered"
                                  : "not registered"
                          }
                          onOpen={cell.crn && inRegister(cell.crn) ? () => setShowingCrn(inRegister(cell.crn)) : undefined}
                          exempting={exempt.isPending}
                          onExempt={(on) => exempt.mutate({ courseCode: cell.courseCode, on })}
                        />
                      ))}
                    </tbody>
                  ))}
                  {/*
                    * What the portal has them in that no group of theirs gives them. An
                    * elective — sport, a language another department runs — is named as what
                    * it is, since "no group of theirs" is true and reads as an accusation.
                    */}
                  {outside.length ? (
                    <tbody aria-label="Registered outside their groups">
                      <tr>
                        <th colSpan={5} scope="rowgroup" className="pb-1 pt-4 text-left text-xs font-semibold text-[#344054]">
                          Registered outside their groups
                        </th>
                      </tr>
                      {outside.map((line) => {
                        const elective = electiveOf.get(line.crn);
                        return (
                          <CrnRow
                            key={line.crn}
                            crn={line.crn}
                            courseCode={line.courseCode}
                            courseName={line.title}
                            teacher={portalTeacher(line.crn)}
                            state="outside"
                            onOpen={inRegister(line.crn) ? () => setShowingCrn(inRegister(line.crn)) : undefined}
                            outside={
                              elective ? (
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[#e9e3f8] px-2 py-0.5 text-xs font-semibold text-[#4b3b8f]">
                                    <GraduationCap size={11} aria-hidden="true" /> Elective
                                  </span>
                                  {elective.status === "allowed" ? (
                                    <span className="text-xs text-[#667085]">on the list</span>
                                  ) : elective.status === "approved" ? (
                                    <span className="inline-flex items-center gap-1 text-xs text-[#2f6b3d]">
                                      <ShieldCheck size={11} aria-hidden="true" /> approved
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      disabled={approve.isPending}
                                      title={`Record that ${elective.courseCode} is approved for this student`}
                                      onClick={() =>
                                        approve.mutate({ termCode: elective.termCode, courseCode: elective.courseCode, on: true })
                                      }
                                      className="rounded border border-[#cfc4ea] bg-white px-1.5 py-0.5 text-[11px] font-semibold text-[#4b3b8f] hover:bg-[#f6f3fd]"
                                    >
                                      Approve
                                    </button>
                                  )}
                                </span>
                              ) : (
                                <span className="text-xs text-[#a6292f]">no group of theirs</span>
                              )
                            }
                          />
                        );
                      })}
                    </tbody>
                  ) : null}
                </table>
              </>
            )}
            {registrations.error ? <p className="mt-2 text-sm text-[#a6292f]">{(registrations.error as Error).message}</p> : null}
            {takeOut.error ? (
              <p role="alert" className="mt-2 text-xs text-[#a6292f]">
                {(takeOut.error as Error).message}
              </p>
            ) : null}
            {exempt.error ? <p className="mt-2 text-xs text-[#a6292f]">{(exempt.error as Error).message}</p> : null}
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
                    <span className="flex-1">{describeMismatch(warning)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {(approvals.data ?? []).length ? (
              <div className="mt-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">Approved outside the groups</h4>
                <ul className="mt-1 space-y-1" aria-label="Approved outside the groups">
                  {(approvals.data ?? []).map((approval) => (
                    <li key={`${approval.termCode}|${approval.courseCode}`} className="flex items-center gap-2 text-xs text-[#344054]">
                      <ShieldCheck size={12} className="shrink-0 text-[#2f6b3d]" aria-hidden="true" />
                      <span className="font-semibold">{approval.courseCode}</span>
                      <span className="text-[#98a2b3]">
                        {approval.termCode}
                        {approval.approvedByName || approval.approvedBy ? ` · by ${approval.approvedByName || approval.approvedBy}` : ""}
                        {approval.approvedAt ? ` · ${new Date(approval.approvedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                      </span>
                      <button
                        type="button"
                        disabled={approve.isPending}
                        title={`Withdraw the approval of ${approval.courseCode}`}
                        aria-label={`Withdraw the approval of ${approval.courseCode}`}
                        onClick={() => approve.mutate({ termCode: approval.termCode, courseCode: approval.courseCode, on: false })}
                        className="ml-auto rounded p-0.5 text-[#98a2b3] hover:bg-[#f2f4f7] hover:text-[#a6292f]"
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {approve.error ? <p className="mt-2 text-xs text-[#a6292f]">{(approve.error as Error).message}</p> : null}
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
      <Card
        title="History"
        note="On the server: every cohort move, placement, registration change and approval, signed. From this browser's pull history: what changed in the portal's record."
      >
        {entries.length === 0 ? (
          <Empty>{serverHistory.isLoading ? "Reading…" : "No changes recorded."}</Empty>
        ) : (
          <ol className="space-y-2" aria-label="History">
            {entries.map((entry) => (
              <li key={entry.key} className="grid grid-cols-[6.5rem_1fr] gap-x-3 text-sm">
                <span className="tabular-nums text-[#98a2b3]">{new Date(entry.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</span>
                {entry.line ? (
                  <span className={entry.line.kind === "dropped" || entry.line.kind === "removed" ? "text-[#a6292f]" : "text-[#344054]"}>
                    {describeHistory(entry.line)}
                    {entry.line.authorName || entry.line.author ? (
                      <span className="text-[#98a2b3]"> · by {entry.line.authorName || entry.line.author}</span>
                    ) : (
                      <span className="text-[#98a2b3]"> · the portal&apos;s pull</span>
                    )}
                  </span>
                ) : entry.pull?.kind === "arrived" ? (
                  <span className="text-[#2f6b3d]">First seen in a pull</span>
                ) : entry.pull?.kind === "departed" ? (
                  <span className="text-[#a6292f]">No longer returned by the portal</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {(entry.pull?.changes ?? []).map((change) => (
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

function Card({
  title,
  note,
  className = "",
  beside,
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  /** A control belonging to this card, at its top right beside the heading. */
  beside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-lg border border-[#e4e8ef] bg-white px-4 py-3 ${className}`}>
      <div className="flex items-start gap-3">
        <h3 className="flex-1 text-sm font-semibold text-[#171717]">{title}</h3>
        {beside ? <div className="shrink-0">{beside}</div> : null}
      </div>
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

/**
 * One CRN of the student's: the section, its course, who teaches it, and what the portal says.
 *
 * Who teaches it is the portal's word, the one students and the registrar go by.
 *
 * Exempting is on the row because the row is where the question arises — "they are not
 * registered in PHYS-125 TD" — and it is a word on a button rather than a bare "exempt?",
 * which read as a status. It is shown when the row is pointed at, and always on a touch
 * screen, where nothing is pointed at; an exempt row says so and offers the way back.
 */
function CrnRow({
  crn,
  courseCode,
  courseName,
  teacher,
  state,
  onOpen,
  exempting = false,
  onExempt,
  outside,
}: {
  crn: string;
  courseCode: string;
  courseName?: string;
  /** Who teaches it, as the portal has it. */
  teacher: string;
  state: "registered" | "not registered" | "exempt" | "no crn" | "outside";
  onOpen?: () => void;
  exempting?: boolean;
  onExempt?: (on: boolean) => void;
  /** For a row outside their groups: what to say in the portal column instead. */
  outside?: ReactNode;
}) {
  const off = state === "exempt";
  return (
    <tr className={`group border-t border-[#f2f4f7] align-top ${off ? "text-[#98a2b3]" : ""}`}>
      {/* A little in from the set's band, so each group's CRNs read as its own. */}
      <td className="py-1.5 pl-3 pr-2 tabular-nums">
        {crn && onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            title={`Open CRN ${crn}`}
            className={`text-[#1f4e79] underline-offset-2 hover:underline ${off ? "line-through opacity-60" : ""}`}
          >
            {crn}
          </button>
        ) : (
          <span className={off ? "line-through" : "text-[#344054]"}>{crn || "—"}</span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        <span className={`whitespace-nowrap ${off ? "" : "font-medium text-[#344054]"}`}>{courseCode}</span>
        {courseName ? <span className="block truncate text-xs text-[#98a2b3]" title={courseName}>{courseName}</span> : null}
      </td>
      <td className="py-1.5 pr-2 text-xs">
        <span className={off ? "" : "text-[#344054]"}>{teacher || "—"}</span>
      </td>
      <td className="py-1.5 pr-2 text-xs">
        {outside ??
          (state === "registered" ? (
            <span className="inline-flex items-center gap-1 text-[#2f6b3d]">
              <Check size={13} aria-hidden="true" /> registered
            </span>
          ) : off ? (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-[#f2f4f7] px-2 py-0.5 font-semibold text-[#667085]"
              title={`They do not take ${courseCode}, so the portal is right not to have them in it.`}
            >
              <MinusCircle size={12} aria-hidden="true" /> exempt
            </span>
          ) : state === "no crn" ? (
            <span className="text-[#98a2b3]">no CRN yet</span>
          ) : (
            <span className="text-[#a6292f]">not registered</span>
          ))}
      </td>
      <td className="py-1.5 text-right">
        {onExempt ? (
          off ? (
            <button
              type="button"
              disabled={exempting}
              onClick={() => onExempt(false)}
              title={`Put them back in ${courseCode}`}
              className="rounded px-1.5 py-0.5 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
            >
              Undo
            </button>
          ) : (
            <button
              type="button"
              disabled={exempting}
              onClick={() => onExempt(true)}
              aria-label={`Exempt from ${courseCode}`}
              title={`Not taking ${courseCode} — its lecture, tutorial and practical. The portal is then not expected to have them in it.`}
              className="inline-flex items-center gap-1 rounded border border-[#d9dee7] bg-white px-1.5 py-0.5 text-xs font-semibold text-[#667085] hover:border-[#b7bec8] hover:text-[#344054] focus:opacity-100 disabled:opacity-50 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            >
              <MinusCircle size={12} aria-hidden="true" /> Exempt
            </button>
          )
        ) : null}
      </td>
    </tr>
  );
}
