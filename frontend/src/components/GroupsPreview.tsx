import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, LayoutList, Table2, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import { LabelledPicker } from "@/components/LabelledPicker";
import { buildCards, type Card, type SectionRow } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveCrns } from "@/services/portalLists";
import { fetchPublication, type Publication } from "@/services/publication";
import { clashesIn } from "@/services/publicationView";
import { fetchCourseCards, type Cohort } from "@/services/studentDatabase";
import { fetchTimetableTerms } from "@/services/timetables";

/*
 * Two readings of the same page, side by side, to be chosen between.
 *
 * Nothing here writes: it is a drawing of what the Groups & CRNs page could be, made
 * from the real semester so the judgement is about this department's data and not about
 * a mock-up's tidy sample. The live page is untouched.
 */

type Trouble = { crnless: number; teacherless: number; unplaced: number; clashes: number };

/** What is wrong with one course, counted rather than recited. */
function troubleOf(card: Card): Trouble {
  const rows = card.sets.flatMap((set) => set.rows).filter((row) => !row.section?.retired);
  return {
    crnless: rows.filter((row) => !row.section?.crn).length,
    teacherless: rows.filter((row) => row.section?.crn && !row.section.teacherId && !row.section.teacher).length,
    // Not a fact about the course: the students with no group belong to the set, and
    // saying it on every course of that set said the same number nine times over.
    unplaced: 0,
    clashes: 0,
  };
}

const dot = (trouble: Trouble) =>
  trouble.crnless ? "bg-[#a6292f]" : trouble.teacherless || trouble.unplaced ? "bg-[#d99b1c]" : "bg-[#2e7d55]";

/** "room 12 · avoid Fridays" — what a section asks of the timetable, in one line. */
function asks(row: SectionRow): string {
  const section = row.section;
  if (!section) return "";
  return [section.roomPref, section.dayPref, section.timePref, section.constraints, section.comments]
    .filter(Boolean)
    .join(" · ");
}

