import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { ModalDialog } from "@/components/ModalDialog";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import {
  ScopedTask,
  createQuickTemplate,
  deleteQuickTemplate,
  listQuickTemplates,
  updateQuickTemplate,
} from "@/services/workflow";

export type TaskFormValues = {
  resourceId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
};

/**
 * Shared create/edit surface for tasks, used by both the teacher profile panel and the
 * Tasks Overview. Quick templates are managed from here so a coordinator never has to
 * leave the task they are writing to curate the list.
 */
export function TaskFormDialog({
  open,
  resourceType,
  task,
  resourceOptions,
  resourceLabel = "Teacher",
  defaultResourceId = "",
  onClose,
  onSubmit,
  isSubmitting = false,
  error,
}: {
  open: boolean;
  resourceType: string;
  task?: ScopedTask | null;
  resourceOptions?: SelectOption[];
  resourceLabel?: string;
  defaultResourceId?: string;
  onClose: () => void;
  onSubmit: (values: TaskFormValues) => void;
  isSubmitting?: boolean;
  error?: string | null;
}) {
  const client = useQueryClient();
  const editing = Boolean(task);
  const [resourceId, setResourceId] = useState(defaultResourceId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [pendingTemplateDelete, setPendingTemplateDelete] = useState<
    string | null
  >(null);

  const templates = useQuery({
    queryKey: ["task-quick-templates", resourceType],
    queryFn: () => listQuickTemplates(resourceType),
    enabled: open,
  });
  const refreshTemplates = () =>
    client.invalidateQueries({
      queryKey: ["task-quick-templates", resourceType],
    });

  useEffect(() => {
    if (!open) return;
    setResourceId(task?.resourceId ?? defaultResourceId);
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setDueDate(task?.dueDate ?? "");
    setSelectedTemplateId("");
  }, [defaultResourceId, open, task]);

  const saveTemplate = useMutation({
    mutationFn: () =>
      selectedTemplateId
        ? updateQuickTemplate({
            id: selectedTemplateId,
            title: title.trim(),
            description: description.trim() || null,
          })
        : createQuickTemplate({
            resourceType,
            title: title.trim(),
            description: description.trim() || null,
          }),
    onSuccess: (saved) => {
      setSelectedTemplateId(saved.id);
      refreshTemplates();
    },
  });
  const removeTemplate = useMutation({
    mutationFn: deleteQuickTemplate,
    onSuccess: () => {
      setPendingTemplateDelete(null);
      setSelectedTemplateId("");
      refreshTemplates();
    },
  });

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.data?.find((item) => item.id === templateId);
    if (!template) return;
    setTitle(template.title);
    setDescription(template.description ?? "");
  };

  const templateOptions: SelectOption[] = (templates.data ?? []).map(
    (template) => ({ value: template.id, label: template.title }),
  );
  const selectedTemplate = templates.data?.find(
    (template) => template.id === selectedTemplateId,
  );
  const canSubmit = Boolean(title.trim()) && Boolean(resourceId);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      resourceId,
      title: title.trim(),
      description: description.trim() || null,
      dueDate: dueDate || null,
    });
  };

  return (
    <ModalDialog
      open={open}
      title={editing ? "Edit task" : "New task"}
      description={
        editing
          ? "Update this task. Completion is changed from the task list."
          : "Describe the administrative action to track."
      }
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="task-form"
            disabled={!canSubmit || isSubmitting}
            className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {editing ? "Save task" : "Create task"}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-4">
        {!editing && templateOptions.length ? (
          <div className="grid gap-2 rounded-md bg-[#f8fafc] p-3">
            <SelectMenu
              label="Start from a template"
              value={selectedTemplateId}
              onChange={applyTemplate}
              placeholder="Start from a template (optional)"
              options={templateOptions}
            />
          </div>
        ) : null}
        {resourceOptions ? (
          <SelectMenu
            label={resourceLabel}
            value={resourceId}
            onChange={setResourceId}
            placeholder={`Select a ${resourceLabel.toLowerCase()}`}
            options={resourceOptions}
            searchable
            required
          />
        ) : null}
        <label className="grid gap-1 text-sm font-medium text-[#344054]">
          Task title
          <input
            autoFocus
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 rounded-md border border-[#b7bec8] px-3 font-normal"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-[#344054]">
          Description (optional)
          <AutoResizeTextarea
            minRows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal"
          />
        </label>
        <div className="sm:max-w-[14rem]">
          <DateField label="Deadline" value={dueDate} onChange={setDueDate} />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-[#8f1f25]">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 border-t border-[#eaecf0] pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
            Templates
          </span>
          <button
            type="button"
            disabled={!title.trim() || saveTemplate.isPending}
            onClick={() => saveTemplate.mutate()}
            className="rounded-md border border-[#b7bec8] px-3 py-1.5 text-sm font-semibold text-[#1f4e79] disabled:opacity-50"
          >
            {selectedTemplate ? "Update template" : "Save as template"}
          </button>
          {selectedTemplate ? (
            <button
              type="button"
              onClick={() => setPendingTemplateDelete(selectedTemplate.id)}
              className="rounded-md border border-[#e4b6b8] px-3 py-1.5 text-sm font-semibold text-[#a6292f]"
            >
              Delete template
            </button>
          ) : null}
          <span className="text-xs text-[#667085]">
            Templates are shared with every coordinator.
          </span>
        </div>
        {saveTemplate.error ? (
          <p role="alert" className="text-sm text-[#8f1f25]">
            {saveTemplate.error.message}
          </p>
        ) : null}
      </form>
      <ConfirmDialog
        open={Boolean(pendingTemplateDelete)}
        title="Delete template?"
        description={`Delete ${selectedTemplate?.title ?? "this template"}? Tasks already created from it are not affected.`}
        confirmLabel="Delete template"
        onClose={() => setPendingTemplateDelete(null)}
        onConfirm={() =>
          pendingTemplateDelete && removeTemplate.mutate(pendingTemplateDelete)
        }
      />
    </ModalDialog>
  );
}
