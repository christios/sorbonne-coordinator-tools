import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet, ListTree, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { AddFromPortal } from "@/components/AddFromPortal";
import { ClashPanel } from "@/components/ClashPanel";
import { CourseCard } from "@/components/CourseCard";
import type { FillReport } from "@/components/FillBlock";
import { GroupSetsEditor } from "@/components/GroupSetsEditor";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { TableFilterBar } from "@/components/TableFilterBar";
import { WorkbookReview } from "@/components/WorkbookReview";
import { WorkbookTools } from "@/components/WorkbookTools";
import { buildCards, cardColumns } from "@/services/courseCards";
import { fetchActiveCourses, fetchActiveCrns, fetchActiveTeachers, fetchTermCrns } from "@/services/portalLists";
import { fetchPublication } from "@/services/publication";
import { clashesIn } from "@/services/publicationView";
import { type Cohort, type WorkbookApplied, applyWorkbook, fetchCourseCards } from "@/services/studentDatabase";
import { optionsFor, plainCellText } from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import { downloadTimetableWorkbook, requestSheets } from "@/services/timetableExport";
import { fetchTimetableTerms } from "@/services/timetables";
import type { Operation, WorkbookPreview } from "@/services/workbookReview";

/**
 * Groups & CRNs as the department's timetable request: one list of course cards.
 *
 * Every cohort, every semester, one card per course, narrowed by the same filter chips
 * and search box the tables have — and opened to show the sections inside. Group sets
 * and the files are one press away, since both belong to a cohort and a semester rather
 * than to a card.
 */
