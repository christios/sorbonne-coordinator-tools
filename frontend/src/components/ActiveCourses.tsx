import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookPlus, Link2Off, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { Modal } from "@/components/Modal";
import { ScreenLoading } from "@/components/ScreenLoading";
import { SelectMenu } from "@/components/SelectMenu";
import {
  type ActiveCourse,
  type ActiveCrn,
  addActiveCourses,
  addActiveCrns,
  fetchActiveCourses,
  fetchActiveCrns,
  fetchRegisterCheck,
  removeActiveCrn,
  setParentCrn,
  updateActiveCourse,
} from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

const COLUMNS: GridColumn<ActiveCrn>[] = [
  { id: "crn", displayName: "CRN", type: "text", accessor: (row) => row.crn, required: true, defaultWidth: 90 },
  { id: "courseCode", displayName: "Course", type: "option", accessor: (row) => row.courseCode, required: true, defaultWidth: 120 },
  { id: "portalTitle", displayName: "Section", type: "text", accessor: (row) => row.portalTitle, defaultWidth: 240 },
  { id: "parentCrn", displayName: "Parent CRN", type: "text", accessor: (row) => row.parentCrn, defaultWidth: 130 },
  {
    id: "role",
    displayName: "Role",
    // Both at once is possible — a CRN can hang from one and be hung from by another —
    // so it filters as "include any of" rather than as one word.
    type: "multiOption",
    accessor: (row) => rolesOf(row),
    display: (row) => rolesOf(row).join(" · ") || "On its own",
    defaultWidth: 130,
  },
  { id: "ue", displayName: "UE", type: "option", accessor: (row) => row.ue, defaultWidth: 110 },
  { id: "teacherName", displayName: "Teacher", type: "option", accessor: (row) => row.teacherName, defaultWidth: 190 },
  { id: "registered", displayName: "Registered", type: "number", accessor: (row) => row.registered, defaultWidth: 100 },
  { id: "usedBy", displayName: "On cards", type: "number", accessor: (row) => row.usedBy, defaultWidth: 90 },
  {
    id: "portalStatus",
    displayName: "Portal",
    type: "option",
    accessor: (row) => (row.portalStatus === "in_portal" ? "Listed" : "Gone from the portal"),
    defaultWidth: 150,
  },
  { id: "courseTitle", displayName: "Course title", type: "text", accessor: (row) => row.courseTitle, defaultWidth: 220 },
  { id: "sequence", displayName: "Seq.", type: "text", accessor: (row) => row.sequence, defaultWidth: 70 },
  { id: "partOfTerm", displayName: "Part of term", type: "option", accessor: (row) => row.partOfTerm, defaultWidth: 150 },
  { id: "credits", displayName: "Credits", type: "text", accessor: (row) => row.credits, defaultWidth: 80 },
  { id: "contactHours", displayName: "Contact hrs", type: "text", accessor: (row) => row.contactHours, defaultWidth: 100 },
  { id: "termCode", displayName: "Term", type: "option", accessor: (row) => row.termCode, defaultWidth: 90 },
  { id: "addedAt", displayName: "Added", type: "date", accessor: (row) => row.addedAt, display: (row) => row.addedAt.slice(0, 10), defaultWidth: 110 },
  { id: "addedBy", displayName: "Added by", type: "text", accessor: (row) => row.addedBy, defaultWidth: 190 },
];
const SHOWN = ["crn", "courseCode", "portalTitle", "role", "parentCrn", "ue", "teacherName", "registered", "usedBy", "portalStatus"];

/**
 * What this CRN is within the course: the one the sections hang from, one of those
 * sections, or neither — a CRN nobody has linked either way yet.
 */
function rolesOf(row: ActiveCrn): string[] {
  const roles = [];
  if (row.childCount) roles.push("Parent");
  if (row.parentCrn) roles.push("Child");
  return roles;
}

const idOf = (row: ActiveCrn) => row.id;
const labelOf = (row: ActiveCrn) => `${row.courseCode} ${row.crn}`;

/**
 * The department's register of CRNs.
 *
 * The portal's Courses page is the registrar's list; this is ours, drawn from it. One row
 * per CRN we teach under: which course it belongs to, what it hangs from, and the UE of
 * the course. Every row is a link — to the portal's entry for the CRN, and to the portal's
 * entry for its parent — so a link that leads nowhere shows as one, and the banner says
 * where the registrar's list has moved away from the register since anyone last looked.
 */
