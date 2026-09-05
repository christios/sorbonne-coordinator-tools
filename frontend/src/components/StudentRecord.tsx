import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRightCircle, Check, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Modal } from "@/components/Modal";
import {
  STATUS_FIELD,
  STATUS_OPTIONS,
  arrivalsFor,
  describeWarning,
  labelOf,
  warningsForCohort,
  type Change,
  type Options,
} from "@/services/discrepancies";
import { type Mismatch, describeMismatch, fetchRegistrationCheck, fetchRegistrations, fetchTermLinks } from "@/services/portalLists";
import { allChanges, historyFor, type PullHistory } from "@/services/pullHistory";
import type { StudentRow } from "@/services/rosterView";
import { fetchSchema } from "@/services/scenRosters";
import { fetchAssignments, fetchCatalogue, fetchDiscrepancyRules, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

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
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, enabled: open, retry: false });
  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, ""],
    queryFn: () => fetchCatalogue(cohortId),
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
      ? warningsForCohort({ cohort, students: placed, rules: rules.data, current, changes: changesOf, options }).filter(
          (warning) => warning.kind !== "no_baseline",
        )
      : [];
    // The other direction: a cohort whose majors they moved into, that they are not in.
    const arrivals = cohorts
      .filter((candidate) => candidate.id !== row.cohortId)
      .flatMap((candidate) =>
        arrivalsFor({ cohort: candidate, students: placed, current, changes: changesOf, options }).map((arrival) => ({ ...arrival, cohort: candidate })),
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
        crns: scope.courses.map((course) => ({ courseCode: course.code, crn: group?.crns[course.id]?.crn ?? "" })),
      };
    });
  const registered = new Set((registrations.data ?? []).filter((r) => r.status === "in_portal").map((r) => r.crn));
  const mismatches: Mismatch[] = (check.data ?? []).filter((mismatch) => mismatch.studentId === row.studentId);
  const entries = historyFor(history, row.studentId);
  const portal = Object.fromEntries(Object.entries(row.portal).filter(([, value]) => String(value ?? "").trim()));
  const rest = Object.keys(portal)
    .filter((key) => !NAMED.has(key))
    .sort();
  const noLink = links.data && Object.keys(links.data).length === 0;

  return (
    <Modal
      open={open}
      size="wide"
      title={row.name || row.studentId}
      onClose={onClose}
      header={
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono text-[#667085]">{row.studentId}</span>
          {row.status === "not_in_portal" ? <Pill tone="bad">Not in portal</Pill> : <Pill tone="good">In portal</Pill>}
          {cohort ? (
            <Pill tone="accent">{cohort.name}</Pill>
          ) : (
            <Pill tone="muted">No cohort</Pill>
          )}
          {row.yearLevel ? <Pill tone="muted">{row.yearLevel}</Pill> : null}
          {row.major ? <Pill tone="muted">{row.major}</Pill> : null}
          {row.email ? (
            <a href={`mailto:${row.email}`} className="text-[#1f4e79] underline">
              {row.email}
            </a>
          ) : null}
        </div>
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
                Major changed {arrival.from ? `from ${arrival.from} ` : ""}to {arrival.to} on{" "}
                {new Date(arrival.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}.{" "}
                {arrival.cohort.name} expects {arrival.cohort.majors.join(" or ")}, and they are {cohort ? `in ${cohort.name}` : "in no cohort"}.
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------------------------------------ the portal */}
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

        <div className="space-y-5">
          {/* ------------------------------------------------------------ groups */}
          <Card title="Groups" note={cohort ? `Where ${cohort.name} put them, and the CRNs each group stands for.` : "Where the department put them."}>
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
                      {crns.map((cell) => (
                        <li key={cell.courseCode} className="inline-flex items-center gap-1 tabular-nums">
                          <span className="text-[#344054]">{cell.courseCode}</span> {cell.crn || "—"}
                          {cell.crn && registered.has(cell.crn) ? (
                            <Check size={12} className="text-[#2f6b3d]" aria-label="registered" />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ------------------------------------------------------ registrations */}
          <Card title="Registered in the portal" note="What the registrar actually registered, per term.">
            {registrations.isLoading ? (
              <Empty>Reading…</Empty>
            ) : registrations.error ? (
              <p className="text-sm text-[#a6292f]">{(registrations.error as Error).message}</p>
            ) : (registrations.data ?? []).length === 0 ? (
              <Empty>No registrations pulled for this student yet. Sync a Registrations filter that covers them.</Empty>
            ) : (
              <table className="w-full text-left text-sm" aria-label="Registrations">
                <thead className="text-[11px] uppercase tracking-wide text-[#98a2b3]">
                  <tr>
                    <th className="py-1 pr-3 font-semibold">Term</th>
                    <th className="py-1 pr-3 font-semibold">CRN</th>
                    <th className="py-1 pr-3 font-semibold">Course</th>
                    <th className="py-1 font-semibold">Teacher</th>
                  </tr>
                </thead>
                <tbody>
                  {(registrations.data ?? []).map((registration) => (
                    <tr
                      key={`${registration.termCode}|${registration.crn}`}
                      className={`border-t border-[#eef1f5] ${registration.status === "not_in_portal" ? "text-[#98a2b3] line-through" : ""}`}
                    >
                      <td className="py-1.5 pr-3 tabular-nums text-[#667085]">{registration.termCode}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{registration.crn}</td>
                      <td className="py-1.5 pr-3">
                        <span className="font-semibold text-[#171717]">{registration.courseCode}</span>
                        {registration.title ? <span className="block text-xs text-[#98a2b3]">{registration.title}</span> : null}
                      </td>
                      <td className="py-1.5 text-[#667085]">{registration.teacherName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {mismatches.length ? (
              <ul className="mt-3 space-y-1.5" aria-label="Differences">
                {mismatches.map((mismatch) => (
                  <li
                    key={`${mismatch.termCode}|${mismatch.courseCode}|${mismatch.kind}`}
                    className="flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-3 py-2 text-sm text-[#8a6116]"
                  >
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{describeMismatch(mismatch)}</span>
                  </li>
                ))}
              </ul>
            ) : cohortId && check.data && (registrations.data ?? []).length ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#2f6b3d]">
                <Check size={14} aria-hidden="true" /> Registrations agree with the groups.
              </p>
            ) : null}
            {noLink && cohortId ? (
              <p className="mt-3 text-xs text-[#98a2b3]">
                No semester is linked to a portal term yet, so nothing is compared. Set the portal term on the Semesters page.
              </p>
            ) : null}
          </Card>
        </div>
      </div>

      {/* ---------------------------------------------------------------- history */}
      <Card className="mt-5" title="History" note="What changed in the portal's record, from this browser's pull history.">
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
