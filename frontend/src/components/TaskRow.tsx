import { useQuery } from "@tanstack/react-query";
import { History, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  TaskCompletionToggle,
  TaskUrgencyIndicator,
} from "@/components/TaskVisuals";
import { formatTaskDate } from "@/components/taskPresentation";
import {
  ScopedTask,
  TaskActivityKind,
  listTaskActivity,
} from "@/services/workflow";

const ACTIVITY_LABELS: Record<TaskActivityKind, string> = {
  CREATED: "Created",
  COMPLETED: "Completed",
  REOPENED: "Reopened",
};

/**
 * The single task row shared by the teacher profile panel and the Tasks Overview.
 * `meta` carries context that only one of the two surfaces has, such as the teacher name.
 */
export function TaskRow({
  task,
  meta,
  onToggleComplete,
  onEdit,
  onDelete,
  isBusy = false,
}: {
  task: ScopedTask;
  meta?: React.ReactNode;
  onToggleComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isBusy?: boolean;
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const completed = task.status === "COMPLETED";
  return (
    <li
      className={`rounded-md border border-[#d9dee7] p-3 ${completed ? "bg-[#fcfcfd]" : "bg-white"}`}
    >
      <div className="flex items-start gap-3">
        <TaskCompletionToggle
          task={task}
          onToggle={onToggleComplete}
          disabled={isBusy}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p
              className={`font-semibold ${completed ? "text-[#667085] line-through" : "text-[#344054]"}`}
            >
              {task.title}
            </p>
            <TaskUrgencyIndicator task={task} />
          </div>
          {task.description ? (
            <p className="mt-1 whitespace-pre-line text-sm leading-6 text-[#475467]">
              {task.description}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#667085]">
            {meta}
            <span>
              {task.dueDate ? `Due ${formatTaskDate(task.dueDate)}` : "No deadline"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            aria-expanded={historyOpen}
            aria-label={`${historyOpen ? "Hide" : "Show"} activity for ${task.title}`}
            className={`rounded p-2 hover:bg-[#e8edf3] ${historyOpen ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#667085]"}`}
          >
            <History size={16} />
          </button>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${task.title}`}
            className="rounded p-2 text-[#1f4e79] hover:bg-[#e8edf3]"
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${task.title}`}
            className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2]"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {historyOpen ? <TaskActivityHistory taskId={task.id} /> : null}
    </li>
  );
}

export function TaskActivityHistory({ taskId }: { taskId: string }) {
  const activity = useQuery({
    queryKey: ["task-activity", taskId],
    queryFn: () => listTaskActivity(taskId),
  });
  return (
    <div className="mt-3 border-t border-[#eaecf0] pt-3 pl-8">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[#667085]">
        Activity
      </h4>
      {activity.isLoading ? (
        <p className="mt-1 text-sm text-[#667085]">Loading activity…</p>
      ) : null}
      {activity.error ? (
        <p role="alert" className="mt-1 text-sm text-[#8f1f25]">
          {activity.error.message}
        </p>
      ) : null}
      {activity.data?.length ? (
        <ol className="mt-2 grid gap-1 text-sm text-[#475467]">
          {activity.data.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-2">
              <span className="font-medium text-[#344054]">
                {ACTIVITY_LABELS[entry.kind]}
              </span>
              <span className="text-xs text-[#667085]">
                {formatTaskDate(entry.occurredAt)}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
