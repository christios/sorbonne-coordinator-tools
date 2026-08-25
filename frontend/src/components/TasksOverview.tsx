import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SelectMenu } from "@/components/SelectMenu";
import { TaskFormDialog, type TaskFormValues } from "@/components/TaskFormDialog";
import { TaskRow } from "@/components/TaskRow";
import {
  compareTeacherTasks,
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
  const [status, setStatus] = useState<StatusFilter>("OPEN");
  const [teacherId, setTeacherId] = useState("");
  const [query, setQuery] = useState("");
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

  return (
    <>
      <div className="border-b border-[#e5e7eb] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#171717]">
              Tasks Overview
            </h3>
            <p className="mt-1 text-sm text-[#667085]">
              Teacher tasks across the library, ordered by urgency.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
          >
            <Plus size={16} /> New task
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total"
            value={summary.total}
            active={status === "ALL"}
            onClick={() => setStatus("ALL")}
          />
          <SummaryCard
            label="Open"
            value={summary.open}
            tone="text-[#1f4e79]"
            active={status === "OPEN"}
            onClick={() => setStatus("OPEN")}
          />
          <SummaryCard
            label="Completed"
            value={summary.completed}
            tone="text-[#256237]"
            active={status === "COMPLETED"}
            onClick={() => setStatus("COMPLETED")}
          />
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
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
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
        </div>

        <div className="mt-2 grid gap-2 text-sm md:grid-cols-3">
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
        <ul className="grid gap-2 p-4">
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isBusy={update.isPending}
              meta={
                <button
                  type="button"
                  onClick={() => onOpenTeacher(task.resourceId)}
                  className="font-medium text-[#1f4e79] hover:underline"
                >
                  {teachersById.get(task.resourceId)?.fullName}
                </button>
              }
              onToggleComplete={() =>
                update.mutate({
                  ...task,
                  status:
                    task.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED",
                })
              }
              onEdit={() => {
                setEditing(task);
                setFormOpen(true);
              }}
              onDelete={() => setPendingDelete(task)}
            />
          ))}
        </ul>
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
    </>
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
      className={`rounded-lg border p-3 text-left ${active ? "border-[#1f4e79] bg-[#f5f8fb]" : "border-[#d9dee7] bg-white hover:bg-[#fafbfc]"}`}
    >
      <span className={`block text-2xl font-semibold ${tone}`}>{value}</span>
      <span className="mt-0.5 block text-xs font-medium text-[#667085]">
        {label}
      </span>
    </button>
  );
}
