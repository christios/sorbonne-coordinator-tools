import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookPlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ListGrid, StatePill } from "@/components/ListGrid";
import { Modal } from "@/components/Modal";
import { ScreenLoading } from "@/components/ScreenLoading";
import {
  type ActiveCourse,
  addActiveCourses,
  fetchActiveCourses,
  removeActiveCourse,
  updateActiveCourse,
} from "@/services/portalLists";
import type { GridColumn } from "@/services/studentColumns";

const COLUMNS: GridColumn<ActiveCourse>[] = [
  { id: "courseCode", displayName: "Course", type: "text", accessor: (row) => row.courseCode, required: true, defaultWidth: 130 },
  { id: "title", displayName: "Title", type: "text", accessor: (row) => row.title, defaultWidth: 260 },
  { id: "ue", displayName: "UE", type: "text", accessor: (row) => row.ue, defaultWidth: 120 },
  { id: "parentCrn", displayName: "Parent CRN", type: "text", accessor: (row) => row.parentCrn, defaultWidth: 110 },
  { id: "crnCount", displayName: "Portal CRNs", type: "number", accessor: (row) => row.crnCount, defaultWidth: 110 },
  { id: "termCount", displayName: "Terms", type: "number", accessor: (row) => row.termCount, defaultWidth: 80 },
  { id: "lastTerm", displayName: "Last term", type: "option", accessor: (row) => row.lastTerm, defaultWidth: 100 },
  {
    id: "source",
    displayName: "Source",
    type: "option",
    accessor: (row) => (row.crnCount ? "Portal" : "By hand"),
    defaultWidth: 110,
  },
  { id: "addedAt", displayName: "Added", type: "date", accessor: (row) => row.addedAt, display: (row) => row.addedAt.slice(0, 10), defaultWidth: 110 },
  { id: "addedBy", displayName: "Added by", type: "text", accessor: (row) => row.addedBy, defaultWidth: 200 },
];
const SHOWN = ["courseCode", "title", "ue", "parentCrn", "crnCount", "lastTerm", "source"];

const idOf = (row: ActiveCourse) => row.id;
const labelOf = (row: ActiveCourse) => `${row.courseCode} ${row.title}`.trim();
const renderCell = (row: ActiveCourse, column: GridColumn<ActiveCourse>) => {
  if (column.id === "source") return row.crnCount ? <StatePill tone="muted">Portal</StatePill> : <StatePill tone="muted">By hand</StatePill>;
  if (column.id === "ue" || column.id === "parentCrn") {
    const value = column.id === "ue" ? row.ue : row.parentCrn;
    return value ? <span className="tabular-nums">{value}</span> : <span className="text-[#c8d0da]">—</span>;
  }
  return undefined;
};

/**
 * The department's own list of courses.
 *
 * The portal lists every CRN of every course the university teaches; the department
 * deals with a few dozen courses. They are chosen from the Courses page, or added by
 * hand when the portal has not made them yet, and this is where each is given what the
 * timetabler's workbook needs to know about it: its Sorbonne UE and the parent CRN its
 * sections hang from. The cards on Groups & CRNs read both from here.
 */