export function ActiveCourses() {
  const client = useQueryClient();
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ActiveCrn | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const crns = useQuery({ queryKey: ["active-crns"], queryFn: () => fetchActiveCrns() });
  const courses = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const check = useQuery({ queryKey: ["register-check", term], queryFn: () => fetchRegisterCheck(term), retry: false });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["active-crns"] });
    client.invalidateQueries({ queryKey: ["active-courses"] });
    client.invalidateQueries({ queryKey: ["register-check"] });
    client.invalidateQueries({ queryKey: ["course-cards"] });
  };
  const addCourse = useMutation({
    mutationFn: (course: { courseCode: string; title: string }) => addActiveCourses({ byHand: [course] }),
    onSuccess: () => {
      setAdding(false);
      refresh();
    },
  });
  const takeIn = useMutation({
    mutationFn: (rows: { termCode: string; crn: string; courseCode: string }[]) => addActiveCrns({ crns: rows }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await removeActiveCrn(id);
    },
    onSuccess: () => {
      setSelected(new Set());
      setConfirmRemove(false);
      refresh();
    },
  });

  const held = useMemo(() => crns.data ?? [], [crns.data]);
  const terms = useMemo(() => [...new Set(held.map((row) => row.termCode))].sort().reverse(), [held]);
  useEffect(() => {
    if (terms.length && !terms.includes(term)) setTerm(terms[0]);
  }, [terms, term]);
  const rows = useMemo(() => held.filter((row) => !term || row.termCode === term), [held, term]);
  const byCourse = useMemo(() => new Map((courses.data ?? []).map((course) => [course.courseCode, course])), [courses.data]);

  const renderCell = (row: ActiveCrn, column: GridColumn<ActiveCrn>) => {
    if (column.id === "portalStatus") {
      return row.portalStatus === "in_portal" ? (
        <StatePill tone="good">Listed</StatePill>
      ) : (
        <StatePill tone="bad">Gone from the portal</StatePill>
      );
    }
    if (column.id === "parentCrn") {
      if (!row.parentCrn) return <span className="text-[#c8d0da]">— none yet</span>;
      return (
        <span className="inline-flex items-center gap-1 tabular-nums" title={row.parentTitle || undefined}>
          {row.parentCrn}
          {row.parentStatus !== "in_portal" ? (
            <Link2Off size={12} className="text-[#a6292f]" aria-label="Not a CRN the portal lists" />
          ) : null}
        </span>
      );
    }
    if (column.id === "role") {
      const roles = rolesOf(row);
      if (!roles.length) return <span className="text-[#c8d0da]">On its own</span>;
      return (
        <span className="flex flex-wrap gap-1">
          {row.childCount ? (
            <StatePill tone="accent">Parent of {row.childCount}</StatePill>
          ) : null}
          {row.parentCrn ? <StatePill tone="muted">Child</StatePill> : null}
        </span>
      );
    }
    if (column.id === "ue" && !row.ue) return <span className="text-[#c8d0da]">—</span>;
    return undefined;
  };

  const report = check.data;
  const attention =
    (report?.gone.length ?? 0) + (report?.arrived.length ?? 0) + (report?.unregistered.length ?? 0);

  return (
    <section>
      {crns.isLoading ? (
        <ScreenLoading label="Reading the register…" />
      ) : crns.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(crns.error as Error).message}</p>
      ) : (
        <>
          {report && attention ? (
            <RegisterBanner
              report={report}
              busy={takeIn.isPending}
              onTakeIn={() =>
                takeIn.mutate(report.arrived.map((row) => ({ termCode: row.termCode, crn: row.crn, courseCode: row.courseCode })))
              }
            />
          ) : null}

          <ListGrid
            columns={COLUMNS}
            rows={rows}
            idOf={idOf}
            labelOf={labelOf}
            layoutKey="scen-columns:active-crns:v1"
            presetKey="scen-copy-presets:active-crns:v1"
            shown={SHOWN}
            initialSort={{ key: "courseCode", ascending: true }}
            searchLabel="Search the register"
            noun="CRNs"
            selected={selected}
            onSelectedChange={setSelected}
            renderCell={renderCell}
            onRowClick={setEditing}
            empty="Nothing registered yet. Choose the department's courses on the Courses page and their CRNs come with them."
            toolbar={
              <>
                {terms.length > 1 ? (
                  <div className="w-40">
                    <SelectMenu label="Term" value={term} onChange={setTerm} options={terms.map((code) => ({ value: code, label: code }))} />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    addCourse.reset();
                    setAdding(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
                >
                  <BookPlus size={15} aria-hidden="true" /> Add a course by hand
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0 || remove.isPending}
                  onClick={() => setConfirmRemove(true)}
                  className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:opacity-50"
                >
                  <Trash2 size={15} aria-hidden="true" /> {selected.size ? `Remove ${selected.size}` : "Remove"}
                </button>
                {remove.error ? <span role="alert" className="text-sm text-[#a6292f]">{(remove.error as Error).message}</span> : null}
              </>
            }
          />

          <p className="mt-2 text-xs text-[#98a2b3]">
            {(courses.data ?? []).length} course{(courses.data ?? []).length === 1 ? "" : "s"} on the department&apos;s list,
            {" "}
            {rows.length} of their CRNs registered{term ? ` for ${term}` : ""}. Press a row to say what it hangs from.
          </p>
        </>
      )}

      <ByHandDialog open={adding} busy={addCourse.isPending} onAdd={(course) => addCourse.mutate(course)} onClose={() => setAdding(false)} />

      {editing ? (
        <CrnDialog
          row={editing}
          course={byCourse.get(editing.courseCode) ?? null}
          siblings={held.filter((row) => row.courseCode === editing.courseCode && row.termCode === editing.termCode)}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      ) : null}

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${selected.size} CRN(s) from the register?`}
        description="They stay in the portal's list, and their course stays on the department's. A course card still teaching under one will be flagged as unregistered."
        confirmLabel="Remove"
        onConfirm={() => remove.mutate([...selected])}
        onClose={() => setConfirmRemove(false)}
      />
    </section>
  );
}

/**
 * Where the registrar's list and the register disagree — the same idea as the Cohorts
 * page's banner, for CRNs rather than students: what we hold that the portal has dropped,
 * what it has made for our courses that nobody has taken in, and what a card teaches
 * under a CRN nobody registered.
 */
function RegisterBanner({
  report,
  busy,
  onTakeIn,
}: {
  report: {
    gone: { crn: string; courseCode: string; usedBy: number }[];
    arrived: { crn: string; courseCode: string; title: string; teacherName: string }[];
    unregistered: { crn: string; courseCode: string }[];
  };
  busy: boolean;
  onTakeIn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const lines = [
    report.gone.length ? `${report.gone.length} CRN${report.gone.length === 1 ? "" : "s"} we hold, gone from the portal` : "",
    report.arrived.length ? `${report.arrived.length} CRN${report.arrived.length === 1 ? "" : "s"} the portal lists for our courses, not registered` : "",
    report.unregistered.length ? `${report.unregistered.length} CRN${report.unregistered.length === 1 ? "" : "s"} on a course card, not registered` : "",
  ].filter(Boolean);

  return (
    <div role="status" className="mb-3 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm text-[#8a6116]">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <AlertTriangle size={16} aria-hidden="true" />
        {lines.join(" · ")}
        <button type="button" onClick={() => setOpen((current) => !current)} className="text-xs font-semibold underline">
          {open ? "Hide" : "Show"} them
        </button>
        {report.arrived.length ? (
          <button
            type="button"
            disabled={busy}
            onClick={onTakeIn}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Plus size={13} aria-hidden="true" /> {busy ? "Taking in…" : `Take in the ${report.arrived.length} new CRN(s)`}
          </button>
        ) : null}
      </p>
      {open ? (
        <div className="mt-2 grid gap-3 pl-6 text-xs sm:grid-cols-3">
          <Column title="Gone from the portal" rows={report.gone.map((row) => `${row.crn} ${row.courseCode}${row.usedBy ? ` — on ${row.usedBy} card row(s)` : ""}`)} />
          <Column title="New in the portal" rows={report.arrived.map((row) => `${row.crn} ${row.courseCode} — ${row.title}${row.teacherName ? `, ${row.teacherName}` : ""}`)} />
          <Column title="On a card, unregistered" rows={report.unregistered.map((row) => `${row.crn} ${row.courseCode}`)} />
        </div>
      ) : null}
    </div>
  );
}

function Column({ title, rows }: { title: string; rows: string[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <h4 className="font-semibold uppercase tracking-wide text-[#b08a2e]">{title}</h4>
      <ul className="mt-0.5 space-y-0.5">
        {rows.slice(0, 12).map((row) => (
          <li key={row}>{row}</li>
        ))}
        {rows.length > 12 ? <li className="text-[#b08a2e]">…and {rows.length - 12} more</li> : null}
      </ul>
    </div>
  );
}

const field = "mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal";

/** A course the portal does not list yet, said by code and title. */
function ByHandDialog({
  open,
  busy,
  onAdd,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  onAdd: (course: { courseCode: string; title: string }) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) {
      setCode("");
      setTitle("");
    }
  }, [open]);
  return (
    <Modal
      open={open}
      title="Add a course by hand"
      description="For a course the portal has not made CRNs for yet. When it does, choosing it on the Courses page brings its CRNs into the register."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
          <button
            type="button"
            disabled={!code.trim() || busy}
            onClick={() => onAdd({ courseCode: code.trim().toUpperCase(), title: title.trim() })}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            Add
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <label className="block text-sm font-semibold text-[#344054]">
          Course code
          <input aria-label="Course code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} placeholder="MATH-001" className={field} />
        </label>
        <label className="block text-sm font-semibold text-[#344054]">
          Title
          <input aria-label="Course title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Pre-calculus 1" className={field} />
        </label>
      </div>
    </Modal>
  );
}

/**
 * One CRN of the register: what it hangs from, and the UE of the course it belongs to.
 *
 * The parent is chosen from the CRNs of the same course, never typed, so the register
 * holds a link rather than a number somebody remembered. The portal's own row for the
 * course — plain title, no teacher, nobody registered — is offered first, because that
 * is what the timetable workbook's Parent CRN column has always meant.
 */
export function CrnDialog({
  row,
  course,
  siblings,
  onClose,
  onSaved,
}: {
  row: ActiveCrn;
  course: ActiveCourse | null;
  siblings: ActiveCrn[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [parent, setParent] = useState(row.parentCrn);
  const [ue, setUe] = useState(row.ue);
  const suggested = course?.portalParentCrn ?? "";

  const save = useMutation({
    mutationFn: async () => {
      if (parent !== row.parentCrn) await setParentCrn(row.id, parent);
      if (course && ue.trim() !== row.ue) await updateActiveCourse(course.id, { title: course.title, ue: ue.trim() });
    },
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });

  const options = [
    { value: "", label: "None yet" },
    ...siblings
      .filter((candidate) => candidate.crn !== row.crn)
      .map((candidate) => ({
        value: candidate.crn,
        label: candidate.crn === suggested ? `${candidate.crn} — the portal's row for the course` : candidate.crn,
        searchText: candidate.portalTitle,
        badge: candidate.portalTitle || undefined,
        badgeTone: "muted" as const,
      })),
  ];
  if (parent && !options.some((option) => option.value === parent)) {
    options.push({ value: parent, label: `${parent} — not one of this course's CRNs`, searchText: "", badge: undefined, badgeTone: "muted" as const });
  }

  return (
    <Modal
      open
      title={`${row.courseCode} · CRN ${row.crn}`}
      description={row.portalTitle ? `The portal calls it “${row.portalTitle}”${row.teacherName ? `, taught by ${row.teacherName}` : ""}.` : "The portal no longer lists this CRN."}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="block text-sm font-semibold text-[#344054]">Parent CRN</span>
          <span className="block text-xs font-normal text-[#98a2b3]">Chosen from this course&apos;s CRNs, so the register holds a link.</span>
          <div className="mt-1.5">
            <SelectMenu
              label={`Parent CRN for ${row.crn}`}
              value={parent}
              onChange={setParent}
              searchable={options.length > 8}
              placeholder="None yet"
              options={options}
            />
          </div>
          {suggested && parent !== suggested ? (
            <button type="button" onClick={() => setParent(suggested)} className="mt-1 text-xs font-semibold text-[#1f4e79] underline">
              Use {suggested}, the portal&apos;s row for this course
            </button>
          ) : null}
        </div>
        <label className="block text-sm font-semibold text-[#344054]">
          UE
          <span className="block text-xs font-normal text-[#98a2b3]">
            The course&apos;s, so it changes for every CRN of {row.courseCode}.
          </span>
          <input aria-label={`UE of ${row.courseCode}`} value={ue} onChange={(event) => setUe(event.target.value)} placeholder="UL1MA001" disabled={!course} className={field} />
        </label>
      </div>
      {row.usedBy ? (
        <p className="mt-3 text-xs text-[#667085]">
          {row.usedBy} section{row.usedBy === 1 ? "" : "s"} of a course card teach{row.usedBy === 1 ? "es" : ""} under this CRN.
        </p>
      ) : null}
      {save.error ? <p role="alert" className="mt-3 text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
    </Modal>
  );
}
