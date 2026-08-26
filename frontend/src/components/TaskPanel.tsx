import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

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
}: {
  resourceType: string;
  resourceId: string;
  className?: string;
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
  return (
    <section
      className={`rounded-lg border border-[#d9dee7] bg-white p-5 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Tasks</h3>
          <p className="mt-1 text-sm text-[#667085]">
            Track the administrative actions for this teacher.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {availableTemplates.length ? (
            <div className="min-w-44">
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
          ) : null}
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"
          >
            <Plus size={16} /> Add task
          </button>
        </div>
      </div>
      {tasks.isLoading ? (
        <p className="mt-4 text-sm text-[#667085]">Loading tasks…</p>
      ) : null}
      {tasks.error ? (
        <p role="alert" className="mt-4 text-sm text-[#8f1f25]">
          {tasks.error.message}
        </p>
      ) : null}
      {ordered.length ? (
        <ul className="mt-4 grid gap-2">
          {ordered.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isBusy={update.isPending}
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
        <p className="mt-4 rounded-md border border-dashed border-[#d0d5dd] px-3 py-4 text-sm text-[#667085]">
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
