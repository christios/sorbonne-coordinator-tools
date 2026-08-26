import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TaskPanel } from "./TaskPanel";

const task = (overrides: Record<string, unknown> = {}) => ({
  id: "task-1",
  resourceType: "teacher",
  resourceId: "existing-teacher",
  templateItemId: null,
  title: "CID Clearance",
  description: null,
  dueDate: null,
  status: "NOT_STARTED",
  completedAt: null,
  revision: 1,
  createdAt: "2026-08-21T00:00:00Z",
  updatedAt: "2026-08-21T00:00:00Z",
  ...overrides,
});

const workflow = vi.hoisted(() => ({
  applyTaskTemplate: vi.fn().mockResolvedValue([]),
  createTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  listTaskTemplates: vi.fn().mockResolvedValue([
    {
      id: "teacher-onboarding",
      resourceType: "teacher",
      title: "Teacher onboarding",
      items: [
        { id: "cid", title: "CID Clearance", position: 1 },
        { id: "signature", title: "Requisition signature", position: 2 },
        { id: "issuance", title: "ID Issuance (for newcomers)", position: 3 },
      ],
      createdAt: "2026-08-21T00:00:00Z",
      updatedAt: "2026-08-21T00:00:00Z",
    },
  ]),
  listTasks: vi.fn().mockResolvedValue([]),
  updateTask: vi.fn().mockResolvedValue({}),
  listTaskActivity: vi.fn().mockResolvedValue([]),
  listQuickTemplates: vi.fn().mockResolvedValue([]),
  createQuickTemplate: vi.fn().mockResolvedValue({ id: "quick-1" }),
  updateQuickTemplate: vi.fn().mockResolvedValue({ id: "quick-1" }),
  deleteQuickTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/workflow", () => workflow);

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskPanel resourceType="teacher" resourceId="existing-teacher" />
    </QueryClientProvider>,
  );
}

describe("TaskPanel", () => {
  it("offers the onboarding bundle for an existing teacher with no template tasks", async () => {
    workflow.listTasks.mockResolvedValue([]);
    renderPanel();

    const selector = await screen.findByRole("combobox", {
      name: "Add tasks from a template",
    });
    fireEvent.click(selector);
    fireEvent.click(screen.getByRole("option", { name: "Teacher onboarding" }));

    await waitFor(() =>
      expect(workflow.applyTaskTemplate).toHaveBeenCalledWith({
        resourceType: "teacher",
        resourceId: "existing-teacher",
        templateId: "teacher-onboarding",
      }),
    );
  });

  it("shows a task description and completes work from the row checkbox", async () => {
    workflow.listTasks.mockResolvedValue([
      task({ description: "Send the form to the CID office." }),
    ]);
    renderPanel();

    expect(
      await screen.findByText("Send the form to the CID office."),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete CID Clearance" }),
    );

    // `mutationFn: updateTask` is referenced directly, so React Query also passes context.
    await waitFor(() =>
      expect(workflow.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-1", status: "COMPLETED" }),
        expect.anything(),
      ),
    );
  });

  it("reopens a completed task back to not started", async () => {
    workflow.updateTask.mockClear();
    workflow.listTasks.mockResolvedValue([
      task({ status: "COMPLETED", completedAt: "2026-08-21T09:00:00Z" }),
    ]);
    renderPanel();

    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Reopen CID Clearance" }),
    );

    await waitFor(() =>
      expect(workflow.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ status: "NOT_STARTED" }),
        expect.anything(),
      ),
    );
  });

  it("loads activity history only when it is opened", async () => {
    workflow.listTaskActivity.mockClear();
    workflow.listTaskActivity.mockResolvedValue([
      {
        id: "a1",
        taskId: "task-1",
        kind: "CREATED",
        occurredAt: "2026-08-21T00:00:00Z",
      },
      {
        id: "a2",
        taskId: "task-1",
        kind: "COMPLETED",
        occurredAt: "2026-08-22T00:00:00Z",
      },
    ]);
    workflow.listTasks.mockResolvedValue([task()]);
    renderPanel();

    await screen.findByText("CID Clearance");
    expect(workflow.listTaskActivity).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Show activity for CID Clearance" }),
    );

    expect(await screen.findByText("Created")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(workflow.listTaskActivity).toHaveBeenCalledWith("task-1");
  });

  it("creates a task with a description from the shared dialog", async () => {
    workflow.createTask.mockClear();
    workflow.listTasks.mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Add task/ }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Collect bank details" },
    });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "IBAN and passport copy." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(workflow.createTask).toHaveBeenCalledWith({
        resourceType: "teacher",
        resourceId: "existing-teacher",
        title: "Collect bank details",
        description: "IBAN and passport copy.",
        dueDate: null,
      }),
    );
  });

  it("saves the open task as a shared quick template", async () => {
    workflow.createQuickTemplate.mockClear();
    workflow.listTasks.mockResolvedValue([]);
    renderPanel();

    fireEvent.click(await screen.findByRole("button", { name: /Add task/ }));
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Chase CID clearance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save as template" }));

    await waitFor(() =>
      expect(workflow.createQuickTemplate).toHaveBeenCalledWith({
        resourceType: "teacher",
        title: "Chase CID clearance",
        description: null,
      }),
    );
  });
});
