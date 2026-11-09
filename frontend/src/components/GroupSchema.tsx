import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, LayoutGrid, Layers, Plus, Trash2, Users, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CohortMenu } from "@/components/CohortMenu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LabelledPicker } from "@/components/LabelledPicker";
import { ScreenLoading } from "@/components/ScreenLoading";
import { InfoTip, TipButton, TipDo, TipHeading, TipPage, TipPill, TipPoint, TipUsage, TipWarn } from "@/components/InfoTip";
import { SelectMenu } from "@/components/SelectMenu";
import { useRemembered } from "@/components/useRemembered";
import { WarningBanner, WarningRows, type WarningKind } from "@/components/WarningBanner";
import { usePageState } from "@/components/usePageState";
import { fetchActiveCourses, fetchTermLinks } from "@/services/portalLists";
import { fieldHeld } from "@/services/rosterStore";
import { COHORT, SCHEMA_TERM } from "@/services/remembered";
import { labelsFrom, readSets, subRowsNobodyIsOn, totalsOf, unknownMajors, type SetReading } from "@/services/groupSchema";
import {
  type CatalogueGroup,
  type CatalogueMajor,
  type CatalogueScope,
  type Cohort,
  type ScopeKind,
  addCourse,
  addGroup,
  addMajor,
  addScope,
  deleteCourse,
  deleteGroup,
  deleteScope,
  fetchCatalogue,
  fetchCourseCards,
  moveScope,
  parentsOf,
  removeMajor,
  shortProgram,
  updateGroup,
  updateScope,
} from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";
import { useSemesterShown } from "@/services/semesterYears";


const chip = "rounded-full px-2 py-0.5 text-xs font-semibold";
const field = "mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm";
const caption = "block text-xs font-semibold uppercase tracking-wide text-[#667085]";
/*
 * The four columns that hold a control — In parallel with, Sub-rows, Goes with, First for —
 * share whatever room the others leave (those are sized to what they hold), and each control
 * fills its column. A control capped short of its column left a band of nothing beside it on
 * a wide screen; on a laptop they shrink to these minimums and the table still fits.
 *
 * Not sized by what they hold, so every row is the same and the table never grows past the
 * page for them: the two group menus fold what does not fit into "+N".
 */
const PILL_MENU = "w-full min-w-[7rem] [contain:inline-size]";
const WIDE_MENU = "w-full min-w-[10rem] [contain:inline-size]";

/**
 * What "placing" is, with the buttons that do it.
 *
 * Sub-rows, First for, Goes with and a link between sets do nothing on this page: they are
 * felt when a student is placed, which happens on other pages. Every bubble that speaks of
 * placing says where, with the buttons as they look there.
 */