export function CourseCards({ cohorts, onShowStudents }: { cohorts: Cohort[]; onShowStudents?: (studentIds: string[]) => void }) {
  const client = useQueryClient();
  const catalogues = useQuery({ queryKey: ["course-cards"], queryFn: fetchCourseCards });
  const terms = useQuery({ queryKey: ["timetable-terms"], queryFn: fetchTimetableTerms, retry: false });
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  // The department's courses: a card's title, UE and parent CRN are read from here.
  const activeCourses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  // The register: what each CRN hangs from, which the workbook's Parent CRN column is.
  const registered = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  const parentOf = useMemo(
    () => new Map((registered.data ?? []).filter((row) => row.parentCrn).map((row) => [row.crn, row.parentCrn])),
    [registered.data],
  );
  const termName = (termId: string) => (terms.data ?? []).find((term) => term.id === termId)?.name ?? (termId ? "unknown semester" : "");
  const cards = useMemo(() => buildCards(catalogues.data ?? [], termName, activeCourses.data ?? [], parentOf), [catalogues.data, terms.data, activeCourses.data, parentOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const termIds = useMemo(() => [...new Set(cards.map((card) => card.termId).filter(Boolean))], [cards]);

  // What the platform makes of each semester, and what the portal lists for it: one
  // fetch per semester on the page, whichever cards are open.
  const publications = useQueries({
    queries: termIds.map((termId) => ({ queryKey: ["publication", termId], queryFn: () => fetchPublication(termId), retry: false })),
  });
  const portals = useQueries({
    queries: termIds.map((termId) => ({ queryKey: ["portal-crns", termId], queryFn: () => fetchTermCrns(termId), retry: false })),
  });
  const publicationOf = (termId: string) => publications[termIds.indexOf(termId)]?.data ?? null;
  const portalOf = (termId: string) => {
    const held = portals[termIds.indexOf(termId)]?.data;
    return held?.portalTermCode ? held : null;
  };

  const nameOf = (teacherId: string) => (teachers.data ?? []).find((teacher) => teacher.id === teacherId)?.fullName ?? "";
  const columns = useMemo(() => cardColumns(nameOf), [teachers.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [filters, setFilters] = useState<FilterModel[]>([]);
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const searched = needle ? cards.filter((card) => columns.some((column) => plainCellText(card, column).toLowerCase().includes(needle))) : cards;
    return applyFilters(searched, columns, filters);
  }, [cards, columns, filters, query]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [editingSets, setEditingSets] = useState<{ cohortId: string; termId: string } | null>(null);
  const [tools, setTools] = useState(false);
  const [adding, setAdding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [requestTerm, setRequestTerm] = useState("");
  const [building, setBuilding] = useState(false);
  const [preview, setPreview] = useState<{ preview: WorkbookPreview; cohort: Cohort; termId: string } | null>(null);
  const [applied, setApplied] = useState<(WorkbookApplied & { approved: number }) | null>(null);
  const [filled, setFilled] = useState<FillReport | null>(null);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["course-cards"] });
    client.invalidateQueries({ queryKey: ["active-courses"] });
    client.invalidateQueries({ queryKey: ["active-crns"] });
    client.invalidateQueries({ queryKey: ["catalogue"] });
    client.invalidateQueries({ queryKey: ["publication"] });
    client.invalidateQueries({ queryKey: ["assignments"] });
    client.invalidateQueries({ queryKey: ["students"] });
  };
  const apply = useMutation({
    mutationFn: ({ operations }: { operations: Operation[]; approved: number }) => applyWorkbook(preview!.cohort.id, preview!.termId, operations),
    onSuccess: (result, variables) => {
      setApplied({ ...result, approved: variables.approved });
      setPreview(null);
      refresh();
    },
  });

  if (catalogues.isLoading) return <ScreenLoading label="Loading the courses…" />;
  if (catalogues.error) return <p role="alert" className="text-sm text-[#a6292f]">{(catalogues.error as Error).message}</p>;

  if (preview) {
    return <WorkbookReview preview={preview.preview} busy={apply.isPending} error={apply.error?.message ?? null} onApply={(operations, approved) => apply.mutate({ operations, approved })} onCancel={() => setPreview(null)} />;
  }

  // The clash panel belongs to one cohort in one semester; it shows when the list is one.
  const pairs = [...new Set(visible.map((card) => `${card.cohortId}|${card.termId}`))];
  const single = pairs.length === 1 ? visible[0] : null;
  const clashes = single ? (publicationOf(single.termId) ? clashesIn(publicationOf(single.termId)!, single.cohortId) : null) : null;
  const button = "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]";

  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <TableFilterBar columns={columns} filters={filters} optionsFor={(column) => optionsFor(cards, column)} onChange={setFilters} />
        <button type="button" onClick={() => setEditingSets({ cohortId: single?.cohortId ?? cohorts[0]?.id ?? "", termId: single?.termId ?? "" })} className={button}>
          <ListTree size={15} aria-hidden="true" /> Group sets
        </button>
        <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#183f63]">
          <Plus size={15} aria-hidden="true" /> Add from portal
        </button>
        <button type="button" onClick={() => setTools(true)} className={button}>
          <FileSpreadsheet size={15} aria-hidden="true" /> Workbook and lists
        </button>
        <button
          type="button"
          onClick={() => {
            setRequestTerm(single?.termId || termIds[0] || "");
            setRequesting(true);
          }}
          className={button}
        >
          <Download size={15} aria-hidden="true" /> Timetable request
        </button>
        <div className="ml-auto flex items-center gap-2">
          <label className="relative block w-full sm:w-64">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input aria-label="Search courses" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search courses, teachers, CRNs" className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm" />
          </label>
          <button type="button" aria-label={open.size ? "Collapse all" : "Expand all"} title={open.size ? "Collapse all" : "Expand all"} onClick={() => setOpen(open.size ? new Set() : new Set(visible.map((card) => card.key)))} className="rounded-md border border-[#b7bec8] bg-white p-2 text-[#667085] hover:bg-[#f8fafc]">
            {open.size ? <ChevronsDownUp size={16} aria-hidden="true" /> : <ChevronsUpDown size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <p className="mt-2 text-xs text-[#98a2b3]">
        {cards.length} course{cards.length === 1 ? "" : "s"}
        {visible.length !== cards.length ? `, ${visible.length} shown` : ""} · {pairs.length} cohort-semester{pairs.length === 1 ? "" : "s"}
      </p>

      {applied ? (
        <div className="mt-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-3 text-sm text-[#2f6b3d]">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden="true" /> {applied.approved} approved change(s) applied</p>
          <p className="mt-1 leading-6">{applied.groups} group(s), {applied.courses} course(s) and {applied.cells} CRN(s) written, and {applied.placements} student placement(s).</p>
        </div>
      ) : null}
      {filled ? (
        <p className="mt-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {filled.assigned} student{filled.assigned === 1 ? "" : "s"} placed in {filled.scopeCode}{filled.unplaced ? `; ${filled.unplaced} could not be placed` : ""}.
        </p>
      ) : null}

      {clashes ? <ClashPanel clashes={clashes} onShow={onShowStudents} /> : null}

      <div className="mt-4 space-y-3">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center text-sm text-[#667085]">
            {cards.length ? "No course matches the filters." : "No courses yet. Add one from the portal, or open Group sets to define a semester's sets and their courses."}
          </p>
        ) : (
          visible.map((card) => {
            const publication = publicationOf(card.termId);
            const report = publication?.cohorts.find((entry) => entry.cohortId === card.cohortId) ?? null;
            return (
              <CourseCard
                key={card.key}
                card={card}
                open={open.has(card.key)}
                onToggle={() =>
                  setOpen((current) => {
                    const next = new Set(current);
                    if (next.has(card.key)) next.delete(card.key);
                    else next.add(card.key);
                    return next;
                  })
                }
                cohort={cohorts.find((cohort) => cohort.id === card.cohortId) ?? null}
                teachers={teachers.data ?? []}
                portal={portalOf(card.termId)}
                validation={publication?.validation ?? {}}
                unassigned={report?.unassigned ?? {}}
                clashes={publication ? clashesIn(publication, card.cohortId) : null}
                onChanged={refresh}
                onFilled={(reportOfFill) => {
                  setFilled(reportOfFill);
                  refresh();
                }}
              />
            );
          })
        )}
      </div>

      {editingSets ? (
        <GroupSetsEditor open cohorts={cohorts} terms={terms.data ?? []} activeCourses={activeCourses.data ?? []} initialCohortId={editingSets.cohortId} initialTermId={editingSets.termId} onClose={() => setEditingSets(null)} onChanged={refresh} />
      ) : null}
      <Modal
        open={requesting}
        title="Timetable request"
        description="The workbook the timetabler gets: a sheet per cohort for one semester, the CRN table, teacher hours."
        onClose={() => setRequesting(false)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setRequesting(false)} className="text-sm font-semibold text-[#667085]">Cancel</button>
            <button
              type="button"
              disabled={!requestTerm || building}
              onClick={async () => {
                setBuilding(true);
                try {
                  const sheets = requestSheets(
                    cards,
                    requestTerm,
                    termName(requestTerm),
                    // The Degree column: the cohort's majors as the portal codes them, else its name.
                    (cohortId) => {
                      const cohort = cohorts.find((candidate) => candidate.id === cohortId);
                      return cohort?.majors.join(" / ") || cohort?.name || "";
                    },
                    nameOf,
                  );
                  await downloadTimetableWorkbook(sheets, `Time-Tables-${termName(requestTerm).replace(/[^A-Za-z0-9]+/g, "-")}.xlsx`);
                  setRequesting(false);
                } finally {
                  setBuilding(false);
                }
              }}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {building ? "Building…" : "Download"}
            </button>
          </div>
        }
      >
        <SelectMenu label="Semester" value={requestTerm} onChange={setRequestTerm} placeholder="Which semester…" options={termIds.map((id) => ({ value: id, label: termName(id) }))} />
        {requestTerm ? (
          <p className="mt-3 text-sm text-[#667085]">
            {cards.filter((card) => card.termId === requestTerm).length} course{cards.filter((card) => card.termId === requestTerm).length === 1 ? "" : "s"} across{" "}
            {new Set(cards.filter((card) => card.termId === requestTerm).map((card) => card.cohortId)).size} cohort(s). Teachers come from Active teachers; a section nobody has chosen keeps the portal&apos;s name.
          </p>
        ) : null}
      </Modal>
      {adding ? <AddFromPortal open cohorts={cohorts} terms={terms.data ?? []} activeCourses={activeCourses.data ?? []} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); refresh(); }} /> : null}
      <WorkbookTools open={tools} cohorts={cohorts} terms={terms.data ?? []} onClose={() => setTools(false)} onPreview={(held, cohort, termId) => { setTools(false); setPreview({ preview: held, cohort, termId }); }} />
    </section>
  );
}
