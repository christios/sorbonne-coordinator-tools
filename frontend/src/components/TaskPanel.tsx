import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { InfoTip } from "@/components/InfoTip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SelectMenu } from "@/components/SelectMenu";
import { TaskFormDialog, type TaskFormValues } from "@/components/TaskFormDialog";
import { TaskRow } from "@/components/TaskRow";
import { compareTeacherTasks } from "@/components/taskPresentation";
import {
  ScopedTask,
  applyTaskTemplate,
  createTask,
  deleteTask,
  listTasks,
  listTaskTemplates,
  updateTask,
} from "@/services/workflow";

/**
 * Record-scoped task list shown on a resource profile. It shares its row, form dialog,
 * templates, and activity history with the Tasks Overview.
 */
export function TaskPanel({
  resourceType,
  resourceId,
  className = "",
  variant = "card",
}: {
  resourceType: string;
  resourceId: string;
  className?: string;
  /**
   * "rail" for a section of a profile's side rail: no card of its own, a small heading, and
   * the template picker on a line of its own, since the rail is too narrow to hold it
   * beside the button.
   */
  variant?: "card" | "rail" | "tab";
}) {
  const client = useQueryClient();
  const tasks = useQuery({
    queryKey: ["tasks", resourceType, resourceId],
    queryFn: () => listTasks(resourceType, resourceId),
  });
  const templates = useQuery({
    queryKey: ["task-templates", resourceType],
    queryFn: () => listTaskTemplates(resourceType),
  });
  const [editing, setEditing] = useState<ScopedTask | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ScopedTask | null>(null);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["tasks", resourceType] });
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
            resourceType,
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
  const applyTemplate = useMutation({
    mutationFn: (templateId: string) =>
      applyTaskTemplate({ resourceType, resourceId, templateId }),
    onSuccess: refresh,
  });
  const update = useMutation({ mutationFn: updateTask, onSuccess: refresh });
  const remove = useMutation({
    mutationFn: deleteTask,
    onSuccess: () => {
      setPendingDelete(null);
      refresh();
    },
  });
  const availableTemplates = (templates.data ?? []).filter((template) =>
    template.items.some(
      (item) => !tasks.data?.some((task) => task.templateItemId === item.id),
    ),
  );
  const ordered = [...(tasks.data ?? [])].sort(compareTeacherTasks);
  const rail = variant === "rail";
  const tab = variant === "tab";
  const gap = rail || tab ? "mt-3" : "mt-4";
  const templatePicker = availableTemplates.length ? (
    <div className={rail ? "mt-2" : tab ? "w-64" : "min-w-44"}>
      <SelectMenu
        label="Add tasks from a template"
        value=""
        onChange={(templateId) => applyTemplate.mutate(templateId)}
        placeholder="Add template"
        options={availableTemplates.map((template) => ({
          value: template.id,
          label: template.title,
        }))}
      />
    </div>
  ) : null;
  return (
    <section
      aria-label={rail || tab ? "Tasks" : undefined}
      className={rail || tab ? className : `rounded-lg border border-[#d9dee7] bg-white p-5 ${className}`}
    >
      {tab ? (
        // A tab of its own: the tab says "Tasks", so no heading — a toolbar as Requisitions has.
        <div className="flex flex-wrap items-center gap-2">
          {templatePicker}
          <InfoTip label="What tasks are">
            What is still to do for this teacher. A template adds its whole set at once; a time sheet&apos;s task
            closes itself when the sheet is filed.
          </InfoTip>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="ml-auto inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#173b5c]"
          >
            <Plus size={16} /> Add task
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h3
              className={
                rail
                  ? "text-xs font-semibold uppercase tracking-wide text-[#667085]"
                  : "text-lg font-semibold"
              }
            >
              Tasks
            </h3>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {rail ? null : templatePicker}
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className={
                  rail
                    ? "inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
                    : "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"
                }
              >
                <Plus size={rail ? 15 : 16} /> Add task
              </button>
            </div>
          </div>
          {rail ? templatePicker : null}
        </>
      )}
      {tasks.isLoading ? (
        <p className={`${gap} text-sm text-[#667085]`}>Loading tasks…</p>
      ) : null}
      {tasks.error ? (
        <p role="alert" className={`${gap} text-sm text-[#8f1f25]`}>
          {tasks.error.message}
        </p>
      ) : null}
      {ordered.length ? (
        <ul className={tab ? `${gap} rounded-lg border border-[#e4e8ef]` : `${gap} grid gap-2`}>
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isBusy={update.isPending}
              compact={rail}
              flush={tab}
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
        <p className={`${gap} rounded-md border border-dashed border-[#d0d5dd] px-3 py-4 text-sm text-[#667085]`}>
          No tasks yet.
        </p>
      )}
      <TaskFormDialog
        open={formOpen}
        resourceType={resourceType}
        task={editing}
        defaultResourceId={resourceId}
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
    </section>
  );
}
