export type FieldNote = {
  id: string;
  resourceType: string;
  resourceId: string;
  fieldKey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};
/** The lifecycle is binary. IN_PROGRESS was retired in migration 0020. */
export type TaskStatus = "NOT_STARTED" | "COMPLETED";
export type ScopedTask = {
  id: string;
  resourceType: string;
  resourceId: string;
  templateItemId: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: TaskStatus;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
export type TaskActivityKind = "CREATED" | "COMPLETED" | "REOPENED";
export type TaskActivityEntry = {
  id: string;
  taskId: string;
  kind: TaskActivityKind;
  occurredAt: string;
};
/**
 * A single-task quick template. Distinct from the multi-task bundles below:
 * a quick template pre-fills one task form, a bundle applies several tasks at once.
 * Quick templates are shared — every coordinator sees every template.
 */
export type TaskQuickTemplate = {
  id: string;
  resourceType: string;
  title: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};
export type TaskTemplate = {
  id: string;
  resourceType: string;
  title: string;
  items: { id: string; title: string; position: number }[];
  createdAt: string;
  updatedAt: string;
};

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: string;
    };
    throw new Error(
      body.detail ?? `Request failed with status ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function listFieldNotes(
  resourceType: string,
  resourceId: string,
): Promise<FieldNote[]> {
  return (
    await request<{ items: FieldNote[] }>(
      `/field-notes?resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`,
    )
  ).items;
}
export function upsertFieldNote(
  input: Pick<
    FieldNote,
    "resourceType" | "resourceId" | "fieldKey" | "content"
  >,
): Promise<FieldNote> {
  return request<FieldNote>("/field-notes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export async function listTaskTemplates(
  resourceType: string,
): Promise<TaskTemplate[]> {
  return (
    await request<{ items: TaskTemplate[] }>(
      `/task-templates?resourceType=${encodeURIComponent(resourceType)}`,
    )
  ).items;
}
export async function listTasks(
  resourceType: string,
  resourceId?: string,
): Promise<ScopedTask[]> {
  const resourceQuery = resourceId
    ? `&resourceId=${encodeURIComponent(resourceId)}`
    : "";
  return (
    await request<{ items: ScopedTask[] }>(
      `/tasks?resourceType=${encodeURIComponent(resourceType)}${resourceQuery}`,
    )
  ).items;
}
export function createTask(
  input: Pick<
    ScopedTask,
    "resourceType" | "resourceId" | "title" | "dueDate"
  > & { description?: string | null },
): Promise<ScopedTask> {
  return request<ScopedTask>("/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export async function applyTaskTemplate(input: {
  resourceType: string;
  resourceId: string;
  templateId: string;
}): Promise<ScopedTask[]> {
  return (
    await request<{ items: ScopedTask[] }>("/tasks/from-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
  ).items;
}
export function updateTask(task: ScopedTask): Promise<ScopedTask> {
  return request<ScopedTask>(`/tasks/${task.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expectedRevision: task.revision,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      status: task.status,
    }),
  });
}
export async function listTaskActivity(
  taskId: string,
): Promise<TaskActivityEntry[]> {
  return (
    await request<{ items: TaskActivityEntry[] }>(`/tasks/${taskId}/activity`)
  ).items;
}
export async function listQuickTemplates(
  resourceType: string,
): Promise<TaskQuickTemplate[]> {
  return (
    await request<{ items: TaskQuickTemplate[] }>(
      `/task-quick-templates?resourceType=${encodeURIComponent(resourceType)}`,
    )
  ).items;
}
export function createQuickTemplate(input: {
  resourceType: string;
  title: string;
  description: string | null;
}): Promise<TaskQuickTemplate> {
  return request<TaskQuickTemplate>("/task-quick-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function updateQuickTemplate(input: {
  id: string;
  title: string;
  description: string | null;
}): Promise<TaskQuickTemplate> {
  return request<TaskQuickTemplate>(`/task-quick-templates/${input.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: input.title, description: input.description }),
  });
}
export async function deleteQuickTemplate(id: string): Promise<void> {
  const response = await apiFetch(
    `${API_BASE_URL}/api/v1/task-quick-templates/${id}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error("Unable to delete task template.");
}
export async function deleteTask(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE_URL}/api/v1/tasks/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Unable to delete task.");
}
import { apiFetch } from "@/services/http";