export function ActiveCourses() {
  const client = useQueryClient();
  const active = useQuery({ queryKey: ["active-courses"], queryFn: fetchActiveCourses });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ActiveCourse | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ["active-courses"] });
    client.invalidateQueries({ queryKey: ["course-cards"] });
  };
  const add = useMutation({
    mutationFn: (course: { courseCode: string; title: string }) => addActiveCourses({ byHand: [course] }),
    onSuccess: () => {
      setAdding(false);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await removeActiveCourse(id);
    },
    onSuccess: () => {
      setSelected(new Set());
      setConfirmRemove(false);
      refresh();
    },
  });

  const error = add.error?.message ?? remove.error?.message ?? null;

  return (
    <section>
      {error ? (
        <p role="alert" className="mb-3 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]">{error}</p>
      ) : null}
      {add.data ? (
        <p className="mb-3 rounded-md border border-[#bfdcc6] bg-[#f4faf5] px-4 py-2.5 text-sm text-[#2f6b3d]">
          {add.data.added ? `${add.data.added} added.` : "Already on the list."}
        </p>
      ) : null}

      {active.isLoading ? (
        <ScreenLoading label="Loading active courses…" />
      ) : active.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(active.error as Error).message}</p>
      ) : (
        <ListGrid
          columns={COLUMNS}
          rows={active.data ?? []}
          idOf={idOf}
          labelOf={labelOf}
          layoutKey="scen-columns:active-courses:v1"
          presetKey="scen-copy-presets:active-courses:v1"
          shown={SHOWN}
          initialSort={{ key: "courseCode", ascending: true }}
          searchLabel="Search active courses"
          noun="courses"
          selected={selected}
          onSelectedChange={setSelected}
          renderCell={renderCell}
          onRowClick={setEditing}
          empty="No courses yet. Choose them on the Courses page, or add one by hand."
          toolbar={
            <>
              <button
                type="button"
                onClick={() => {
                  add.reset();
                  setAdding(true);
                }}
                className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
              >
                <BookPlus size={15} aria-hidden="true" /> Add by hand
              </button>
              <button
                type="button"
                disabled={selected.size === 0 || remove.isPending}
                onClick={() => setConfirmRemove(true)}
                className="inline-flex items-center gap-2 rounded-md border border-[#e5b7b9] bg-white px-3 py-2 text-sm font-semibold text-[#a6292f] hover:bg-[#fdf3f3] disabled:opacity-50"
              >
                <Trash2 size={15} aria-hidden="true" /> {selected.size ? `Remove ${selected.size}` : "Remove"}
              </button>
            </>
          }
        />
      )}

      <ByHandDialog open={adding} busy={add.isPending} onAdd={(course) => add.mutate(course)} onClose={() => setAdding(false)} />

      {editing ? <ActiveCourseDialog course={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}

      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${selected.size} from active courses?`}
        description="They stay in the portal's list; only the department's list forgets them. Cards that name them keep their sections but lose the UE and parent CRN."
        confirmLabel="Remove"
        onConfirm={() => remove.mutate([...selected])}
        onClose={() => setConfirmRemove(false)}
      />
    </section>
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
  const ready = code.trim().length > 0;
  return (
    <Modal
      open={open}
      title="Add a course by hand"
      description="For a course the portal has not made CRNs for yet. When it does, choosing it on the Courses page joins the two by code."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">Cancel</button>
          <button
            type="button"
            disabled={!ready || busy}
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

/** The course's own facts: what to call it, its UE, the CRN its sections hang from. */
export function ActiveCourseDialog({
  course,
  onClose,
  onSaved,
}: {
  course: ActiveCourse;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(course.title);
  const [ue, setUe] = useState(course.ue);
  const [parentCrn, setParentCrn] = useState(course.parentCrn);
  const save = useMutation({
    mutationFn: () => updateActiveCourse(course.id, { title: title.trim(), ue: ue.trim(), parentCrn: parentCrn.trim() }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  return (
    <Modal
      open
      title={course.courseCode}
      description={
        course.crnCount
          ? `The portal lists ${course.crnCount} CRN${course.crnCount === 1 ? "" : "s"} of it, latest in ${course.lastTerm}.`
          : "Added by hand; the portal lists no CRN of it yet."
      }
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
      <div className="space-y-4">
        <label className="block text-sm font-semibold text-[#344054]">
          Title
          <input aria-label={`Title of ${course.courseCode}`} value={title} onChange={(event) => setTitle(event.target.value)} className={field} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-[#344054]">
            UE
            <span className="block text-xs font-normal text-[#98a2b3]">The Sorbonne unit the course belongs to.</span>
            <input aria-label={`UE of ${course.courseCode}`} value={ue} onChange={(event) => setUe(event.target.value)} placeholder="UL1MA001" className={field} />
          </label>
          <label className="block text-sm font-semibold text-[#344054]">
            Parent CRN
            <span className="block text-xs font-normal text-[#98a2b3]">The CRN the sections hang from in the portal.</span>
            <input aria-label={`Parent CRN of ${course.courseCode}`} value={parentCrn} inputMode="numeric" onChange={(event) => setParentCrn(event.target.value)} placeholder="24226" className={field} />
          </label>
        </div>
        {save.error ? <p role="alert" className="text-sm text-[#a6292f]">{(save.error as Error).message}</p> : null}
      </div>
    </Modal>
  );
}