function Marks({ trouble }: { trouble: Trouble }) {
  const marks = [
    trouble.crnless ? { key: "crn", text: `${trouble.crnless} without CRN`, tone: "text-[#a6292f] bg-[#fdf3f3]" } : null,
    trouble.teacherless ? { key: "who", text: `${trouble.teacherless} unstaffed`, tone: "text-[#8a6116] bg-[#fdf9ee]" } : null,
  ].filter(Boolean) as { key: string; text: string; tone: string }[];
  if (!marks.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {marks.map((mark) => (
        <span key={mark.key} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${mark.tone}`}>
          {mark.text}
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ the sheet */

/**
 * One: the request as a sheet.
 *
 * The workbook this page replaces is a sheet, and so is the answer the timetabler wants
 * back. Every section is a row; a course is a heading over its own rows rather than a box
 * around them, so fifteen courses are read by moving the eye down a single column instead
 * of opening fifteen things.
 */
function Sheet({ cards }: { cards: Card[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#e4e8ef] bg-white">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-[#fbfcfe] text-[11px] uppercase tracking-wide text-[#8a94a4]">
          <tr className="border-b border-[#e4e8ef]">
            <th className="py-2 pl-4 pr-3 font-semibold">Section</th>
            <th className="py-2 pr-3 font-semibold">CRN</th>
            <th className="py-2 pr-3 font-semibold">Teacher</th>
            <th className="py-2 pr-3 text-right font-semibold">Students</th>
            <th className="py-2 pr-3 text-right font-semibold">Hours</th>
            <th className="py-2 pr-4 font-semibold">Asks of the timetable</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const trouble = troubleOf(card);
            return (
              <Fragment key={card.key}>
                <tr className="border-b border-t border-[#eef1f5] bg-[#f8fafc]">
                  <th colSpan={6} className="py-2 pl-4 pr-4 text-left font-normal">
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot(trouble)}`} aria-hidden="true" />
                      <span className="font-semibold text-[#171717]">{card.code}</span>
                      <span className="text-[#344054]">{card.name || "untitled"}</span>
                      {card.ue ? <span className="text-xs text-[#98a2b3]">{card.ue}</span> : null}
                      {card.active?.mutualized === "yes" ? (
                        <span className="rounded bg-[#e8edf3] px-1.5 py-0.5 text-[11px] font-medium text-[#1f4e79]">Mutualized</span>
                      ) : null}
                      <span className="ml-auto flex items-center gap-2">
                        <Marks trouble={trouble} />
                      </span>
                    </span>
                  </th>
                </tr>
                {card.sets.flatMap((set) =>
                  set.rows.map((row) => (
                    <tr key={`${set.scope.id}|${row.group.id}`} className={`border-b border-[#f2f4f7] ${row.section?.retired ? "text-[#c8d0da]" : ""}`}>
                      <td className="py-1.5 pl-4 pr-3">
                        <span className="font-medium text-[#1f4e79]">{set.scope.code}</span>{" "}
                        <span className="text-[#344054]">{row.group.label}</span>
                        {row.section?.retired ? <span className="ml-1.5 text-[11px]">retired</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row.section?.crn || <span className="text-[#a6292f]">—</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-[#667085]">
                        {row.section?.teacher || <span className="text-[#c8d0da]">nobody yet</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-[#667085]">{row.group.assigned || ""}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-[#98a2b3]">{row.section?.hours || ""}</td>
                      <td className="max-w-[22rem] truncate py-1.5 pr-4 text-xs text-[#98a2b3]" title={asks(row)}>
                        {asks(row)}
                      </td>
                    </tr>
                  )),
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------------------------------------------- the focus */

/**
 * Two: one course at a time.
 *
 * The list on the left is only names and a state; everything a course has to say is said
 * on the right, where there is room to say it without a table that scrolls sideways. The
 * sections become small blocks rather than a wide row, which is what lets a constraint be
 * read as a sentence instead of squeezed into a column.
 */
function Focus({ cards, unassigned }: { cards: Card[]; unassigned: Record<string, string[]> }) {
  const [chosenKey, setChosenKey] = useState("");
  const chosen = cards.find((card) => card.key === chosenKey) ?? cards[0] ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[17rem_1fr]">
      <nav className="max-h-[34rem] overflow-y-auto rounded-lg border border-[#e4e8ef] bg-white p-1.5">
        {cards.map((card) => {
          const trouble = troubleOf(card);
          const active = card.key === chosen?.key;
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => setChosenKey(card.key)}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${active ? "bg-[#e8edf3]" : "hover:bg-[#f6f8fb]"}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(trouble)}`} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm ${active ? "font-semibold text-[#1f4e79]" : "text-[#344054]"}`}>{card.code}</span>
                <span className="block truncate text-xs text-[#98a2b3]">{card.name || "untitled"}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-[#98a2b3]">
                {card.sets.reduce((total, set) => total + set.rows.length, 0)}
              </span>
            </button>
          );
        })}
      </nav>

      {chosen ? (
        <section className="min-w-0 rounded-lg border border-[#e4e8ef] bg-white p-5">
          <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[#eef1f5] pb-4">
            <h3 className="text-lg font-semibold text-[#171717]">{chosen.code}</h3>
            <p className="text-[#344054]">{chosen.name || "untitled"}</p>
            {chosen.ue ? <span className="text-xs text-[#98a2b3]">{chosen.ue}</span> : null}
            {chosen.active?.mutualized === "yes" ? (
              <span className="rounded bg-[#e8edf3] px-1.5 py-0.5 text-[11px] font-medium text-[#1f4e79]">Mutualized</span>
            ) : null}
            <span className="ml-auto"><Marks trouble={troubleOf(chosen)} /></span>
          </header>

          <div className="mt-4 space-y-5">
            {chosen.sets.map((set) => (
              <div key={set.scope.id}>
                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-semibold text-[#1f4e79]">{set.scope.code}</span>
                  {/* Most sets are called after their code, and saying "CM · CM" says nothing. */}
                  {set.scope.name && set.scope.name !== set.scope.code ? (
                    <span className="text-[#667085]">{set.scope.name}</span>
                  ) : null}
                  {set.course.component ? <span className="text-xs text-[#98a2b3]">{set.course.component}</span> : null}
                  {unassigned[set.scope.code]?.length ? (
                    <span className="rounded bg-[#fdf9ee] px-1.5 py-0.5 text-[11px] font-medium text-[#8a6116]">
                      {unassigned[set.scope.code].length} in no group
                    </span>
                  ) : null}
                </p>

                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {set.rows.map((row) => (
                    <article
                      key={row.group.id}
                      className={`rounded-md border px-3 py-2.5 ${row.section?.retired ? "border-dashed border-[#e4e8ef] text-[#c8d0da]" : "border-[#e4e8ef]"}`}
                    >
                      <p className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-[#344054]">{set.scope.code} {row.group.label}</span>
                        <span className={`text-sm tabular-nums ${row.section?.crn ? "text-[#667085]" : "text-[#a6292f]"}`}>
                          {row.section?.crn || "no CRN"}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-[#667085]">
                        {row.section?.teacher || <span className="text-[#c8d0da]">nobody yet</span>}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-[#98a2b3]">
                        {row.group.assigned ? <span>{row.group.assigned} students</span> : null}
                        {row.section?.hours ? <span>{row.section.hours} h</span> : null}
                        {row.section?.duration ? <span>{row.section.duration} h/session</span> : null}
                      </p>
                      {asks(row) ? <p className="mt-1 text-[11px] leading-4 text-[#98a2b3]">{asks(row)}</p> : null}
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- the warnings */

/**
 * The warnings, as a strip that opens rather than a wall that shouts.
 *
 * Twenty-six clashes recited in full is not a warning, it is a page nobody reads. The
 * strip says how many of each kind there are — which is what a coordinator decides on —
 * and opens the one kind being dealt with, a few at a time.
 */
function Warnings({ clashes, unassigned }: { clashes: ReturnType<typeof clashesIn>; unassigned: Record<string, string[]> }) {
  const [open, setOpen] = useState<"clashes" | "unplaced" | "">("");
  const left = Object.entries(unassigned).filter(([, ids]) => ids.length);
  const total = left.reduce((sum, [, ids]) => sum + ids.length, 0);
  if (!clashes.length && !total) return null;

  const pill = "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold";
  return (
    <section className="mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {clashes.length ? (
          <button
            type="button"
            onClick={() => setOpen((was) => (was === "clashes" ? "" : "clashes"))}
            className={`${pill} ${open === "clashes" ? "border-[#e8d9ac] bg-[#fdf9ee] text-[#8a6116]" : "border-[#e4e8ef] bg-white text-[#667085] hover:bg-[#fbfcfe]"}`}
          >
            <AlertTriangle size={13} aria-hidden="true" />
            {clashes.length} timetable clash{clashes.length === 1 ? "" : "es"}
            <ChevronRight size={13} className={open === "clashes" ? "rotate-90" : ""} aria-hidden="true" />
          </button>
        ) : null}
        {total ? (
          <button
            type="button"
            onClick={() => setOpen((was) => (was === "unplaced" ? "" : "unplaced"))}
            className={`${pill} ${open === "unplaced" ? "border-[#e8d9ac] bg-[#fdf9ee] text-[#8a6116]" : "border-[#e4e8ef] bg-white text-[#667085] hover:bg-[#fbfcfe]"}`}
          >
            {total} placement{total === 1 ? "" : "s"} to make
            <ChevronRight size={13} className={open === "unplaced" ? "rotate-90" : ""} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {open === "clashes" ? (
        <ul className="mt-2 divide-y divide-[#f2f4f7] rounded-lg border border-[#e4e8ef] bg-white text-sm">
          {clashes.slice(0, 8).map((clash) => (
            <li key={clash.groups.map((group) => group.id).join("|")} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2">
              <span className="font-medium text-[#344054]">{clash.groups.map((group) => `${group.scopeCode} ${group.label}`).join(" × ")}</span>
              <span className="text-xs text-[#98a2b3]">{clash.windows.length} overlapping hour{clash.windows.length === 1 ? "" : "s"}</span>
              <span className="ml-auto text-xs text-[#8a6116]">
                {clash.students.length ? `${clash.students.length} student${clash.students.length === 1 ? "" : "s"} in both` : "nobody in both"}
              </span>
            </li>
          ))}
          {clashes.length > 8 ? (
            <li className="px-4 py-2 text-xs text-[#98a2b3]">and {clashes.length - 8} more</li>
          ) : null}
        </ul>
      ) : null}

      {open === "unplaced" ? (
        <ul className="mt-2 divide-y divide-[#f2f4f7] rounded-lg border border-[#e4e8ef] bg-white text-sm">
          {left.map(([code, ids]) => (
            <li key={code} className="flex items-baseline gap-3 px-4 py-2">
              <span className="font-medium text-[#1f4e79]">{code}</span>
              <span className="text-[#667085]">{ids.length} student{ids.length === 1 ? "" : "s"} with no group</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ the page */

export function GroupsPreview({ cohorts, onClose }: { cohorts: Cohort[]; onClose: () => void }) {
  const [layout, setLayout] = useState<"sheet" | "focus">("sheet");
  const [cohortId, setCohortId] = useState("");

  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const active = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const register = useQuery({ queryKey: ["active-crns", ""], queryFn: () => fetchActiveCrns(), retry: false });

  const cards = useMemo(() => {
    const termName = (id: string) => (terms.data ?? []).find((term) => term.id === id)?.name ?? "";
    const parents = new Map((register.data ?? []).map((entry) => [entry.crn, entry.parentCrn]));
    return buildCards(catalogues.data ?? [], termName, active.data ?? [], parents);
  }, [catalogues.data, terms.data, active.data, register.data]);

  const chosen = cohorts.find((cohort) => cohort.id === cohortId) ?? cohorts.find((cohort) => cards.some((card) => card.cohortId === cohort.id)) ?? cohorts[0] ?? null;
  const mine = cards.filter((card) => card.cohortId === chosen?.id);
  const termIds = [...new Set(mine.map((card) => card.termId).filter(Boolean))];
  const publications = useQueries({
    queries: termIds.map((termId) => ({ queryKey: ["publication", termId], queryFn: () => fetchPublication(termId), retry: false })),
  });
  const publication = (publications[0]?.data ?? null) as Publication | null;
  const report = publication?.cohorts.find((entry) => entry.cohortId === chosen?.id) ?? null;
  const clashes = publication && chosen ? clashesIn(publication, chosen.id) : [];

  if (catalogues.isLoading) return <ScreenLoading label="Drawing the ideas…" />;

  const tab = "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold";
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <LabelledPicker label="Cohort">
          <SelectMenu
            label="Cohort"
            value={chosen?.id ?? ""}
            onChange={setCohortId}
            options={cohorts.map((cohort) => ({ value: cohort.id, label: cohort.name }))}
          />
        </LabelledPicker>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-[#e4e8ef] bg-white p-1">
            <button type="button" onClick={() => setLayout("sheet")} className={`${tab} ${layout === "sheet" ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}>
              <Table2 size={14} aria-hidden="true" /> The sheet
            </button>
            <button type="button" onClick={() => setLayout("focus")} className={`${tab} ${layout === "focus" ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}>
              <LayoutList size={14} aria-hidden="true" /> One course at a time
            </button>
          </div>
          <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">
            <X size={14} aria-hidden="true" /> Back to the real page
          </button>
        </div>
      </div>

      <Warnings clashes={clashes} unassigned={report?.unassigned ?? {}} />

      {layout === "sheet" ? (
        <Sheet cards={mine} />
      ) : (
        <Focus cards={mine} unassigned={report?.unassigned ?? {}} />
      )}

      <p className="mt-4 text-xs text-[#98a2b3]">
        A drawing, not the page: nothing here writes anything. {mine.length} course{mine.length === 1 ? "" : "s"} of{" "}
        {chosen?.name ?? "this cohort"}, read from the real semester.
      </p>
    </section>
  );
}