function HowPlacing({ setCode }: { setCode: string }) {
  return (
    <>
      <TipHeading>Placing: putting students into groups</TipHeading>
      <TipPoint>
        <TipButton icon={Wand2}>Fill {setCode}</TipButton> on <TipPage name="Groups & CRNs" /> places everyone not yet in
        this set, at once.
      </TipPoint>
      <TipPoint>
        <TipButton icon={LayoutGrid}>Place in groups…</TipButton> on <TipPage name="Cohorts" /> or <TipPage name="Students" />{" "}
        places the students you tick.
      </TipPoint>
    </>
  );
}

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
  header,
}: {
  cohorts: Cohort[];
  onOpenGroups?: () => void;
  /** The slot on the page's title line, top right, where the semester goes. */
  header?: HTMLElement | null;
}) {
  const client = useQueryClient();
  // Both remembered by this browser: the cohort with every other cohort picker, the
  // semester on its own, since this is the only page that asks for one.
  const [termId, setTermId] = useRemembered(SCHEMA_TERM);
  const [cohortId, setCohortId] = useRemembered(COHORT);
  const [chosenId, setChosenId] = usePageState("group-schema:set", "");
  // The two panes fill the room under the totals, and each scrolls inside itself.

  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const shownOf = useSemesterShown();
  const active = useQuery({ queryKey: ["active-courses"], queryFn: () => fetchActiveCourses() });
  /*
   * The programmes the registrar has for this browser's students, which is the vocabulary
   * both pickers below must speak: `scope_groups.program` is matched against a student's
   * MAJOR_CODE_DESC by the fill, so a programme typed by hand would be a programme that
   * matches nobody. Offered as a list for the same reason.
   *
   * From what this browser holds, like every other student fact. A browser that has never
   * synced offers nothing, and both pickers stay out of the way until it has.
   */
  const majors = useQuery({
    queryKey: ["field-held", "MAJOR_CODE_DESC"],
    queryFn: () => fieldHeld("MAJOR_CODE_DESC"),
    staleTime: 60_000,
  });
  const programmes = useMemo(
    () => [...new Set(Object.values(majors.data ?? {}).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [majors.data],
  );
  const catalogue = useQuery({
    queryKey: ["catalogue", cohortId, termId],
    queryFn: () => fetchCatalogue(cohortId, termId),
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

  /*
   * What the sub-row and First for pickers offer when this browser holds no students: the
   * majors the schema already uses, in any cohort and any semester.
   *
   * It used to be a free field, where "MATH - Mathematic" made a sub-row nobody is ever
   * placed on, and nothing said so — the warning for that is measured against the students
   * this browser holds, and it held none. Those warnings still are: this list is only what
   * the pickers offer, never evidence of who is on what.
   */
  const pulled = programmes.length > 0;
  const everySchema = useQuery({
    queryKey: ["course-cards"],
    queryFn: fetchCourseCards,
    enabled: majors.isSuccess && !pulled,
  });
  const vocabulary = useMemo(() => {
    if (pulled) return programmes;
    const used = new Set<string>();
    for (const scope of [...(everySchema.data ?? []).flatMap((held) => held.scopes), ...scopes]) {
      for (const group of scope.groups) {
        for (const major of group.majors ?? []) if (major.program.trim()) used.add(major.program.trim());
        if (group.firstFor?.trim()) used.add(group.firstFor.trim());
      }
    }
    return [...used].sort((left, right) => left.localeCompare(right));
  }, [pulled, programmes, everySchema.data, scopes]);
  const readings = useMemo(() => readSets(scopes, cohortId, programmes), [scopes, cohortId, programmes]);
  const cohort = cohorts.find((row) => row.id === cohortId) ?? null;
  const totals = totalsOf(readings);
  const chosen = readings.find((reading) => reading.scope.id === chosenId) ?? readings[0] ?? null;

  /*
   * What this browser has pulled, said out loud wherever a warning is measured against it.
   *
   * Both of the programme warnings below are "nobody is on this" — which is a fact about
   * the students this browser happens to hold, not about the department. A browser that
   * pulled L1 this morning and nothing since knows of two programmes, and would call every
   * sub-row of the other years wrong. The count is the reader's way of telling the two
   * apart, so it travels with the warning rather than being left to be guessed at.
   */
  const pulledFrom = `Measured against the ${programmes.length} programme${programmes.length === 1 ? "" : "s"} this browser has pulled: ${programmes.join(", ")}. A cohort this browser has not synced is not evidence.`;

  const warnings: WarningKind[] = useMemo(() => {
    const kinds: {
      id: string;
      why: string;
      severity: "serious" | "caution";
      label: (n: number) => string;
      note?: string;
      /** What to say about this set in particular, beyond its code and name. */
      say?: (reading: SetReading) => string;
    }[] = [
      { id: "parent", why: "no parent set", severity: "serious", label: (n) => `${n} nested set${n === 1 ? "" : "s"} sit inside nothing` },
      { id: "adrift", why: "groups adrift", severity: "serious", label: (n) => `${n} set${n === 1 ? " has" : "s have"} groups nobody can be placed into` },
      {
        id: "subrow",
        why: "sub-row nobody is on",
        severity: "serious",
        label: (n) => `${n} set${n === 1 ? " has" : "s have"} a sub-row no student is on`,
        note: pulledFrom,
        say: (reading) =>
          subRowsNobodyIsOn(reading.scope, programmes)
            .map((row) => `${row.group} — ${row.program}`)
            .join(" · "),
      },
      { id: "course", why: "no course", severity: "caution", label: (n) => `${n} set${n === 1 ? " carries" : "s carry"} no course` },
      { id: "group", why: "no group", severity: "caution", label: (n) => `${n} set${n === 1 ? " has" : "s have"} no group` },
    ];
    const found = kinds
      .map((kind) => {
        const hit = readings.filter((reading) => reading.trouble.includes(kind.why as SetReading["trouble"][number]));
        if (!hit.length) return null;
        return {
          id: kind.id,
          severity: kind.severity,
          label: kind.label(hit.length),
          note: kind.note,
          detail: (
            <WarningRows>
              {hit.map((reading) => (
                <li key={reading.scope.id} className="flex items-baseline gap-3 px-4 py-2">
                  <button type="button" onClick={() => setChosenId(reading.scope.id)} className="font-semibold text-[#1f4e79] underline-offset-2 hover:underline">
                    {reading.scope.code}
                  </button>
                  <span className="text-[#667085]">{reading.scope.name || "no name"}</span>
                  {kind.say ? <span className="text-[#98a2b3]">{kind.say(reading)}</span> : null}
                </li>
              ))}
            </WarningRows>
          ),
        };
      })
      .filter(Boolean) as WarningKind[];

    /*
     * And the cohort's own expectations, which are not a set's trouble but sit in the same
     * band because they fail the same way: a code nobody is on is a rule that passes
     * everybody, which reads on every screen as a cohort with nothing wrong with it.
     */
    const strays = unknownMajors(cohort?.majors ?? [], programmes);
    if (strays.length) {
      found.push({
        id: "cohort-major",
        severity: "caution",
        label: `${cohort?.name ?? "This cohort"} expects ${strays.length === 1 ? "a major" : `${strays.length} majors`} no student is on`,
        note: pulledFrom,
        detail: (
          <WarningRows>
            <li className="px-4 py-2 text-[#667085]">
              <span className="font-semibold text-[#344054]">{strays.join(", ")}</span> — nobody this browser holds
              reads {strays.length === 1 ? "it" : "them"}, so &ldquo;their major is not this cohort&rsquo;s&rdquo;
              catches nobody. Check the code against the portal&rsquo;s under Rename &amp; expectations.
            </li>
          </WarningRows>
        ),
      });
    }
    return found;
  }, [readings, programmes, pulledFrom, cohort, setChosenId]);

  if (!terms.isLoading && !(terms.data ?? []).length) {
    return (
      <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
        No semester yet — make one on the Semesters page first.
      </p>
    );
  }

  const semesterMenu = (
    <SelectMenu
      label="Semester"
      value={termId}
      onChange={setTermId}
      placeholder="Which semester…"
      options={(terms.data ?? []).map((term) => ({ value: term.id, ...shownOf(term) }))}
    />
  );

  return (
    <section className="flex flex-col lg:min-h-0 lg:flex-1">
      {/* The semester top right, on the page's title line, as on every page with one. */}
      {header ? createPortal(<div className="w-fit min-w-[12rem] max-w-[min(24rem,100%)]">{semesterMenu}</div>, header) : null}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {/* The semester first: a set belongs to one, and the cohort means nothing until it is settled. */}
        {header ? null : <LabelledPicker label="Semester">{semesterMenu}</LabelledPicker>}
        <LabelledPicker label="Cohort">
          <CohortMenu cohorts={cohorts} semesterId={termId} value={cohortId} onChange={setCohortId} placeholder="Which cohort…" />
        </LabelledPicker>
        {/* The cohort's totals beside its pickers, rather than a line of their own under them. */}
        {cohortId && termId && !catalogue.isLoading ? (
          <span className="pb-2 text-xs tabular-nums text-[#98a2b3]">
            {totals.sets} set{totals.sets === 1 ? "" : "s"} · {totals.groups} group{totals.groups === 1 ? "" : "s"} ·{" "}
            {totals.courses} course{totals.courses === 1 ? "" : "s"} · {totals.placed} placed
          </span>
        ) : null}
        <span className="pb-2">
          <InfoTip label="How this page works" title="How this page works">
            <TipDo>Describe how the cohort is split into classes. Then give each class its CRNs on <TipPage name="Groups & CRNs" />.</TipDo>
            <TipHeading>Steps</TipHeading>
            <TipPoint step={1}>
              Add a <b>set</b> for each kind of class, on the left: <TipPill>CM</TipPill> <TipPill>TD</TipPill> <TipPill>TP</TipPill>
            </TipPoint>
            <TipPoint step={2}>Add the <b>courses</b> the set teaches.</TipPoint>
            <TipPoint step={3}>Add its <b>groups</b>, and fill in each group&apos;s row.</TipPoint>
            <TipPoint step={4}><b>Link</b> a set when its groups depend on another set&apos;s.</TipPoint>
            <TipPoint step={5}>
              Then press <TipButton look="link" icon={ArrowRight}>Fill it in on Groups &amp; CRNs</TipButton>, top right, for the
              CRNs.
            </TipPoint>
            <TipUsage
              when={<>Setting up L1: lectures for everyone, three tutorial groups, and a Mechanics lab in half-groups.</>}
              todo={<>Add <TipPill>CM</TipPill> with group 1, <TipPill>TD</TipPill> with groups 1-3, and <TipPill>MTP</TipPill> linked to TD with 1A to 3B. Give each its courses.</>}
              then={<><TipPage name="Groups & CRNs" /> lists every CRN L1 needs, set by set, ready to fill in.</>}
            />
            <span className="mt-2 block text-[#667085]">Everything saves as you go.</span>
          </InfoTip>
        </span>
        {onOpenGroups ? (
          <button type="button" onClick={onOpenGroups} className="ml-auto inline-flex items-center gap-1.5 pb-2 text-sm font-semibold text-[#1f4e79] hover:underline">
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
          <WarningBanner title="Needs attention" kinds={warnings} />

          <div className="grid items-stretch gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[17rem_1fr] lg:overflow-hidden lg:[grid-template-rows:minmax(0,1fr)]">
            <nav aria-label="Group sets" className="relative rounded-lg border border-[#d9dee7] bg-white p-1.5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-none">
              <p className="flex items-center gap-1 px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                Sets
                <InfoTip label="How the sets list works" title="The sets list">
                  <TipDo>Pick a set to edit it on the right.</TipDo>
                  <TipHeading>The dot beside each set</TipHeading>
                  <TipPoint tone="good">Nothing missing.</TipPoint>
                  <TipPoint tone="caution">Something to finish: no course, no group, or a sub-row no student is on.</TipPoint>
                  <TipPoint tone="serious">Nobody can be placed: it is linked to nothing, or has groups that go with nothing.</TipPoint>
                  <TipHeading>Order and new sets</TipHeading>
                  <TipPoint>
                    Hover a set and use its <TipButton icon={ChevronUp}>up</TipButton> <TipButton icon={ChevronDown}>down</TipButton>{" "}
                    arrows to move it. <TipPage name="Groups & CRNs" /> shows the sets in this order.
                  </TipPoint>
                  <TipPoint>
                    To add one, type a short code at the bottom and press{" "}
                    <TipButton look="solid" icon={Plus}>
                      Set
                    </TipButton>
                  </TipPoint>
                  <TipUsage
                    when={<><TipPill>TD</TipPill> shows an amber dot.</>}
                    todo={<>Open it: it has no course yet. Add <TipPill>MATH-100</TipPill></>}
                    then={<>The dot turns green, and TD&apos;s CRNs can be filled in on <TipPage name="Groups & CRNs" />.</>}
                  />
                </InfoTip>
              </p>
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
                  <p className="flex items-center gap-1 px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                    Across cohorts
                    <InfoTip label="What sets across cohorts are" title="Across cohorts">
                      <TipDo>To put a set here, tick <b>Open to every cohort</b> on it.</TipDo>
                      <TipPoint>Students of any cohort can be placed in it.</TipPoint>
                      <TipPoint>Each is still counted under their own cohort.</TipPoint>
                      <TipPoint>Its place in the order isn&apos;t changed from here.</TipPoint>
                      <TipUsage
                        when={<>L2 students take the language classes set up under FYS.</>}
                        todo={<>Nothing to copy: place them in <TipPill>LANG</TipPill> groups as usual.</>}
                        then={<>They share the classes with FYS students, and still count under L2.</>}
                      />
                    </InfoTip>
                  </p>
                  {readings.filter((reading) => reading.shared).map((reading) => (
                    <SetLine key={reading.scope.id} reading={reading} chosen={reading.scope.id === chosen?.scope.id} onChoose={() => setChosenId(reading.scope.id)} />
                  ))}
                </>
              ) : null}
              <NewSet cohortId={cohortId} termId={termId} scopes={scopes} onMade={(id) => { setChosenId(id); refresh(); }} />
            </nav>

            {chosen ? (
              <div className="min-w-0 lg:min-h-0">
              <SetEditor
                key={chosen.scope.id}
                reading={chosen}
                scopes={scopes}
                activeCourses={(active.data ?? []).map((course) => ({ code: course.courseCode, title: course.title }))}
                programmes={vocabulary}
                pulled={pulled}
                onChanged={refresh}
                onRemoved={() => {
                  setChosenId("");
                  refresh();
                }}
              />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-10 text-center text-sm text-[#667085]">
                No sets in this semester yet. Add one on the left — the lectures, the tutorials, the practicals.
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
  /*
   * A set is added only to a semester linked to a portal term: the registration check reads
   * a semester's sets and sections through that link. The server refuses it too; this says
   * so before anybody types a code.
   */
  const links = useQuery({ queryKey: ["term-links"], queryFn: fetchTermLinks, retry: false });
  const unlinked = Boolean(links.data) && !links.data?.[termId];
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
        if (code.trim() && !taken && !unlinked) make.mutate();
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
          disabled={!code.trim() || taken || unlinked || make.isPending}
          className="inline-flex items-center gap-1 rounded-md bg-[#1f4e79] px-2.5 py-1.5 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
        >
          <Plus size={14} aria-hidden="true" /> Set
        </button>
      </div>
      {taken ? <p className="mt-1 text-[11px] text-[#a6292f]">This cohort already has a set called {code.trim()}.</p> : null}
      {unlinked ? (
        <p className="mt-1 text-[11px] text-[#a6292f]">
          Link this semester to a portal term on the Semesters page before adding sets to it.
        </p>
      ) : null}
      {make.error ? <p role="alert" className="mt-1 text-[11px] text-[#a6292f]">{(make.error as Error).message}</p> : null}
    </form>
  );
}

/** One set in full: what it is, what it carries, and the groups inside it. */
function SetEditor({
  reading,
  scopes,
  activeCourses,
  programmes,
  pulled,
  onChanged,
  onRemoved,
}: {
  reading: SetReading;
  scopes: CatalogueScope[];
  activeCourses: { code: string; title: string }[];
  /**
   * The majors the two pickers below offer: the synced students', or — with none synced in
   * this browser — those the schema already uses.
   */
  programmes: string[];
  /** Whether those are the synced students' majors, the whole list, or only the schema's. */
  pulled: boolean;
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
  const parentCode = scopes.find((candidate) => candidate.id === scope.parentScopeId)?.code ?? "linked";
  // Every group of the same semester, any set, that one of these could run in parallel with.
  const siblings = scopes
    .filter((candidate) => (candidate.termId ?? "") === (scope.termId ?? ""))
    .flatMap((candidate) => candidate.groups.map((group) => ({ id: group.id, label: `${candidate.code} ${group.label}` })));
  const error = save.error ?? addOne.error ?? makeGroups.error ?? remove.error;

  return (
    /*
      * The set's name stays put while everything about it scrolls under it.
      *
      * Its courses and its groups run well past a screen, and a page of fields with no
      * name over them is a page you have to scroll back up to identify.
      */
    <section className="flex min-w-0 flex-col rounded-lg border border-[#d9dee7] bg-white lg:h-full lg:min-h-0">
      {/*
        * The set's name stays put while everything about it scrolls under it; its settings
        * sit on one line beneath, each explained on its ⓘ rather than in a paragraph.
        */}
      <header className="shrink-0 border-b border-[#eef1f5] px-5 pb-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="text-lg font-semibold text-[#1f4e79]">{scope.code}</h3>
          {scope.name && scope.name !== scope.code ? <span className="text-sm text-[#667085]">{scope.name}</span> : null}
          {reading.shared ? <span className={`${chip} bg-[#e8edf3] text-[#1f4e79]`}>Across cohorts</span> : null}
          {scope.kind === "nested" ? (
            <span className={`${chip} bg-[#f2f4f7] text-[#667085]`}>Linked to {scopes.find((candidate) => candidate.id === scope.parentScopeId)?.code ?? "nothing"}</span>
          ) : null}
          <span className="ml-auto text-xs tabular-nums text-[#98a2b3]">
            {reading.groups} group{reading.groups === 1 ? "" : "s"} · {reading.placed} placed
          </span>
          <button
            type="button"
            onClick={() => setRemoving(true)}
            aria-label={`Remove ${scope.code}`}
            title="Remove this set"
            className="rounded-md p-1.5 text-[#c8d0da] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="block w-28">
            <span className={`${caption} flex items-center gap-1`}>
              Code
              <InfoTip label="What the set's code is for" title="The set's code">
                <TipDo>Keep it short: the kind of class, or the course and the kind.</TipDo>
                <TipPoint>Other pages call the set by its code.</TipPoint>
                <TipPoint>Add a <b>name</b> beside it when the code alone isn&apos;t clear.</TipPoint>
                <TipUsage
                  when={<>L1&apos;s Mechanics lab runs in half-groups, apart from the tutorials.</>}
                  todo={<>Add a set with code <TipPill>MTP</TipPill> and name it &ldquo;Mechanics TP&rdquo;.</>}
                  then={<>Every page calls it MTP; the name says what it is.</>}
                />
              </InfoTip>
            </span>
            <input
              aria-label="Set code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              onBlur={() => code.trim() && code !== scope.code && save.mutate({ code: code.trim() })}
              className={field}
            />
          </div>
          <label className="block min-w-40 flex-1">
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
          {/*
            * One question, where there used to be two dropdowns — a kind, then "inside" what:
            * does this set depend on another? Linked, each of its groups says which groups of
            * that set it goes with, and placing a student proposes only groups that go with theirs.
            */}
          <div className="w-44">
            <span className={`${caption} flex items-center gap-1`}>
              Linked to
              <InfoTip label="What linking a set does" title="Linking a set">
                <TipDo>Link it when its groups only work alongside another set&apos;s groups.</TipDo>
                <TipPoint>Each group then says, under <b>Goes with</b>, which groups of that set it goes with.</TipPoint>
                <TipPoint>Placing a student offers only the groups that go with theirs.</TipPoint>
                <TipPoint>Only a set that isn&apos;t linked itself can be picked.</TipPoint>
                <TipPoint>Leave it <b>Not linked</b> when any group will do.</TipPoint>
                <HowPlacing setCode={scope.code} />
                <TipUsage
                  when={<>L1&apos;s Mechanics lab splits each TD in two, and students must stay with their own TD.</>}
                  todo={<>Link <TipPill>MTP</TipPill> to <TipPill>TD</TipPill>, then make <TipPill>1A</TipPill> <TipPill>1B</TipPill> go with TD 1, <TipPill>2A</TipPill> <TipPill>2B</TipPill> with TD 2, and so on.</>}
                  then={<>A TD 1 student is offered only 1A or 1B.</>}
                  other={<>Not one-to-one: <TipPill>PHIL-TD 2</TipPill> goes with both TD 2 and TD 3, so mathematicians from either can be placed in it.</>}
                />
              </InfoTip>
            </span>
            <div className="mt-1">
              <SelectMenu
                label="The set this one is linked to"
                value={kind === "nested" ? parentScopeId : ""}
                onChange={(value) => {
                  setKind(value ? "nested" : "shared");
                  setParentScopeId(value);
                  save.mutate(value ? { kind: "nested", parentScopeId: value } : { kind: "shared" });
                }}
                options={[
                  { value: "", label: "Not linked" },
                  ...parents.map((candidate) => ({ value: candidate.id, label: candidate.code })),
                ]}
              />
            </div>
          </div>
          <label className="flex h-[38px] items-center gap-2 text-sm text-[#344054]">
            <input
              type="checkbox"
              aria-label="Open to every cohort"
              checked={openToAll}
              onChange={(event) => {
                setOpenToAll(event.target.checked);
                save.mutate({ openToAll: event.target.checked });
              }}
            />
            <span className="font-semibold">Open to every cohort</span>
            <InfoTip label="What open to every cohort means" title="Open to every cohort">
              <TipDo>Tick it for a class the whole department shares.</TipDo>
              <TipPoint>Students of any cohort can be placed in it.</TipPoint>
              <TipPoint>Each is still counted under their own cohort.</TipPoint>
              <TipPoint>It moves under <b>Across cohorts</b> in the sets list.</TipPoint>
              <TipUsage
                when={<>Languages are taught by level, to every year together.</>}
                todo={<>Make one <TipPill>LANG</TipPill> set, in one cohort, and tick Open to every cohort.</>}
                then={<>Any student, FYS to L3, can be placed in <TipPill>A0-F1</TipPill> to <TipPill>B2-G1</TipPill></>}
              />
            </InfoTip>
          </label>
        </div>
      </header>

      <div className="relative lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-none">
      {error ? (
        <p role="alert" className="border-b border-[#f0d7d9] bg-[#fdf3f3] px-5 py-2.5 text-sm text-[#a6292f]">
          {(error as Error).message}
        </p>
      ) : null}

      {/* -------------------------------------------------------- what it carries */}
      <div className="border-b border-[#eef1f5] px-5 py-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">
          <Layers size={15} className="text-[#98a2b3]" aria-hidden="true" /> Courses
          <InfoTip label="What the set's courses mean" title="The set's courses">
            <TipDo>Add every course this set&apos;s groups are taught.</TipDo>
            <TipPoint><TipPage name="Groups & CRNs" /> then expects a CRN for each group, in each course.</TipPoint>
            <TipPoint>Except where the course and the group are for different majors: no CRN is expected there.</TipPoint>
            <TipPoint>Only active courses are offered. Missing one? Add it on <TipPage name="Active CRNs" /> first.</TipPoint>
            <TipUsage
              when={<>L1&apos;s tutorials cover four courses.</>}
              todo={<>Add <TipPill>MATH-100</TipPill> <TipPill>CPSC-100</TipPill> <TipPill>PHYS-105</TipPill> <TipPill>PHYS-125</TipPill> to <TipPill>TD</TipPill></>}
              then={<>With 3 TD groups, <TipPage name="Groups & CRNs" /> asks for 12 CRNs: one per group, per course.</>}
            />
          </InfoTip>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {scope.courses.map((course) => (
            <span key={course.id} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9dee7] bg-white py-1 pl-3 pr-1.5 text-sm">
              <span className="tabular-nums text-[#344054]">{course.code}</span>
              <button
                type="button"
                aria-label={`Remove ${course.code} from ${scope.code}`}
                onClick={() => dropCourse.mutate(course.id)}
                className="rounded-full p-0.5 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            </span>
          ))}
          {/* The next course goes where the chips end, not on a row of its own. */}
          <div className="w-52">
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
        </div>
      </div>

      {/* ---------------------------------------------------------- who is in it */}
      <div className="px-5 py-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-[#344054]">
          <Users size={15} className="text-[#98a2b3]" aria-hidden="true" /> Groups
          <InfoTip label="What the set's groups are" title="The set's groups">
            <TipDo>Add one group per class of this set, then fill in its row.</TipDo>
            <TipPoint>
              A student sits in one group of each set{scope.kind === "nested" ? `: here, one that goes with their ${parentCode} group` : ""}.
            </TipPoint>
            <TipPoint>Seats are set on <TipPage name="Groups & CRNs" />; the row shows them.</TipPoint>
            <TipUsage
              when={<>L1 needs three tutorial groups this semester.</>}
              todo={<>Type <TipPill>1-3</TipPill> under the table and press <TipButton icon={Plus}>Add 3 groups</TipButton></>}
              then={<>Groups 1, 2 and 3 appear, each with its own row to fill in.</>}
            />
          </InfoTip>
        </p>

        {!pulled && scope.groups.length ? (
          <p className="mt-1 text-xs text-[#8a6116]">
            No students are synced in this browser, so sub-rows offer only the majors the schema already uses. Sync the
            students with Portal sync to choose from every major.
          </p>
        ) : null}

        {scope.groups.length ? (
          <div className="mt-2 overflow-x-auto rounded-lg border border-[#e4e8ef]">
            {/* No min-w-max: a header may wrap ("In parallel / with") before the table scrolls sideways. */}
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fbfcfe] text-[11px] uppercase tracking-wide text-[#8a94a4]">
                <tr>
                  <th className="w-px whitespace-nowrap py-2 pl-4 pr-2 font-semibold">Group</th>
                  <th className="w-px whitespace-nowrap py-2 pr-2 font-semibold">
                    <span className="inline-flex items-center gap-1 normal-case">
                      <span className="uppercase">Seats</span>
                      <InfoTip label="Where seats are set" title="Seats">
                        <TipDo>Change them on <TipPage name="Groups & CRNs" />, from any of the group&apos;s cards.</TipDo>
                        <TipPoint>It&apos;s what the timetabler is told to expect.</TipPoint>
                        <TipPoint>With sub-rows, it&apos;s their seats added up.</TipPoint>
                        <TipUsage
                          when={<><TipPill>CM 1</TipPill> takes the whole year: 120 students.</>}
                          todo={<>On <TipPage name="Groups & CRNs" />, set 120 on any of CM 1&apos;s cards.</>}
                          then={<>This row shows 120, and the timetabler is told to expect 120.</>}
                        />
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2 pr-2 font-semibold">
                    <span className="inline-flex items-center gap-1 normal-case">
                      <span className="uppercase">In parallel with</span>
                      <InfoTip label="What in parallel with does" title="In parallel with">
                        <TipDo>Pick the groups that must be timetabled at the same hour as this one.</TipDo>
                        <TipPoint>Any group of this semester, from any set.</TipPoint>
                        <TipPoint>The timetabler gets it as a constraint on the row.</TipPoint>
                        <TipPoint>Leave it empty when the group can go at any time.</TipPoint>
                        <TipUsage
                          when={<>In TD 3, physicists have Optics while mathematicians have Philosophy, at the same hour.</>}
                          todo={<>In <TipPill>OPT-TD 1</TipPill>&apos;s row, pick <TipPill>PHIL-TD 2</TipPill> under In parallel with.</>}
                          then={<>The timetabler books both at the same hour, so no TD 3 student has a gap.</>}
                        />
                      </InfoTip>
                    </span>
                  </th>
                  <th className="py-2 pr-2 font-semibold">
                    <span className="inline-flex items-center gap-1 normal-case">
                      <span className="uppercase">Sub-rows</span>
                      <InfoTip label="What sub-rows are" title="Sub-rows">
                        <TipDo>Add a major to split this group by major. Leave it empty when everybody is taught together.</TipDo>
                        <TipHeading>Once split</TipHeading>
                        <TipPoint>Placing puts each student on their major&apos;s sub-row, up to its seats.</TipPoint>
                        <TipPoint>On <TipPage name="Groups & CRNs" /> each sub-row can have its own section, or be marked not taught.</TipPoint>
                        <TipPoint>
                          Registration checks, <TipPage name="Capacity" />, the workbook and <TipPage name="Teacher hours" /> treat each
                          sub-row apart.
                        </TipPoint>
                        <TipUsage
                          when={<><TipPill>CM 1</TipPill> holds 100 mathematicians and 20 physicists, each major with its own sections.</>}
                          todo={<>Add <TipPill>Mathematics</TipPill> and <TipPill>Physics</TipPill> as sub-rows of CM 1.</>}
                          then={<>Each student lands on their major&apos;s sub-row, and <TipPage name="Groups & CRNs" /> can give each sub-row its own CRN.</>}
                          otherLabel="Not this case"
                          other={<><TipPill>TD 3</TipPill> is taught together, and you only want physicists placed there first: don&apos;t split it, set its <b>First for</b> to Physics.</>}
                        />
                        <HowPlacing setCode={scope.code} />
                      </InfoTip>
                    </span>
                  </th>
                  {scope.kind === "nested" ? (
                    <th className="py-2 pr-2 font-semibold">
                      <span className="inline-flex items-center gap-1 normal-case">
                        <span className="uppercase">Goes with</span>
                        <InfoTip label="What goes with does" title="Goes with">
                          <TipDo>Pick the {parentCode} groups whose students can be in this group.</TipDo>
                          <TipPoint>Placing a student offers only the groups that go with theirs.</TipPoint>
                          <TipPoint>Pick several when it isn&apos;t one-to-one.</TipPoint>
                          <TipWarn>Left empty, nobody can be placed in the group.</TipWarn>
                          <HowPlacing setCode={scope.code} />
                          <TipUsage
                            when={<>Philosophy TD 2 takes the mathematicians of both TD 2 and TD 3.</>}
                            todo={<>In <TipPill>PHIL-TD</TipPill>&apos;s group 2 row, pick TD groups <TipPill>2</TipPill> and <TipPill>3</TipPill> under Goes with.</>}
                            then={<>Mathematicians from either TD are offered PHIL-TD 2; TD 1 students aren&apos;t.</>}
                          />
                        </InfoTip>
                      </span>
                    </th>
                  ) : null}
                  {programmes.length > 1 ? (
                    <th className="py-2 pr-2 font-semibold">
                      <span className="inline-flex items-center gap-1 normal-case">
                        <span className="uppercase">First for</span>
                        <InfoTip label="What First for does" title="First for">
                          <TipDo>Pick the major this group is filled with first.</TipDo>
                          <TipPoint>Placing puts that major here before anywhere else.</TipPoint>
                          <TipPoint>Other majors come here once the groups for nobody in particular are full.</TipPoint>
                          <TipPoint>A preference, not a wall: anyone can still be placed here by hand.</TipPoint>
                          <TipPoint>Unlike sub-rows, the group isn&apos;t split: everybody shares its seats.</TipPoint>
                          <HowPlacing setCode={scope.code} />
                          <TipUsage
                            when={<>TD 3 was opened for the physicists, but others may join if it has room.</>}
                            todo={<>Set TD 3&apos;s First for to <TipPill>PHYS - Physics</TipPill></>}
                            then={<>Physicists are placed there first; other majors only once TD 1 and TD 2 are full.</>}
                            otherLabel="Not this case"
                            other={<>TD 3&apos;s physicists need their own section of a course: First for won&apos;t do that, add a <TipPill>Physics</TipPill> sub-row instead.</>}
                          />
                        </InfoTip>
                      </span>
                    </th>
                  ) : null}
                  <th className="w-px whitespace-nowrap py-2 pr-2 text-right font-semibold">
                    <span className="inline-flex items-center gap-1 normal-case">
                      <span className="uppercase">Placed</span>
                      <InfoTip label="What placed counts" title="Placed">
                        <TipDo>
                          Place students with <TipButton icon={Wand2}>Fill {scope.code}</TipButton> on <TipPage name="Groups & CRNs" />,
                          or <TipButton icon={LayoutGrid}>Place in groups…</TipButton> on <TipPage name="Cohorts" /> for the ones you tick.
                        </TipDo>
                        <TipPoint>The students in this group now.</TipPoint>
                        <TipPoint>
                          A student&apos;s own record places them in every set at once:{" "}
                          <TipButton icon={Wand2}>Place in every set…</TipButton>
                        </TipPoint>
                        <TipWarn>Removing a group sends its students back to be placed again.</TipWarn>
                        <TipUsage
                          when={<><TipPill>TD 1</TipPill> shows 38 placed for 30 seats.</>}
                          todo={<>Raise its seats on <TipPage name="Groups & CRNs" />, or add a TD 4 and place some students there.</>}
                          then={<>Every student has a seat the timetabler knows about.</>}
                        />
                      </InfoTip>
                    </span>
                  </th>
                  <th className="w-px py-2 pr-2" />
                </tr>
              </thead>
              <tbody>
                {scope.groups.map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    nested={scope.kind === "nested"}
                    programmes={programmes}
                    pulled={pulled}
                    parentGroups={parentGroups}
                    siblings={siblings}
                    onChanged={onChanged}
                    onRemove={() => setRemovingGroup(group)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-[#c8d0da] px-4 py-4 text-sm text-[#667085]">No groups yet.</p>
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
            title="One label, or a range that makes them all at once"
            className="w-44 rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={!newGroups.trim() || makeGroups.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" />
            {makeGroups.isPending ? "Adding…" : labelsFrom(newGroups).length > 1 ? `Add ${labelsFrom(newGroups).length} groups` : "Add group"}
          </button>
          <InfoTip label="How to add groups" title="Adding groups">
            <TipDo>
              Type a label and press <TipButton icon={Plus}>Add group</TipButton>, or type a range to add several at once.
            </TipDo>
            <TipPoint>
              <TipPill>1-6</TipPill> adds groups 1 to 6; <TipPill>TD 1-3</TipPill> adds TD 1, TD 2 and TD 3.
            </TipPoint>
            <TipPoint>
              The last number counts up: <TipPill>A1-G1-4</TipPill> adds A1-G1 to A1-G4.
            </TipPoint>
            <TipPoint>Anything else is one group, named as typed: <TipPill>A1-G1</TipPill> alone is one group.</TipPoint>
            <TipUsage
              when={<>The languages need seven A0 groups, A0-F1 to A0-F7.</>}
              todo={<>Type <TipPill>A0-F1-7</TipPill> and press <TipButton icon={Plus}>Add 7 groups</TipButton></>}
              then={<>A0-F1, A0-F2 … A0-F7 appear at once.</>}
            />
          </InfoTip>
          {labelsFrom(newGroups).length > 1 ? (
            <span className="text-xs text-[#98a2b3]">{labelsFrom(newGroups).join(", ")}</span>
          ) : null}
        </form>
      </div>

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
      </div>
    </section>
  );
}

/** One group: its label, its seats, where it sits, and how many are in it. */
function GroupRow({
  group,
  nested,
  programmes,
  pulled,
  parentGroups,
  siblings,
  onChanged,
  onRemove,
}: {
  group: CatalogueGroup;
  nested: boolean;
  programmes: string[];
  pulled: boolean;
  parentGroups: CatalogueGroup[];
  /** Every other group of the same semester, any set, that this one could run in parallel with. */
  siblings: { id: string; label: string }[];
  onChanged: () => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(group.label);
  const save = useMutation({
    mutationFn: (
      next: Partial<{ label: string; parentGroupIds: string[]; firstFor: string; parallelWith: string[] }>,
    ) =>
      updateGroup(group.id, {
        label: next.label ?? label,
        capacity: group.capacity,
        note: group.note,
        parentGroupIds: next.parentGroupIds ?? parentsOf(group),
        firstFor: next.firstFor ?? group.firstFor ?? "",
        parallelWith: next.parallelWith ?? group.parallelWith,
      }),
    onSuccess: onChanged,
  });
  const majors = group.majors ?? [];

  return (
    <tr className="border-t border-[#f2f4f7]">
      <td className="py-1.5 pl-4 pr-2">
        <input
          aria-label={`Label of ${group.label}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={() => label.trim() && label !== group.label && save.mutate({ label: label.trim() })}
          // As wide as the name it holds: "1 Mathematics" was cut to "1 Mat".
          style={{ width: `${Math.max(5, label.length + 3)}ch` }}
          className="rounded-md border border-transparent px-2 py-1 text-sm font-medium hover:border-[#cbd5e1] focus:border-[#cbd5e1]"
        />
      </td>
      <td className="py-1.5 pr-2">
        {/* Read here, set on Groups & CRNs. With sub-rows it is what they add up to. */}
        <span
          aria-label={`Seats in ${group.label}`}
          className="inline-block w-12 px-2 py-1 text-sm tabular-nums text-[#667085]"
          title={majors.length ? "What the sub-rows add up to" : undefined}
        >
          {group.capacity || "—"}
        </span>
      </td>
      {/*
        * The groups this one must be scheduled at the same hour as — TD 1 with PHIL-TD 1,
        * so both majors are busy at once. Any set of the semester; it travels with the
        * timetable request as a constraint on the row.
        */}
      <td className="py-1.5 pr-2">
        <div className={PILL_MENU}>
          <SelectMenu
            label={`Groups ${group.label} runs in parallel with`}
            multiple
            itemNoun="group"
            searchable={siblings.length > 12}
            placeholder="—"
            value={(group.parallelWith ?? []).filter((id) => siblings.some((sibling) => sibling.id === id)).join("\n")}
            onChange={(next) => save.mutate({ parallelWith: next.split("\n").filter(Boolean) })}
            options={siblings.filter((sibling) => sibling.id !== group.id).map((sibling) => ({ value: sibling.id, label: sibling.label }))}
          />
        </div>
      </td>
      {/*
        * The sub-rows: the majors this group holds, each with its seats. A group with none
        * is one thing for everybody. With them, a placement takes one, the fill seats a
        * student on their own, and a course may be one sub-row's and not another's.
        */}
      <td className="py-1.5 pr-2">
        <MajorsEditor group={group} programmes={programmes} pulled={pulled} onChanged={onChanged} />
      </td>
      {nested ? (
        <td className="py-1.5 pr-2">
          {/* Several where the pairing is not one-to-one: Philosophy 2 goes with TD 2 and TD 3. */}
          <div className={PILL_MENU}>
            <SelectMenu
              label={`The groups ${group.label} goes with`}
              multiple
              itemNoun="group"
              value={parentsOf(group).filter((id) => parentGroups.some((candidate) => candidate.id === id)).join("\n")}
              onChange={(value) => save.mutate({ parentGroupIds: value.split("\n").filter(Boolean) })}
              placeholder="None yet"
              options={parentGroups.map((candidate) => ({ value: candidate.id, label: candidate.label }))}
            />
          </div>
          {!parentsOf(group).some((id) => parentGroups.some((candidate) => candidate.id === id)) ? (
            <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-[#a6292f]">
              <AlertTriangle size={10} aria-hidden="true" /> nobody can be placed here
            </span>
          ) : null}
        </td>
      ) : null}
      {/*
        * The major placed here first — L1's TD 3, opened for the physicists. Not a wall:
        * another major goes here once the groups that are nobody's in particular are full.
        */}
      {programmes.length > 1 ? (
        <td className="py-1.5 pr-2">
          <div className={WIDE_MENU}>
            <SelectMenu
              label={`The major ${group.label} takes first`}
              value={group.firstFor ?? ""}
              onChange={(value) => save.mutate({ firstFor: value })}
              options={[
                { value: "", label: "No preference" },
                ...[...new Set([...programmes, ...(group.firstFor ? [group.firstFor] : [])])].map((programme) => ({
                  value: programme,
                  label: programme,
                })),
              ]}
            />
          </div>
        </td>
      ) : null}
      <td className="py-1.5 pr-2 text-right tabular-nums text-[#667085]">{group.assigned || ""}</td>
      <td className="py-1.5 pr-2 text-right">
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

/**
 * The sub-rows of one group, edited in place: a programme from the cohort's vocabulary and
 * its seats per line, a line taken away, a line added. Removing one leaves its students in
 * the group on no sub-row, and the row's count says so until somebody moves them.
 *
 * Always chosen from a list. With students synced it is their majors, and nothing else can
 * be added. Without, it is the majors the schema already uses, and "Another major…" opens a
 * box for one it has never seen, typed as the registrar spells it.
 */
function MajorsEditor({
  group,
  programmes,
  pulled,
  onChanged,
}: {
  group: CatalogueGroup;
  programmes: string[];
  /** True when `programmes` are the synced students' majors: then the list is the whole of it. */
  pulled: boolean;
  onChanged: () => void;
}) {
  const majors = group.majors ?? [];
  const [adding, setAdding] = useState("");
  // The box for a major the list does not have, opened from "Another major…".
  const [typing, setTyping] = useState(false);
  const add = useMutation({
    mutationFn: (program: string) => addMajor(group.id, { program, seats: 0 }),
    onSuccess: () => {
      setAdding("");
      setTyping(false);
      onChanged();
    },
  });
  const remove = useMutation({ mutationFn: (major: CatalogueMajor) => removeMajor(major.id), onSuccess: onChanged });
  const offered = programmes.filter((program) => !majors.some((major) => major.program === program));
  const error = add.error ?? remove.error;
  // A value no programme can have, for the option that opens the box.
  const ANOTHER = "\u0000another";
  return (
    <div className={`${WIDE_MENU} space-y-1`}>
      {majors.map((major) => (
        // Narrow on purpose: the name and its seats, and the remove button over the seats
        // only while the pointer (or the keyboard) is on the line.
        <div key={major.id} className="group relative flex items-center gap-1 text-[13px]">
          <span className="min-w-0 flex-1 truncate text-[#344054]" title={major.program}>
            {shortProgram(major.program)}
          </span>
          <span
            aria-label={`Seats for ${shortProgram(major.program)} in ${group.label}`}
            className="shrink-0 py-0.5 text-right text-xs tabular-nums text-[#667085]"
          >
            {major.seats || "—"}
          </span>
          <button
            type="button"
            aria-label={`Remove the ${shortProgram(major.program)} sub-row from ${group.label}`}
            onClick={() => remove.mutate(major)}
            className="absolute right-0 rounded bg-white p-0.5 text-[#98a2b3] opacity-0 shadow-sm hover:bg-[#fdf3f3] hover:text-[#a6292f] focus:opacity-100 group-hover:opacity-100"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      {typing || (!pulled && offered.length === 0) ? (
        // A major the schema has never used, typed as the registrar spells it —
        // "MATH - Mathematics" — and Enter adds it. Escape goes back to the list.
        <input
          aria-label={`Add a sub-row to ${group.label}`}
          value={adding}
          autoFocus={typing}
          onChange={(event) => setAdding(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setAdding("");
              setTyping(false);
              return;
            }
            if (event.key !== "Enter" || !adding.trim()) return;
            event.preventDefault();
            add.mutate(adding.trim());
          }}
          onBlur={() => {
            if (!adding.trim()) setTyping(false);
          }}
          placeholder="MATH - Mathematics"
          title="A major as the portal spells it, then Enter"
          className="w-full rounded-md border border-dashed border-[#cbd5e1] bg-transparent px-1.5 py-0.5 text-xs text-[#667085]"
        />
      ) : offered.length ? (
        <SelectMenu
          size="small"
          align="start"
          label={`Add a sub-row to ${group.label}`}
          value=""
          placeholder={majors.length ? "+ major" : "Everybody"}
          onChange={(value) => {
            if (value === ANOTHER) setTyping(true);
            else if (value) add.mutate(value);
          }}
          options={[
            ...offered.map((program) => ({ value: program, label: program })),
            ...(pulled ? [] : [{ value: ANOTHER, label: "Another major…" }]),
          ]}
        />
      ) : null}
      {error ? <p className="text-xs text-[#a6292f]">{(error as Error).message}</p> : null}
    </div>
  );
}
