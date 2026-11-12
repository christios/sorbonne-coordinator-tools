import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { SelectMenu } from "@/components/SelectMenu";
import { COURSE_PROGRAMS_QUERY } from "@/components/useCoursePrograms";
import {
  NO_PROGRAMME,
  codePrefix,
  fetchCoursePrograms,
  programmeFromCode,
  programmeName,
  putCourseProgramme,
  setOfficialName,
  setProgrammePrefixes,
  type CourseProgramme,
  type CoursePrograms,
} from "@/services/coursePrograms";
import { fetchActiveCourses } from "@/services/portalLists";
import { removeProgrammeCode, setProgrammeCode } from "@/services/programmeCodes";
import { fetchCourseCards } from "@/services/studentDatabase";

const field = "rounded-md border border-[#cbd5e1] bg-white px-2.5 py-1.5 text-sm placeholder:text-[#667085]";
const button = "rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The department's programmes, in one place, for everybody at once.
 *
 * They are the students' — the ones the cohorts and groups are written in — so none is made
 * here. Each says, for every page: its official name, which the registrar's "Mathematics"
 * is not; the other codes its students are written under after a recode (MATS means MATH),
 * which every placement and check reads; and the course codes that count as it, which every
 * Program filter reads. Every course the department plans or lists is below, so one whose
 * code says nothing useful can be put where it belongs. An administrator's to change.
 */
export function ProgrammesPanel({ canChange }: { canChange: boolean }) {
  const held = useQuery({ queryKey: COURSE_PROGRAMS_QUERY, queryFn: fetchCoursePrograms, retry: false });
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const active = useQuery({ queryKey: ["active-courses"], queryFn: () => fetchActiveCourses() });
  const [query, setQuery] = useState("");

  // Every course the department plans or lists, once by code.
  const courses = useMemo(() => {
    const named = new Map<string, string>();
    for (const catalogue of catalogues.data ?? []) {
      for (const scope of catalogue.scopes) {
        for (const course of scope.courses) {
          const code = course.code.trim().toUpperCase();
          if (code && !named.get(code)) named.set(code, course.name.trim());
        }
      }
    }
    for (const course of active.data ?? []) {
      const code = course.courseCode.trim().toUpperCase();
      if (code && !named.get(code)) named.set(code, course.title.trim());
    }
    return [...named.entries()].map(([code, name]) => ({ code, name })).sort((left, right) => left.code.localeCompare(right.code));
  }, [catalogues.data, active.data]);

  if (held.isLoading) return <p className="text-sm text-[#667085]">Reading the programmes…</p>;
  if (held.error) return <p role="alert" className="text-sm text-[#a6292f]">{(held.error as Error).message}</p>;
  const setup = held.data ?? { programmes: [], courses: {} };
  if (!setup.programmes.length) {
    return (
      <p className="rounded-md border border-dashed border-[#cbd5e1] px-4 py-5 text-center text-sm text-[#667085]">
        No programme yet. The programmes are the ones your cohorts and groups are written in; they appear here once a
        cohort has its programmes.
      </p>
    );
  }
  // The prefixes the department's courses use, with how many courses each covers.
  const used = new Map<string, number>();
  for (const course of courses) {
    const prefix = codePrefix(course.code);
    if (prefix) used.set(prefix, (used.get(prefix) ?? 0) + 1);
  }
  const words = query.trim().toLowerCase();
  const shown = words ? courses.filter((course) => `${course.code} ${course.name}`.toLowerCase().includes(words)) : courses;

  return (
    <div className="space-y-6">
      <ul aria-label="Programmes" className="space-y-3">
        {setup.programmes.map((programme) => (
          <ProgrammeCard key={programme.code} programme={programme} setup={setup} used={used} canChange={canChange} />
        ))}
      </ul>
      {canChange ? null : <p className="text-xs text-[#667085]">Only an administrator can change the programmes.</p>}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-[#344054]">Each course</h4>
          <label className="relative block w-full sm:w-64">
            <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#475467]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Search courses"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search a course"
              className={`${field} w-full pl-8`}
            />
          </label>
        </div>
        <p className="mb-2 text-sm text-[#475467]">A course goes by its code until it is put somewhere here.</p>
        <div className="max-h-[min(60vh,36rem)] overflow-auto rounded-lg border border-[#d9dee7] bg-white">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr className="text-xs text-[#344054]">
                <th className="sticky top-0 z-10 border-b-2 border-[#b8c2cf] bg-[#eef2f7] px-3 py-2 text-left font-semibold">Course</th>
                <th className="sticky top-0 z-10 border-b-2 border-[#b8c2cf] bg-[#eef2f7] px-3 py-2 text-left font-semibold">Programme</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((course) => (
                <CourseLine key={course.code} course={course} setup={setup} canChange={canChange} />
              ))}
            </tbody>
          </table>
          {!shown.length ? <p className="px-3 py-4 text-sm text-[#667085]">No course matches.</p> : null}
        </div>
      </section>
    </div>
  );
}

