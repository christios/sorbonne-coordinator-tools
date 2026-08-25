import { ScopedTask } from "@/services/workflow";

export type TaskUrgency = "OVERDUE" | "DUE_SOON" | "NONE";

export function taskUrgency(task: ScopedTask, today = new Date()): TaskUrgency {
  if (task.status === "COMPLETED" || !task.dueDate) return "NONE";
  const dueDate = localDate(task.dueDate);
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const dueSoonLimit = new Date(startOfToday);
  dueSoonLimit.setDate(dueSoonLimit.getDate() + 7);
  if (dueDate < startOfToday) return "OVERDUE";
  return dueDate <= dueSoonLimit ? "DUE_SOON" : "NONE";
}

export function compareTeacherTasks(
  first: ScopedTask,
  second: ScopedTask,
): number {
  const urgencyOrder = { OVERDUE: 0, DUE_SOON: 1, NONE: 2 };
  const firstUrgency = urgencyOrder[taskUrgency(first)];
  const secondUrgency = urgencyOrder[taskUrgency(second)];
  if (firstUrgency !== secondUrgency) return firstUrgency - secondUrgency;
  if (first.dueDate && second.dueDate)
    return first.dueDate.localeCompare(second.dueDate);
  if (first.dueDate) return -1;
  if (second.dueDate) return 1;
  return first.createdAt.localeCompare(second.createdAt);
}

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export type TaskSummary = {
  total: number;
  open: number;
  completed: number;
  overdue: number;
};

/** Counts behind the Tasks Overview summary cards. */
export function summarizeTasks(tasks: ScopedTask[]): TaskSummary {
  const completed = tasks.filter(
    (task) => task.status === "COMPLETED",
  ).length;
  return {
    total: tasks.length,
    open: tasks.length - completed,
    completed,
    overdue: tasks.filter((task) => taskUrgency(task) === "OVERDUE").length,
  };
}

/** Renders a due date (`YYYY-MM-DD`) or an activity timestamp for display. */
export function formatTaskDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly ? localDate(value) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
