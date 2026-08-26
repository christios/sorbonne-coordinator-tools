import { describe, expect, it } from "vitest";

import { ScopedTask } from "@/services/workflow";

import {
  compareTeacherTasks,
  formatTaskDate,
  summarizeTasks,
  taskUrgency,
} from "./taskPresentation";

function task(overrides: Partial<ScopedTask>): ScopedTask {
  return {
    id: "task-1",
    resourceType: "teacher",
    resourceId: "teacher-1",
    templateItemId: null,
    title: "Task",
    description: null,
    dueDate: null,
    status: "NOT_STARTED",
    completedAt: null,
    revision: 1,
    createdAt: "2026-08-21T00:00:00Z",
    updatedAt: "2026-08-21T00:00:00Z",
    ...overrides,
  };
}

describe("task visuals", () => {
  it("identifies overdue, seven-day, and completed tasks without warning completed work", () => {
    const today = new Date(2026, 7, 21);

    expect(taskUrgency(task({ dueDate: "2026-08-20" }), today)).toBe("OVERDUE");
    expect(taskUrgency(task({ dueDate: "2026-08-28" }), today)).toBe(
      "DUE_SOON",
    );
    expect(
      taskUrgency(task({ dueDate: "2026-08-28", status: "COMPLETED" }), today),
    ).toBe("NONE");
  });

  it("orders open work by urgency before undated tasks", () => {
    expect(
      compareTeacherTasks(
        task({ id: "overdue", dueDate: "2020-01-01" }),
        task({ id: "undated" }),
      ),
    ).toBeLessThan(0);
  });

  it("summarizes totals, open work, completions, and overdue tasks", () => {
    const summary = summarizeTasks([
      task({ id: "a", dueDate: "2020-01-01" }),
      task({ id: "b" }),
      task({ id: "c", status: "COMPLETED", completedAt: "2026-08-20T09:00:00Z" }),
    ]);

    expect(summary).toEqual({ total: 3, open: 2, completed: 1, overdue: 1 });
  });

  it("never counts a completed task as overdue", () => {
    const summary = summarizeTasks([
      task({ id: "a", dueDate: "2020-01-01", status: "COMPLETED" }),
    ]);

    expect(summary.overdue).toBe(0);
  });

  it("formats due dates and activity timestamps for display", () => {
    // The exact month abbreviation follows the runtime's ICU data ("Sep" / "Sept").
    expect(formatTaskDate("2026-09-01")).toMatch(/^1 Sept? 2026$/);
    expect(formatTaskDate("2026-09-01T10:30:00Z")).toMatch(/^1 Sept? 2026$/);
    expect(formatTaskDate("not a date")).toBe("not a date");
  });
});