/** Whatever the department's programmes now are, everywhere they are read. */
function useSaved() {
  const client = useQueryClient();
  return (next: CoursePrograms) => client.setQueryData(COURSE_PROGRAMS_QUERY, next);
}

function Failure({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="mt-1 text-xs text-[#a6292f]">
      {(error as Error).message}
    </p>
  ) : null;
}

/** A labelled line of a programme's card: the label on the left from `sm` up, above it on a phone. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <span className="text-xs font-semibold text-[#475467]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Chip({ children, onRemove, removeLabel }: { children: ReactNode; onRemove?: () => void; removeLabel?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#e8edf3] py-0.5 pl-2 pr-1 text-xs font-semibold text-[#1f4e79]">
      {children}
      {onRemove ? (
        <button type="button" aria-label={removeLabel} onClick={onRemove} className="rounded-full p-0.5 hover:bg-[#d3dde8] hover:text-[#a6292f]">
          <X size={12} aria-hidden="true" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

/** A programme: its names, the codes that mean it, and the course codes that count as it. */
function ProgrammeCard({
  programme,
  setup,
  used,
  canChange,
}: {
  programme: CourseProgramme;
  setup: CoursePrograms;
  used: Map<string, number>;
  canChange: boolean;
}) {
  const client = useQueryClient();
  const saved = useSaved();
  const [official, setOfficial] = useState(programme.officialName);
  const [alias, setAlias] = useState("");
  const name = useMutation({ mutationFn: () => setOfficialName(programme.code, official.trim()), onSuccess: saved });
  const prefixes = useMutation({ mutationFn: (next: string[]) => setProgrammePrefixes(programme.code, next), onSuccess: saved });
  // A code that means this programme changes who is placed where, and which programmes there are.
  const codesChanged = () => {
    void client.invalidateQueries({ queryKey: ["programme-codes"] });
    void client.invalidateQueries({ queryKey: COURSE_PROGRAMS_QUERY });
  };
  const addAlias = useMutation({
    mutationFn: () => setProgrammeCode(alias.trim(), programme.code),
    onSuccess: () => {
      setAlias("");
      codesChanged();
    },
  });
  const removeAlias = useMutation({ mutationFn: removeProgrammeCode, onSuccess: codesChanged });

  // Course-code prefixes on offer: those the courses use, never one another programme has.
  const elsewhere = new Set(setup.programmes.filter((other) => other.code !== programme.code).flatMap((other) => other.prefixes));
  const offered = [...new Set([...used.keys(), ...programme.prefixes])].filter((prefix) => !elsewhere.has(prefix)).sort();
  const covered = (prefix: string) => {
    const count = used.get(prefix) ?? 0;
    return `${count} course${count === 1 ? "" : "s"}`;
  };

  return (
    <li className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <h4 className="mb-3 flex flex-wrap items-baseline gap-2">
        <span className="rounded-md bg-[#eef2f7] px-1.5 py-0.5 font-mono text-xs font-semibold text-[#344054]">{programme.code}</span>
        <span className="text-sm font-semibold text-[#171717]">{programme.name}</span>
        {programme.officialName && programme.officialName !== programme.name ? (
          <span className="text-xs text-[#667085]">{programme.officialName}</span>
        ) : null}
      </h4>
      <div className="space-y-3 text-sm">
        <Line label="Official name">
          {canChange ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                name.mutate();
              }}
            >
              <input
                aria-label={`Official name of ${programme.code}`}
                value={official}
                onChange={(event) => setOfficial(event.target.value)}
                placeholder={`e.g. Bachelor of Science in ${programme.registrarName || programme.code}`}
                className={`${field} min-w-0 flex-1`}
              />
              <button type="submit" disabled={official.trim() === programme.officialName || name.isPending} className={button}>
                Save
              </button>
            </form>
          ) : (
            <span className={programme.officialName ? "text-[#171717]" : "text-[#667085]"}>{programme.officialName || "Not given yet"}</span>
          )}
          <Failure error={name.error} />
        </Line>

        <Line label="Also written as">
          <div className="flex flex-wrap items-center gap-1.5">
            {programme.aliases.map((code) => (
              <Chip
                key={code}
                onRemove={canChange ? () => removeAlias.mutate(code) : undefined}
                removeLabel={`Stop treating ${code} as ${programme.code}`}
              >
                {code}
              </Chip>
            ))}
            {!programme.aliases.length && !canChange ? <span className="text-[#667085]">No other code</span> : null}
            {canChange ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (alias.trim()) addAlias.mutate();
                }}
              >
                <input
                  aria-label={`Another code for ${programme.code}`}
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                  placeholder="Another code"
                  className={`${field} w-32 uppercase placeholder:normal-case`}
                />
                <button type="submit" disabled={!alias.trim() || addAlias.isPending} className={button}>
                  Add
                </button>
              </form>
            ) : null}
          </div>
          <Failure error={addAlias.error ?? removeAlias.error} />
        </Line>

        <Line label="Course codes">
          {canChange ? (
            <SelectMenu
              label={`Course codes under ${programme.code}`}
              multiple
              itemNoun="code"
              align="start"
              disabled={prefixes.isPending}
              value={programme.prefixes.join("\n")}
              onChange={(next) => prefixes.mutate(next.split("\n").filter(Boolean))}
              placeholder="Choose the course codes"
              options={offered.map((prefix) => ({ value: prefix, label: prefix, badge: covered(prefix), badgeTone: "muted" as const }))}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {programme.prefixes.length ? (
                programme.prefixes.map((prefix) => <Chip key={prefix}>{prefix}</Chip>)
              ) : (
                <span className="text-[#667085]">No course code yet</span>
              )}
            </div>
          )}
          <Failure error={prefixes.error} />
        </Line>
      </div>
    </li>
  );
}

