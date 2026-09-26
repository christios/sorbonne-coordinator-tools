import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, History, Pencil, Plus, Search, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SelectMenu } from "@/components/SelectMenu";
import { TaskFormDialog, type TaskFormValues } from "@/components/TaskFormDialog";
import { TaskActivityHistory } from "@/components/TaskRow";
import { TaskCompletionToggle } from "@/components/TaskVisuals";
import { usePageState } from "@/components/usePageState";
import {
  compareTeacherTasks,
  dueWords,
  formatTaskDate,
  summarizeTasks,
  taskUrgency,
} from "@/components/taskPresentation";
import type { Teacher, TeacherFolder } from "@/services/teachers";
import {
  ScopedTask,
  TaskStatus,
  createTask,
  deleteTask,
  updateTask,
} from "@/services/workflow";

type StatusFilter = "ALL" | "OPEN" | TaskStatus;
type UrgencyFilter = "ALL" | "OVERDUE" | "DUE_SOON" | "UNDATED";

const RESOURCE_TYPE = "teacher";

/**
 * Resource-wide task view for the teacher library. Summary cards describe the current
 * scope (teacher, folder, and search); the status and urgency filters then narrow the
 * list within it, so the totals do not collapse into a restatement of the filter.
 */
export function TasksOverview({
  tasks,
  teachers,
  folders,
  onOpenTeacher,
}: {
  tasks: ScopedTask[];
  teachers: Teacher[];
  folders: TeacherFolder[];
  onOpenTeacher: (id: string) => void;
}) {
  const client = useQueryClient();
  const [status, setStatus] = usePageState<StatusFilter>("tasks:status", "OPEN");
  const [teacherId, setTeacherId] = useState("");
  const [query, setQuery] = usePageState("tasks:search", "");
  const [folderId, setFolderId] = useState("");
  const [urgency, setUrgency] = useState<UrgencyFilter>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScopedTask | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScopedTask | null>(null);

  const teachersById = new Map(
    teachers.map((teacher) => [teacher.id, teacher]),
  );
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["tasks", RESOURCE_TYPE] });
  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };
  const save = useMutation({
    mutationFn: (values: TaskFormValues) =>
      editing
        ? updateTask({
            ...editing,
            title: values.title,
            description: values.description,
            dueDate: values.dueDate,
          })
        : createTask({
            resourceType: RESOURCE_TYPE,
            resourceId: values.resourceId,
            title: values.title,
            description: values.description,
            dueDate: values.dueDate,
          }),
    onSuccess: () => {
      closeForm();
      refresh();
    },
  });
  const update = useMutation({ mutationFn: updateTask, onSuccess: refresh });
  const remove = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      setPendingDelete(null);
      refresh();
    },
  });

  // Scope: which teacher's work is on screen at all.
  const scoped = tasks
    .filter((task) => teachersById.has(task.resourceId))
    .filter((task) => !teacherId || task.resourceId === teacherId)
    .filter(
      (task) =>
        !folderId ||
        teachersById.get(task.resourceId)?.folderId === folderId,
    )
    .filter((task) =>
      `${task.title} ${task.description ?? ""} ${teachersById.get(task.resourceId)?.fullName ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const summary = summarizeTasks(scoped);
  const visible = scoped
    .filter((task) =>
      status === "ALL"
        ? true
        : status === "OPEN"
          ? task.status !== "COMPLETED"
          : task.status === status,
    )
    .filter((task) => {
      if (urgency === "ALL") return true;
      if (urgency === "UNDATED") return !task.dueDate;
      return taskUrgency(task) === urgency;
    })
    .sort(compareTeacherTasks);

  const folderPath = (id: string | null | undefined) => (id ? folders.find((folder) => folder.id === id)?.name ?? "" : "");
  const groups = BUCKETS.map((bucket) => ({ ...bucket, tasks: visible.filter((task) => bucketOf(task) === bucket.id) })).filter(
    (group) => group.tasks.length,
  );

  /*
   * A column that fills its pane: the summary and the filters stay put, and the list
   * scrolls under them. It was a fragment dropped into a pane that hides its overflow, so
   * past the first screen of tasks nothing could be reached at all.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-[#e5e7eb] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-2 text-base font-semibold text-[#171717]" title="Teacher tasks across the library, most urgent first.">
            Tasks
          </h3>
          <SummaryCard label="Open" value={summary.open} tone="text-[#1f4e79]" active={status === "OPEN" && urgency === "ALL"} onClick={() => { setStatus("OPEN"); setUrgency("ALL"); }} />
          <SummaryCard
            label="Overdue"
            value={summary.overdue}
            tone="text-[#a6292f]"
            active={urgency === "OVERDUE"}
            onClick={() => {
              setStatus("OPEN");
              setUrgency(urgency === "OVERDUE" ? "ALL" : "OVERDUE");
            }}
          />
          <SummaryCard label="Completed" value={summary.completed} tone="text-[#256237]" active={status === "COMPLETED"} onClick={() => { setStatus("COMPLETED"); setUrgency("ALL"); }} />
          <SummaryCard label="Total" value={summary.total} active={status === "ALL" && urgency === "ALL"} onClick={() => { setStatus("ALL"); setUrgency("ALL"); }} />
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#1a4368]"
          >
            <Plus size={15} /> New task
          </button>
        </div>

        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1.4fr)_repeat(4,minmax(9rem,1fr))]">
          <label className="relative block">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
            />
            <input
              aria-label="Search tasks"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks or teachers"
              className="h-9 w-full rounded-md border border-[#e0e4ea] py-1.5 pl-9 pr-3 text-sm"
            />
          </label>
          <SelectMenu
            label="Task status filter"
            value={status}
            onChange={(value) => setStatus(value as StatusFilter)}
            options={[
              { value: "OPEN", label: "Open tasks" },
              { value: "COMPLETED", label: "Completed" },
              { value: "ALL", label: "All tasks" },
            ]}
          />
          <SelectMenu
            label="Teacher filter"
            value={teacherId}
            onChange={setTeacherId}
            searchable
            options={[
              { value: "", label: "All teachers" },
              ...teachers.map((teacher) => ({
                value: teacher.id,
                label: teacher.fullName,
              })),
            ]}
          />
          <SelectMenu
            label="Folder filter"
            value={folderId}
            onChange={setFolderId}
            options={[
              { value: "", label: "All folders" },
              ...folders.map((folder) => ({
                value: folder.id,
                label: folder.name,
              })),
            ]}
          />
          <SelectMenu
            label="Task urgency filter"
            value={urgency}
            onChange={(value) => setUrgency(value as UrgencyFilter)}
            options={[
              { value: "ALL", label: "Any deadline" },
              { value: "OVERDUE", label: "Overdue" },
              { value: "DUE_SOON", label: "Due within 7 days" },
              { value: "UNDATED", label: "No deadline" },
            ]}
          />
        </div>
      </div>

      {visible.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/*
            * Grouped by how soon each needs doing, each group with its count, so the shape
            * of the work is read before a single row is: three overdue, five this week.
            */}
          {groups.map((group) => (
            <section key={group.id} aria-label={`${group.label}: ${group.tasks.length}`}>
              <h4
                className={`sticky top-0 z-10 flex items-center gap-2 border-b border-[#e5e7eb] bg-[#f8fafc] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${group.tone}`}
              >
                {group.label}
                <span className="rounded-full bg-white px-1.5 py-px tabular-nums text-[#667085]">{group.tasks.length}</span>
              </h4>
              <ul>
                {group.tasks.map((task) => {
                  const owner = teachersById.get(task.resourceId);
                  return (
                    <TaskOverviewRow
                      key={task.id}
                      task={task}
                      teacher={owner?.fullName ?? ""}
                      folder={folderPath(owner?.folderId)}
                      isBusy={update.isPending}
                      onOpenTeacher={() => onOpenTeacher(task.resourceId)}
                      onToggleComplete={() =>
                        update.mutate({
                          ...task,
                          status: task.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED",
                        })
                      }
                      onEdit={() => {
                        setEditing(task);
                        setFormOpen(true);
                      }}
                      onDelete={() => setPendingDelete(task)}
                    />
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="p-12 text-center text-sm text-[#667085]">
          No tasks match these filters.
        </p>
      )}

      <TaskFormDialog
        open={formOpen}
        resourceType={RESOURCE_TYPE}
        task={editing}
        defaultResourceId={teacherId}
        resourceOptions={teachers.map((teacher) => ({
          value: teacher.id,
          label: teacher.fullName,
        }))}
        onClose={closeForm}
        onSubmit={(values) => save.mutate(values)}
        isSubmitting={save.isPending}
        error={save.error?.message ?? null}
      />
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete task?"
        description={`Delete ${pendingDelete?.title ?? "this task"}?`}
        confirmLabel="Delete task"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete.id)}
      />
    </div>
  );
}

