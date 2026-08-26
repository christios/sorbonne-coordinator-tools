import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TasksOverview } from "./TasksOverview";
import type { ScopedTask } from "@/services/workflow";
import type { Teacher, TeacherFolder } from "@/services/teachers";

const workflow = vi.hoisted(() => ({
  createTask: vi.fn().mockResolvedValue({}),
  deleteTask: vi.fn().mockResolvedValue(undefined),
  updateTask: vi.fn().mockResolvedValue({}),
  listTaskActivity: vi.fn().mockResolvedValue([]),
  listQuickTemplates: vi.fn().mockResolvedValue([]),
  createQuickTemplate: vi.fn().mockResolvedValue({ id: "quick-1" }),
  updateQuickTemplate: vi.fn().mockResolvedValue({ id: "quick-1" }),
  deleteQuickTemplate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/services/workflow", () => workflow);

const teacher = (id: string, fullName: string, folderId: string | null = null) =>
  ({
    id,
    folderId,
    fullName,
    email: "",
    phone: "",
    notes: "",
    archivedAt: null,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
  }) as Teacher;

const task = (overrides: Partial<ScopedTask> & { id: string }): ScopedTask => ({
  resourceType: "teacher",
  resourceId: "t1",
  templateItemId: null,
  title: "A task",
  description: null,
  dueDate: null,
  status: "NOT_STARTED",
  completedAt: null,
  revision: 1,
  createdAt: "2026-08-21T00:00:00Z",
  updatedAt: "2026-08-21T00:00:00Z",
  ...overrides,
});

const TEACHERS = [teacher("t1", "Amina Haddad", "f1"), teacher("t2", "Luc Moreau")];
const FOLDERS = [
  { id: "f1", name: "Physics", parentId: null } as TeacherFolder,
];
const TASKS = [
  task({ id: "overdue", resourceId: "t1", title: "CID Clearance", dueDate: "2020-01-01" }),
  task({ id: "open", resourceId: "t2", title: "Requisition signature" }),
  task({
    id: "done",
    resourceId: "t1",
    title: "ID Issuance",
    status: "COMPLETED",
    completedAt: "2026-08-20T09:00:00Z",
  }),
];

function renderOverview(tasks: ScopedTask[] = TASKS, onOpenTeacher = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TasksOverview
        tasks={tasks}
        teachers={TEACHERS}
        folders={FOLDERS}
        onOpenTeacher={onOpenTeacher}
      />
    </QueryClientProvider>,
  );
  return onOpenTeacher;
}

function cardValue(label: string) {
  const card = screen.getByRole("button", { name: new RegExp(`${label}$`) });
  return card.textContent?.replace(label, "").trim();
}

describe("TasksOverview", () => {
  it("summarizes total, open, completed, and overdue work", () => {
    renderOverview();

    expect(cardValue("Total")).toBe("3");
    expect(cardValue("Open")).toBe("2");
    expect(cardValue("Completed")).toBe("1");
    expect(cardValue("Overdue")).toBe("1");
  });

  it("defaults to open work and can switch to completed", async () => {
    renderOverview();

    expect(screen.getByText("CID Clearance")).toBeTruthy();
    expect(screen.queryByText("ID Issuance")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Completed$/ }));

    expect(await screen.findByText("ID Issuance")).toBeTruthy();
    expect(screen.queryByText("CID Clearance")).toBeNull();
  });

  it("narrows to one teacher and rescopes the summary cards", () => {
    renderOverview();

    fireEvent.click(screen.getByRole("combobox", { name: "Teacher filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Luc Moreau" }));

    expect(cardValue("Total")).toBe("1");
    expect(cardValue("Overdue")).toBe("0");
    expect(screen.getByText("Requisition signature")).toBeTruthy();
    expect(screen.queryByText("CID Clearance")).toBeNull();
  });

  it("filters by folder and by search across titles and teacher names", () => {
    renderOverview();

    fireEvent.change(screen.getByLabelText("Search tasks"), {
      target: { value: "luc" },
    });
    expect(screen.getByText("Requisition signature")).toBeTruthy();
    expect(screen.queryByText("CID Clearance")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search tasks"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("combobox", { name: "Folder filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Physics" }));

    expect(screen.getByText("CID Clearance")).toBeTruthy();
    expect(screen.queryByText("Requisition signature")).toBeNull();
  });

  it("uses the Overdue card as an urgency filter", () => {
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: /Overdue$/ }));

    expect(screen.getByText("CID Clearance")).toBeTruthy();
    expect(screen.queryByText("Requisition signature")).toBeNull();
  });

  it("completes a task from the row and refreshes the shared teacher task query", async () => {
    workflow.updateTask.mockClear();
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      <QueryClientProvider client={client}>
        <TasksOverview
          tasks={TASKS}
          teachers={TEACHERS}
          folders={FOLDERS}
          onOpenTeacher={vi.fn()}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete CID Clearance" }),
    );

    await waitFor(() =>
      expect(workflow.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({ id: "overdue", status: "COMPLETED" }),
        expect.anything(),
      ),
    );
    // The teacher library progress badges read the same query key.
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["tasks", "teacher"] }),
    );
  });

  it("opens the teacher profile from a task row", () => {
    const onOpenTeacher = renderOverview();

    fireEvent.click(screen.getByRole("button", { name: "Amina Haddad" }));

    expect(onOpenTeacher).toHaveBeenCalledWith("t1");
  });

  it("creates a task for the chosen teacher from the shared dialog", async () => {
    workflow.createTask.mockClear();
    renderOverview();

    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Teacher" }));
    fireEvent.click(screen.getByRole("option", { name: "Luc Moreau" }));
    fireEvent.change(within(dialog).getByLabelText("Task title"), {
      target: { value: "Collect bank details" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(workflow.createTask).toHaveBeenCalledWith({
        resourceType: "teacher",
        resourceId: "t2",
        title: "Collect bank details",
        description: null,
        dueDate: null,
      }),
    );
  });

  it("preselects the filtered teacher when creating a task", async () => {
    workflow.createTask.mockClear();
    renderOverview();

    fireEvent.click(screen.getByRole("combobox", { name: "Teacher filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Amina Haddad" }));
    fireEvent.click(screen.getByRole("button", { name: /New task/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Task title"), {
      target: { value: "Chase paperwork" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create task" }));

    await waitFor(() =>
      expect(workflow.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ resourceId: "t1" }),
      ),
    );
  });

  it("reports when no task matches the filters", () => {
    renderOverview([]);

    expect(screen.getByText("No tasks match these filters.")).toBeTruthy();
  });
});
