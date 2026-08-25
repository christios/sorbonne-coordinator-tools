import { CheckCircle2, Circle, TriangleAlert } from "lucide-react";

import { ScopedTask } from "@/services/workflow";
import { taskUrgency } from "@/components/taskPresentation";

/** Read-only lifecycle marker. Use `TaskCompletionToggle` where the state is editable. */
export function TaskStatusIcon({
  task,
  size = 18,
}: {
  task: ScopedTask;
  size?: number;
}) {
  if (task.status === "COMPLETED")
    return (
      <CheckCircle2
        aria-label="Completed"
        size={size}
        className="shrink-0 text-[#256237]"
      />
    );
  return (
    <Circle
      aria-label="Not started"
      size={size}
      className="shrink-0 text-[#667085]"
    />
  );
}

/** Inline completion control: the primary way a coordinator closes or reopens a task. */
export function TaskCompletionToggle({
  task,
  onToggle,
  disabled = false,
}: {
  task: ScopedTask;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const completed = task.status === "COMPLETED";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={completed}
      aria-label={`${completed ? "Reopen" : "Complete"} ${task.title}`}
      disabled={disabled}
      onClick={onToggle}
      className="shrink-0 rounded-full p-0.5 text-[#667085] hover:bg-[#f2f4f7] disabled:opacity-50"
    >
      {completed ? (
        <CheckCircle2 size={20} className="text-[#256237]" />
      ) : (
        <Circle size={20} className="text-[#98a2b3] hover:text-[#1f4e79]" />
      )}
    </button>
  );
}

export function TaskUrgencyIndicator({ task }: { task: ScopedTask }) {
  const urgency = taskUrgency(task);
  if (urgency === "NONE") return null;
  const overdue = urgency === "OVERDUE";
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold ${overdue ? "text-[#a6292f]" : "text-[#9a6700]"}`}
    >
      <TriangleAlert size={14} /> {overdue ? "Overdue" : "Due soon"}
    </span>
  );
}

export function TaskProgressBadge({ tasks }: { tasks: ScopedTask[] }) {
  const completed = tasks.filter((task) => task.status === "COMPLETED").length;
  const tone = !tasks.length
    ? "text-[#667085] bg-[#f2f4f7]"
    : completed === tasks.length
      ? "text-[#256237] bg-[#f4fbf5]"
      : completed
        ? "text-[#1f4e79] bg-[#eaf1f8]"
        : "text-[#667085] bg-[#f2f4f7]";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${tone}`}
    >
      {completed}/{tasks.length} tasks done
    </span>
  );
}