type Bucket = "OVERDUE" | "DUE_SOON" | "LATER" | "UNDATED" | "COMPLETED";

/** The groups the list falls into, most urgent first. */
const BUCKETS: { id: Bucket; label: string; tone: string }[] = [
  { id: "OVERDUE", label: "Overdue", tone: "text-[#a6292f]" },
  { id: "DUE_SOON", label: "Due this week", tone: "text-[#9a6700]" },
  { id: "LATER", label: "Later", tone: "text-[#1f4e79]" },
  { id: "UNDATED", label: "No deadline", tone: "text-[#667085]" },
  { id: "COMPLETED", label: "Done", tone: "text-[#256237]" },
];

function bucketOf(task: ScopedTask): Bucket {
  if (task.status === "COMPLETED") return "COMPLETED";
  const urgency = taskUrgency(task);
  if (urgency !== "NONE") return urgency;
  return task.dueDate ? "LATER" : "UNDATED";
}

/** "AH" for Amina Haddad: who a task is for, at a glance down the column. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase() || "?";
}

/**
 * One task, as a row of columns that line up down the list: what it is, whose it is,
 * when it is due and how far off that is. The edge is coloured by urgency, so a red
 * stripe down the side is the first thing seen; the row's own actions wait for the pointer.
 */
function TaskOverviewRow({
  task,
  teacher,
  folder,
  isBusy,
  onOpenTeacher,
  onToggleComplete,
  onEdit,
  onDelete,
}: {
  task: ScopedTask;
  teacher: string;
  folder: string;
  isBusy: boolean;
  onOpenTeacher: () => void;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const bucket = bucketOf(task);
  const completed = bucket === "COMPLETED";
  const edge = {
    OVERDUE: "border-l-[#d92d20]",
    DUE_SOON: "border-l-[#e0a526]",
    LATER: "border-l-[#9db7d3]",
    UNDATED: "border-l-transparent",
    COMPLETED: "border-l-[#8cc59b]",
  }[bucket];
  const due = {
    OVERDUE: "bg-[#fef3f2] text-[#b42318]",
    DUE_SOON: "bg-[#fffaeb] text-[#93370d]",
    LATER: "bg-[#eff4fa] text-[#1f4e79]",
    UNDATED: "bg-[#f2f4f7] text-[#667085]",
    COMPLETED: "bg-[#ecfdf3] text-[#256237]",
  }[bucket];
  return (
    <li className={`group border-b border-l-4 border-b-[#eef1f5] ${edge} ${completed ? "bg-[#fcfcfd]" : "bg-white hover:bg-[#fafbfd]"}`}>
      <div className="grid items-center gap-x-4 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[auto_minmax(0,1fr)_minmax(10rem,13rem)_minmax(8rem,10rem)_auto]">
        <TaskCompletionToggle task={task} onToggle={onToggleComplete} disabled={isBusy} />
        <div className="min-w-0">
          <p className={`truncate text-sm font-semibold ${completed ? "text-[#98a2b3] line-through" : "text-[#171717]"}`}>
            {task.title}
          </p>
          {task.description ? (
            <p className="truncate text-xs text-[#667085]" title={task.description}>
              {task.description}
            </p>
          ) : task.templateItemId ? (
            <p className="text-xs text-[#98a2b3]">From the new-teacher checklist</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onOpenTeacher}
          aria-label={teacher}
          className="flex min-w-0 items-center gap-2 rounded-md text-left hover:text-[#1f4e79]"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#eaf1f8] text-[11px] font-semibold text-[#1f4e79]">
            {initials(teacher)}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-[#344054] group-hover:text-inherit">{teacher}</span>
            {folder ? <span className="block truncate text-[11px] text-[#98a2b3]">{folder}</span> : null}
          </span>
        </button>
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${due}`}>
            {bucket === "OVERDUE" ? <TriangleAlert size={12} aria-hidden="true" /> : <CalendarClock size={12} aria-hidden="true" />}
            {dueWords(task)}
          </span>
          {task.dueDate && !completed ? (
            <span className="pl-1 text-[11px] text-[#98a2b3]">{formatTaskDate(task.dueDate)}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center justify-end gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-label={`${historyOpen ? "Hide" : "Show"} activity for ${task.title}`}
            title="Activity"
            className={`rounded p-1.5 hover:bg-[#e8edf3] ${historyOpen ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}
          >
            <History size={15} />
          </button>
          <button type="button" onClick={onEdit} aria-label={`Edit ${task.title}`} title="Edit" className="rounded p-1.5 text-[#1f4e79] hover:bg-[#e8edf3]">
            <Pencil size={15} />
          </button>
          <button type="button" onClick={onDelete} aria-label={`Delete ${task.title}`} title="Delete" className="rounded p-1.5 text-[#a6292f] hover:bg-[#fff1f2]">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {historyOpen ? <TaskActivityHistory taskId={task.id} /> : null}
    </li>
  );
}

function SummaryCard({
  label,
  value,
  tone = "text-[#171717]",
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-baseline gap-1.5 rounded-full border px-3 py-1 text-left ${active ? "border-[#1f4e79] bg-[#f5f8fb]" : "border-[#d9dee7] bg-white hover:bg-[#fafbfc]"}`}
    >
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs font-medium text-[#667085]">{label}</span>
    </button>
  );
}