/** One course: what its code says, and where the department puts it, saved as it is chosen. */
function CourseLine({ course, setup, canChange }: { course: { code: string; name: string }; setup: CoursePrograms; canChange: boolean }) {
  const saved = useSaved();
  const put = useMutation({ mutationFn: (programme: string) => putCourseProgramme(course.code, programme), onSuccess: saved });
  const said = setup.courses[course.code] ?? "";
  // Put in a programme the department no longer has: it goes by its code again.
  const value = said === NO_PROGRAMME || setup.programmes.some((programme) => programme.code === said) ? said : "";
  const byCode = programmeName(programmeFromCode(course.code, setup), setup);
  const options = [
    { value: "", label: `As its code says (${byCode})` },
    ...setup.programmes.map((programme) => ({ value: programme.code, label: programme.name })),
    { value: NO_PROGRAMME, label: "No programme" },
  ];

  return (
    <tr className="hover:bg-[#f5f8fc]">
      <td className="border-b border-[#eef1f5] px-3 py-1.5 align-middle">
        <span className="font-medium text-[#171717]">{course.name || course.code}</span>
        <span className="ml-2 text-xs text-[#475467]">{course.code}</span>
      </td>
      <td className="w-60 border-b border-[#eef1f5] px-3 py-1.5 align-middle">
        {canChange ? (
          <>
            <SelectMenu
              label={`Programme of ${course.code}`}
              size="small"
              value={value}
              disabled={put.isPending}
              onChange={(next) => put.mutate(next)}
              options={options}
            />
            <Failure error={put.error} />
          </>
        ) : (
          <span className="text-[#344054]">{options.find((option) => option.value === value)?.label}</span>
        )}
      </td>
    </tr>
  );
}
