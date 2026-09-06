import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Layers, Plus, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { useRemembered } from "@/components/useRemembered";
import { WarningBanner, WarningRows, type WarningKind } from "@/components/WarningBanner";
import { fetchActiveCourses } from "@/services/portalLists";
import { COHORT, SCHEMA_TERM } from "@/services/remembered";
import { labelsFrom, readSets, totalsOf, type SetReading } from "@/services/groupSchema";
import {
  addCourse,
  addGroup,
  addScope,
  deleteCourse,
  deleteGroup,
  deleteScope,
  fetchCatalogue,
  moveScope,
  updateGroup,
  updateScope,
  type CatalogueGroup,
  type CatalogueScope,
  type Cohort,
  type ScopeKind,
} from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

const KIND_WORDS: Record<ScopeKind, string> = {
  shared: "Its own groups — a student is in one of them",
  nested: "Inside another set — its groups split that set's groups",
};

const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";
const field = "mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm";
const caption = "block text-xs font-semibold uppercase tracking-wide text-[#667085]";

function SetLine({
  reading,
  chosen,
  onChoose,
  onMove,
}: {
  reading: SetReading;
  chosen: boolean;
  onChoose: () => void;
  /**
   * Up or down the order — which is the order Groups & CRNs reads them in.
   *
   * A cohort whose tutorials came before its lectures was a fact with no way to change it:
   * the catalogue has always been read in this order and every page downstream takes its
   * word for it, so the only thing missing was somewhere to say so.
   */
  onMove?: (by: -1 | 1) => void;
}) {
  const broken = reading.trouble.some((why) => why === "no parent set" || why === "groups adrift");
  const dot = broken ? "bg-[#a6292f]" : reading.trouble.length ? "bg-[#d99b1c]" : "bg-[#2e7d55]";
  return (
    <div className={`group relative flex items-start rounded-md ${chosen ? "bg-[#e8edf3]" : "hover:bg-[#f6f8fb]"}`}>
    <button
      type="button"
      onClick={onChoose}
      aria-current={chosen ? "true" : undefined}
      className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md px-2.5 py-2 text-left"
    >
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" title={reading.trouble.join(", ") || "nothing missing"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`truncate text-sm font-semibold ${chosen ? "text-[#1f4e79]" : "text-[#344054]"}`}>{reading.scope.code}</span>
          {reading.scope.name && reading.scope.name !== reading.scope.code ? (
            <span className="truncate text-xs text-[#98a2b3]">{reading.scope.name}</span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs tabular-nums text-[#98a2b3]">
          {reading.groups} group{reading.groups === 1 ? "" : "s"} · {reading.courses} course{reading.courses === 1 ? "" : "s"}
          {reading.placed ? ` · ${reading.placed} placed` : ""}
        </span>
      </span>
    </button>
    {onMove ? (
      <span className="absolute right-1 top-1 flex flex-col opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        {([-1, 1] as const).map((by) => (
          <button
            key={by}
            type="button"
            aria-label={`Move ${reading.scope.code} ${by < 0 ? "up" : "down"}`}
            title={`Move ${reading.scope.code} ${by < 0 ? "up" : "down"} — this is the order Groups & CRNs reads them in`}
            onClick={() => onMove(by)}
            className="rounded p-0.5 text-[#98a2b3] hover:bg-white hover:text-[#1f4e79]"
          >
            {by < 0 ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
          </button>
        ))}
      </span>
    ) : null}
    </div>
  );
}

/**
 * The shape of a semester, before any CRN is in it.
 *
 * A cohort is split into sets — the lectures, the tutorials, the practicals, the
 * languages — each carrying some courses and holding some groups. That schema is what
 * Groups & CRNs then fills, what the fill planner places students into, and what Capacity
 * counts. It used to be a dialog five rems tall that a stray click dismissed; it is the
 * most consequential thing on these pages, so it is a page.
 *
 * Everything here saves as it is done. What cannot be undone — removing a set, or a group
 * somebody is sitting in — asks for the name to be typed first.
 */
export function GroupSchema({
  cohorts,
  onOpenGroups,
}: {
  cohorts: Cohort[];
  onOpenGroups?: () => void;
}) {
  const client = useQueryClient();
  // Both remembered by this browser: the cohort with every other cohort picker, the
  // semester on its own, since this is the only page that asks for one.
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);
  const [cohortId, setCohortId] = useRemembered(COHORT);
  const [chosenId, setChosenId] = useState("");
  // The two panes fill the room under the totals, and each scrolls inside itself.

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const active = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, termId, "with-shared"],
    queryFn: () => fetchCatalogue(cohortId, termId, true),
    enabled: Boolean(cohortId && termId),
  });

  /*
   * The order the sets are read in, which is the order every page downstream draws them.
   *
   * Sets a cohort shares with the department are not moved from here: they are somebody
   * else's row, and their place is theirs to decide.
   */
  const reorder = useMutation({
    mutationFn: ({ scopeId, by }: { scopeId: string; by: -1 | 1 }) => moveScope(scopeId, by),
    onSuccess: () => refresh(),
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["catalogue"] });
    client.invalidateQueries({ queryKey: ["course-cards"] });
    client.invalidateQueries({ queryKey: ["publication"] });
    client.invalidateQueries({ queryKey: ["cohorts"] });
  };

  const scopes = useMemo(() => catalogue.data?.scopes ?? [], [catalogue.data]);
  const readings = useMemo(() => readSets(scopes, cohortId), [scopes, cohortId]);
  const totals = totalsOf(readings);
  const chosen = readings.find((reading) => reading.scope.id === chosenId) ?? readings[0] ?? null;

  const warnings: WarningKind[] = useMemo(() => {
    const kinds: { id: string; why: string; severity: "serious" | "caution"; label: (n: number) => string }[] = [
      { id: "parent", why: "no parent set", severity: "serious", label: (n) => `${n} nested set${n === 1 ? "" : "s"} sit inside nothing` },
      { id: "adrift", why: "groups adrift", severity: "serious", label: (n) => `${n} set${n === 1 ? " has" : "s have"} groups nobody can be placed into` },
      { id: "course", why: "no course", severity: "caution", label: (n) => `${n} set${n === 1 ? " carries" : "s carry"} no course` },
      { id: "group", why: "no group", severity: "caution", label: (n) => `${n} set${n === 1 ? " has" : "s have"} no group` },
    ];
    return kinds
      .map((kind) => {
        const hit = readings.filter((reading) => reading.trouble.includes(kind.why as SetReading["trouble"][number]));
        if (!hit.length) return null;
        return {
          id: kind.id,
          severity: kind.severity,
          label: kind.label(hit.length),
          detail: (
            <WarningRows>
              {hit.map((reading) => (
                <li key={reading.scope.id} className="flex items-baseline gap-3 px-4 py-2">
                  <button type="button" onClick={() => setChosenId(reading.scope.id)} className="font-semibold text-[#1f4e79] underline-offset-2 hover:underline">
                    {reading.scope.code}
                  </button>
                  <span className="text-[#667085]">{reading.scope.name || "no name"}</span>
                </li>
              ))}
            </WarningRows>
          ),
        };
      })
      .filter(Boolean) as WarningKind[];
  }, [readings]);

  if (!terms.isLoading && !(terms.data ?? []).length) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        No semester on the Student Hub yet. A group set belongs to one, so make a semester first on the Semesters page.
      </p>
    );
  }

  return (
    <section className="flex flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {/* The semester first: a set belongs to one, and the cohort means nothing until it is settled. */}
        <LabelledPicker label="Semester" hint="a set belongs to one">
          <SelectMenu
            label="Semester"
            value={termId}
            onChange={setTermId}
            placeholder="Which semester…"
            options={(terms.data ?? []).map((term) => ({ value: term.id, label: term.name }))}
          />
        </LabelledPicker>
        <LabelledPicker label="Cohort">
          <SelectMenu
            label="Cohort"
            value={cohortId}
            onChange={setCohortId}
            placeholder="Which cohort…"
            options={cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name, year: cohort.term }))}
          />
        </LabelledPicker>
        {onOpenGroups ? (
          <button type="button" onClick={onOpenGroups} className="ml-auto inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline">
            Fill it in on Groups &amp; CRNs <ArrowRight size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {!cohortId || !termId ? (
        <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
          Choose a semester and a cohort, and its sets appear here.
        </p>
      ) : catalogue.isLoading ? (
        <ScreenLoading label="Reading the schema…" />
      ) : (
        <div className="flex flex-col lg:min-h-0 lg:flex-1">
          <p className="mb-3 text-xs tabular-nums text-[#98a2b3]">
            {totals.sets} set{totals.sets === 1 ? "" : "s"} · {totals.groups} group{totals.groups === 1 ? "" : "s"} ·{" "}
            {totals.courses} course{totals.courses === 1 ? "" : "s"} · {totals.placed} student placement
            {totals.placed === 1 ? "" : "s"}
          </p>

          <WarningBanner title="Needs attention" kinds={warnings} />

          <div className="grid items-stretch gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[19rem_1fr] lg:overflow-hidden lg:[grid-template-rows:minmax(0,1fr)]">
            <nav aria-label="Group sets" className="relative rounded-lg border border-[#d9dee7] bg-white p-1.5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-none">
              {readings.filter((reading) => !reading.shared).map((reading) => (
                <SetLine
                  key={reading.scope.id}
                  reading={reading}
                  chosen={reading.scope.id === chosen?.scope.id}
                  onChoose={() => setChosenId(reading.scope.id)}
                  onMove={(by) => reorder.mutate({ scopeId: reading.scope.id, by })}
                />
              ))}
              {readings.some((reading) => reading.shared) ? (
                <>
                  <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">Across cohorts</p>
                  {readings.filter((reading) => reading.shared).map((reading) => (
                    <SetLine key={reading.scope.id} reading={reading} chosen={reading.scope.id === chosen?.scope.id} onChoose={() => setChosenId(reading.scope.id)} />
                  ))}
                </>
              ) : null}
              <NewSet cohortId={cohortId} termId={termId} scopes={scopes} onMade={(id) => { setChosenId(id); refresh(); }} />
            </nav>

            {chosen ? (
              <div className="relative lg:min-h-0 lg:overflow-y-auto lg:overscroll-none">
              <SetEditor
                key={chosen.scope.id}
                reading={chosen}
                scopes={scopes}
                activeCourses={(active.data ?? []).map((course) => ({ code: course.courseCode, title: course.title }))}
                onChanged={refresh}
                onRemoved={() => {
                  setChosenId("");
                  refresh();
                }}
              />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-10 text-center text-sm text-[#667085]">
                No sets in this semester yet. A set is one way the cohort is split — the lectures, the tutorials, the
                practicals — and its groups are the classes inside it.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Making a set: the code is all that is needed, and the rest is edited once it exists. */
function NewSet({
  cohortId,
  termId,
  scopes,
  onMade,
}: {
  cohortId: string;
  termId: string;
  scopes: CatalogueScope[];
  onMade: (scopeId: string) => void;
}) {
  const [code, setCode] = useState("");
  // Uniqueness is per cohort and semester, so another cohort's shared set is no clash.
  const taken = scopes
    .filter((scope) => (scope.cohortId ?? cohortId) === cohortId)
    .some((scope) => scope.code.trim().toLowerCase() === code.trim().toLowerCase());

  const make = useMutation({
    mutationFn: () => addScope(cohortId, { code: code.trim(), termId }),
    onSuccess: (made) => {
      setCode("");
      onMade(made.id);
    },
  });

  return (
    <form
      className="mt-2 border-t border-[#eef1f5] px-1 pt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim() && !taken) make.mutate();
      }}
    >
      <label className="sr-only" htmlFor="new-set-code">New set</label>
      <div className="flex gap-1.5">
        <input
          id="new-set-code"
          aria-label="New set"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="TD, CM, TP…"
          className="min-w-0 flex-1 rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={!code.trim() || taken || make.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-[#1f4e79] px-2.5 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
        >
          <Plus size={14} aria-hidden="true" /> Set
        </button>
      </div>
      {taken ? <p className="mt-1 text-[11px] text-[#a6292f]">This cohort already has a set called {code.trim()}.</p> : null}
      {make.error ? <p role="alert" className="mt-1 text-[11px] text-[#a6292f]">{(make.error as Error).message}</p> : null}
    </form>
  );
}

/** One set in full: what it is, what it carries, and the groups inside it. */
function SetEditor({
  reading,
  scopes,
  activeCourses,
  onChanged,
  onRemoved,
}: {
  reading: SetReading;
  scopes: CatalogueScope[];
  activeCourses: { code: string; title: string }[];
  onChanged: () => void;
  onRemoved: () => void;
}) {
  const scope = reading.scope;
  const [code, setCode] = useState(scope.code);
  const [name, setName] = useState(scope.name);
  const [kind, setKind] = useState<ScopeKind>(scope.kind);
  const [parentScopeId, setParentScopeId] = useState(scope.parentScopeId);
  const [openToAll, setOpenToAll] = useState(scope.openToAll);
  const [newCourse, setNewCourse] = useState("");
  const [newGroups, setNewGroups] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removingGroup, setRemovingGroup] = useState<CatalogueGroup | null>(null);

  const save = useMutation({
    mutationFn: (next: Partial<{ code: string; name: string; kind: ScopeKind; parentScopeId: string; openToAll: boolean }>) =>
      updateScope(scope.id, {
        code: next.code ?? code,
        name: next.name ?? name,
        note: scope.note,
        kind: next.kind ?? kind,
        parentScopeId: next.kind === "shared" ? "" : (next.parentScopeId ?? parentScopeId),
        openToAll: next.openToAll ?? openToAll,
      }),
    onSuccess: onChanged,
  });

  const addOne = useMutation({
    mutationFn: (courseCode: string) => addCourse(scope.id, { code: courseCode }),
    onSuccess: () => {
      setNewCourse("");
      onChanged();
    },
  });
  const dropCourse = useMutation({ mutationFn: deleteCourse, onSuccess: onChanged });
  const makeGroups = useMutation({
    mutationFn: async (text: string) => {
      for (const label of labelsFrom(text)) await addGroup(scope.id, { label });
    },
    onSuccess: () => {
      setNewGroups("");
      onChanged();
    },
  });
  const dropGroup = useMutation({ mutationFn: deleteGroup, onSuccess: onChanged });
  const remove = useMutation({ mutationFn: () => deleteScope(scope.id), onSuccess: onRemoved });

  const parents = scopes.filter((candidate) => candidate.id !== scope.id && candidate.kind !== "nested");
  const parentGroups = scopes.find((candidate) => candidate.id === parentScopeId)?.groups ?? [];
  const error = save.error ?? addOne.error ?? makeGroups.error ?? remove.error;

  return (
    <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white">
      <header className="border-b border-[#eef1f5] px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h3 className="text-lg font-semibold text-[#1f4e79]">{scope.code}</h3>
          {scope.name && scope.name !== scope.code ? <p className="text-[#344054]">{scope.name}</p> : null}
          {reading.shared ? <span className={`${chip} bg-[#e8edf3] text-[#1f4e79]`}>Across cohorts</span> : null}
          {scope.kind === "nested" ? (
            <span className={`${chip} bg-[#f2f4f7] text-[#667085]`}>
              Inside {scopes.find((candidate) => candidate.id === scope.parentScopeId)?.code ?? "nothing"}
            </span>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-[#98a2b3]">
            {reading.groups} group{reading.groups === 1 ? "" : "s"} · {reading.placed} placed
          </span>
        </div>
        <p className="mt-1 text-sm text-[#667085]">{KIND_WORDS[scope.kind]}</p>
      </header>

      {error ? (
        <p role="alert" className="border-b border-[#f0d7d9] bg-[#fdf3f3] px-5 py-2.5 text-sm text-[#a6292f]">
          {(error as Error).message}
        </p>
      ) : null}

      {/* ------------------------------------------------------------ what it is */}
      <div className="grid gap-4 border-b border-[#eef1f5] px-5 py-4 sm:grid-cols-2">
        <label className="block">
          <span className={caption}>Code</span>
          <input
            aria-label="Set code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onBlur={() => code.trim() && code !== scope.code && save.mutate({ code: code.trim() })}
            className={field}
          />
        </label>
        <label className="block">
          <span className={caption}>Name</span>
          <input
            aria-label="Set name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => name !== scope.name && save.mutate({ name })}
            placeholder="Tutorials, Lectures, Readiness…"
            className={field}
          />
        </label>
        <div>
          <p className={caption} aria-hidden="true">Kind</p>
          <div className="mt-1">
            <SelectMenu
              label="Kind of set"
              value={kind}
              onChange={(value) => {
                setKind(value as ScopeKind);
                save.mutate({ kind: value as ScopeKind });
              }}
              options={[
                { value: "shared", label: "Its own groups" },
                { value: "nested", label: "Inside another set" },
              ]}
            />
          </div>
        </div>
        {kind === "nested" ? (
          <div>
            <p className={caption} aria-hidden="true">Inside</p>
            <div className="mt-1">
              <SelectMenu
                label="The set this one sits inside"
                value={parentScopeId}
                onChange={(value) => {
                  setParentScopeId(value);
                  save.mutate({ parentScopeId: value });
                }}
                placeholder="Which set…"
                options={parents.map((candidate) => ({ value: candidate.id, label: candidate.code }))}
              />
            </div>
          </div>
        ) : null}
        <label className="flex items-start gap-2 text-sm text-[#344054] sm:col-span-2">
          <input
            type="checkbox"
            aria-label="Open to every cohort"
            checked={openToAll}
            onChange={(event) => {
              setOpenToAll(event.target.checked);
              save.mutate({ openToAll: event.target.checked });
            }}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">Open to every cohort</span>
            <span className="block text-xs text-[#667085]">
              For a class the whole department shares, like the languages: any student may be in it, whatever year they
              are in, and each is still counted under their own cohort.
            </span>
          </span>
        </label>
      </div>

      {/* -------------------------------------------------------- what it carries */}
      <div className="border-b border-[#eef1f5] px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#344054]">
          <Layers size={15} className="text-[#98a2b3]" aria-hidden="true" /> Courses this set carries
        </p>
        <p className="mt-0.5 text-xs text-[#667085]">
          Every group of the set gets a section of each. A set with no course produces nothing to timetable.
        </p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {scope.courses.map((course) => (
            <li key={course.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dee7] bg-white py-1 pl-3 pr-1.5 text-sm">
              <span className="tabular-nums text-[#344054]">{course.code}</span>
              <button
                type="button"
                aria-label={`Remove ${course.code} from ${scope.code}`}
                onClick={() => dropCourse.mutate(course.id)}
                className="rounded-full p-0.5 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
          {!scope.courses.length ? <li className="text-sm text-[#98a2b3]">None yet.</li> : null}
        </ul>
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (newCourse.trim()) addOne.mutate(newCourse.trim().toUpperCase());
          }}
        >
          <div className="w-64">
            <SelectMenu
              label={`Add a course to ${scope.code}`}
              value={newCourse}
              onChange={(value) => {
                setNewCourse(value);
                if (value) addOne.mutate(value);
              }}
              searchable={activeCourses.length > 8}
              placeholder="Add a course…"
              options={activeCourses
                .filter((course) => !scope.courses.some((held) => held.code.toUpperCase() === course.code.toUpperCase()))
                .map((course) => ({ value: course.code, label: course.code, badge: course.title || undefined, badgeTone: "muted" as const }))}
            />
          </div>
        </form>
      </div>

      {/* ---------------------------------------------------------- who is in it */}
      <div className="px-5 py-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#344054]">
          <Users size={15} className="text-[#98a2b3]" aria-hidden="true" /> Groups
        </p>
        <p className="mt-0.5 text-xs text-[#667085]">
          The classes inside this set. A student sits in one of them{scope.kind === "nested" ? ", within their group of the set above" : ""}.
        </p>

        {scope.groups.length ? (
          <div className="mt-2 overflow-hidden rounded-lg border border-[#e4e8ef]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fbfcfe] text-[11px] uppercase tracking-wide text-[#8a94a4]">
                <tr>
                  <th className="py-2 pl-4 pr-3 font-semibold">Group</th>
                  <th className="py-2 pr-3 font-semibold">Seats</th>
                  {scope.kind === "nested" ? <th className="py-2 pr-3 font-semibold">Inside</th> : null}
                  <th className="py-2 pr-3 text-right font-semibold">Placed</th>
                  <th className="py-2 pr-4" />
                </tr>
              </thead>
              <tbody>
                {scope.groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    nested={scope.kind === "nested"}
                    parentGroups={parentGroups}
                    onChanged={onChanged}
                    onRemove={() => setRemovingGroup(group)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-[#c8d0da] px-4 py-4 text-sm text-[#667085]">
            No groups yet. Add them below — a range makes them all at once.
          </p>
        )}

        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (newGroups.trim()) makeGroups.mutate(newGroups);
          }}
        >
          <label className="sr-only" htmlFor={`new-groups-${scope.id}`}>New groups</label>
          <input
            id={`new-groups-${scope.id}`}
            aria-label="New groups"
            value={newGroups}
            onChange={(event) => setNewGroups(event.target.value)}
            placeholder="1-6, or A1-G1"
            className="w-48 rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!newGroups.trim() || makeGroups.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" />
            {makeGroups.isPending ? "Adding…" : labelsFrom(newGroups).length > 1 ? `Add ${labelsFrom(newGroups).length} groups` : "Add group"}
          </button>
          {labelsFrom(newGroups).length > 1 ? (
            <span className="text-xs text-[#98a2b3]">{labelsFrom(newGroups).join(", ")}</span>
          ) : null}
        </form>
      </div>

      <footer className="flex items-center justify-end border-t border-[#eef1f5] px-5 py-3">
        <button
          type="button"
          onClick={() => setRemoving(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#e5b7b9] bg-white px-3 py-1.5 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
        >
          <Trash2 size={14} aria-hidden="true" /> Remove this set
        </button>
      </footer>

      <ConfirmDialog
        open={removing}
        title={`Remove ${scope.code}?`}
        description={`${scope.code} and its ${reading.groups} group(s) go, and the ${reading.placed} student placement(s) in them go with it. The CRNs on Groups & CRNs for this set go too. Nothing brings them back.`}
        confirmLabel="Remove the set"
        confirmPhrase={reading.placed || reading.groups ? scope.code : undefined}
        onConfirm={() => {
          setRemoving(false);
          remove.mutate();
        }}
        onClose={() => setRemoving(false)}
      />
      <ConfirmDialog
        open={removingGroup !== null}
        title={removingGroup ? `Remove ${scope.code} ${removingGroup.label}?` : ""}
        description={
          removingGroup
            ? `${removingGroup.assigned} student(s) sit in it, and would need placing again. Its CRNs go with it.`
            : ""
        }
        confirmLabel="Remove the group"
        confirmPhrase={removingGroup?.assigned ? removingGroup.label : undefined}
        onConfirm={() => {
          if (removingGroup) dropGroup.mutate(removingGroup.id);
          setRemovingGroup(null);
        }}
        onClose={() => setRemovingGroup(null)}
      />
    </section>
  );
}

/** One group: its label, its seats, where it sits, and how many are in it. */
function GroupRow({
  group,
  nested,
  parentGroups,
  onChanged,
  onRemove,
}: {
  group: CatalogueGroup;
  nested: boolean;
  parentGroups: CatalogueGroup[];
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(group.label);
  const [capacity, setCapacity] = useState(String(group.capacity || ""));
  const save = useMutation({
    mutationFn: (next: Partial<{ label: string; capacity: number; parentGroupId: string }>) =>
      updateGroup(group.id, {
        label: next.label ?? label,
        capacity: next.capacity ?? Number(capacity || 0),
        note: group.note,
        program: group.program,
        parentGroupId: next.parentGroupId ?? group.parentGroupId,
      }),
    onSuccess: onChanged,
  });

  return (
    <tr className="border-t border-[#f2f4f7]">
      <td className="py-1.5 pl-4 pr-3">
        <input
          aria-label={`Label of ${group.label}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => label.trim() && label !== group.label && save.mutate({ label: label.trim() })}
          className="w-28 rounded-md border border-transparent px-2 py-1 text-sm font-medium hover:border-[#cbd5e1] focus:border-[#cbd5e1]"
        />
      </td>
      <td className="py-1.5 pr-3">
        <input
          aria-label={`Seats in ${group.label}`}
          value={capacity}
          inputMode="numeric"
          onChange={(event) => setCapacity(event.target.value.replace(/[^0-9]/g, ""))}
          onBlur={() => Number(capacity || 0) !== group.capacity && save.mutate({ capacity: Number(capacity || 0) })}
          placeholder="—"
          className="w-20 rounded-md border border-transparent px-2 py-1 text-sm tabular-nums hover:border-[#cbd5e1] focus:border-[#cbd5e1]"
        />
      </td>
      {nested ? (
        <td className="py-1.5 pr-3">
          <div className="w-40">
            <SelectMenu
              label={`The group ${group.label} sits inside`}
              value={group.parentGroupId}
              onChange={(value) => save.mutate({ parentGroupId: value })}
              placeholder="Nowhere yet"
              options={parentGroups.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            />
          </div>
          {!group.parentGroupId ? (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#a6292f]">
              <AlertTriangle size={10} aria-hidden="true" /> nobody can be placed here
            </span>
          ) : null}
        </td>
      ) : null}
      <td className="py-1.5 pr-3 text-right tabular-nums text-[#667085]">{group.assigned || ""}</td>
      <td className="py-1.5 pr-4 text-right">
        <button
          type="button"
          aria-label={`Remove ${group.label}`}
          onClick={onRemove}
          className="rounded p-1 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </td>
    </tr>
  );
}
