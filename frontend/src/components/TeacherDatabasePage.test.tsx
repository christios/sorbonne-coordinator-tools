/**
 * The Part-time Teachers page as a whole: the top bar over the list, the profile's rail
 * and tabs, and the dialog a requisition starts from.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeacherDatabase, TeacherProfile } from "@/components/TeacherDatabase";
import * as lists from "@/services/portalLists";
import * as sessions from "@/services/sessionChanges";
import * as database from "@/services/studentDatabase";
import * as teachers from "@/services/teachers";
import * as timetables from "@/services/timetables";
import * as workflow from "@/services/workflow";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
Object.defineProperty(Element.prototype, "scrollIntoView", { value: vi.fn(), writable: true });
// Each screen scrolls the window to its top as it opens, which jsdom does not do.
Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });

const teacher = (over: Partial<teachers.Teacher>): teachers.Teacher => ({
  id: "t",
  folderId: null,
  fullName: "Somebody",
  email: "",
  phone: "",
  notes: "",
  archivedAt: null,
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
  ...over,
});

const FOLDERS: teachers.TeacherFolder[] = [
  { id: "f-physics", name: "Physics", parentId: null, createdAt: "", updatedAt: "" },
  { id: "f-maths", name: "Maths", parentId: null, createdAt: "", updatedAt: "" },
];

const TEACHERS = [
  teacher({ id: "t-marie", fullName: "Marie Curie", email: "marie@example.edu", folderId: "f-physics", notes: "Physics labs." }),
  teacher({ id: "t-emmy", fullName: "Emmy Noether", folderId: "f-maths" }),
  teacher({ id: "t-ada", fullName: "Ada Lovelace" }),
  teacher({ id: "t-old", fullName: "Old Timer", archivedAt: "2026-01-01T00:00:00Z" }),
];

const REQUISITION: teachers.TeacherRequisition = {
  id: "req-1",
  teacherId: "t-marie",
  label: "Semester 1",
  academicYear: "2026-2027",
  revision: 1,
  createdAt: "2026-07-24T08:00:00Z",
  updatedAt: "2026-07-24T08:00:00Z",
  content: {
    department: "Science",
    program: "",
    jobTitle: "",
    classType: "",
    employeeType: "PT",
    contractFrom: "",
    contractTo: "",
    courses: [{ id: "c1", title: "Physics", subjectCode: "PHY", courseNumber: "101", level: "L1", hours: "24" }],
    admin: [{ id: "a1", title: "Invigilation", subjectCode: "", courseNumber: "", level: "", hours: "6" }],
  },
};

function renderWith(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  // Everything the page reads, so nothing reaches for a real server.
  vi.spyOn(teachers, "listTeachers").mockResolvedValue(TEACHERS);
  vi.spyOn(teachers, "listTeacherFolders").mockResolvedValue(FOLDERS);
  vi.spyOn(teachers, "fetchTeacherSummary").mockResolvedValue({});
  vi.spyOn(teachers, "getTeacher").mockImplementation(async (id) => TEACHERS.find((row) => row.id === id) ?? TEACHERS[0]);
  vi.spyOn(teachers, "listTeacherRequisitions").mockResolvedValue([REQUISITION]);
  vi.spyOn(teachers, "getTeacherRequisition").mockResolvedValue(REQUISITION);
  vi.spyOn(teachers, "getTeacherDocuments").mockResolvedValue(null);
  vi.spyOn(teachers, "listTeacherDocumentIssues").mockResolvedValue([]);
  vi.spyOn(teachers, "listTeacherTimeSheets").mockResolvedValue([]);
  vi.spyOn(teachers, "listSubmittedTimeSheets").mockResolvedValue([]);
  vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });
  vi.spyOn(teachers, "listCourseCatalogue").mockResolvedValue([]);
  vi.spyOn(workflow, "listTasks").mockResolvedValue([]);
  vi.spyOn(workflow, "listTaskTemplates").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({ termCode: "", pulledAt: "", sections: [] });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([]);
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue([]);
  vi.spyOn(sessions, "fetchSessionChanges").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const listed = () =>
  within(screen.getByRole("list", { name: "Teachers" }))
    .getAllByRole("listitem")
    .map((row) => within(row).getByRole("img").getAttribute("aria-label")?.replace("Profile photo placeholder for ", ""));

describe("the list's top bar", () => {
  it("narrows the list to one folder, or to the teachers in none", async () => {
    renderWith(<TeacherDatabase />);
    await waitFor(() => expect(listed()).toEqual(["Marie Curie", "Emmy Noether", "Ada Lovelace"]));

    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /^Physics/ }));
    expect(listed()).toEqual(["Marie Curie"]);

    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /^Unfiled/ }));
    expect(listed()).toEqual(["Ada Lovelace"]);

    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /^All teachers/ }));
    expect(listed()).toHaveLength(3);
  });

  it("switches between the active and the archived, and says how many of each", async () => {
    renderWith(<TeacherDatabase />);
    await waitFor(() => expect(listed()).toHaveLength(3));

    const archived = screen.getByRole("button", { name: /Archived/ });
    expect(archived.textContent).toContain("1");
    fireEvent.click(archived);

    expect(archived.getAttribute("aria-pressed")).toBe("true");
    expect(listed()).toEqual(["Old Timer"]);
  });

  it("offers deleting a folder only while that folder is the one chosen", async () => {
    vi.spyOn(teachers, "deleteTeacherFolder").mockResolvedValue(undefined);
    renderWith(<TeacherDatabase />);
    await waitFor(() => expect(listed()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: /Delete folder/ })).toBeNull();

    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /^Maths/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete folder Maths" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete folder?" })).getByRole("button", { name: "Delete folder" }));

    // The first argument: the mutation passes its own context after it.
    await waitFor(() => expect(vi.mocked(teachers.deleteTeacherFolder).mock.calls[0]?.[0]).toBe("f-maths"));
    // Back to everybody, rather than a folder that is no longer there.
    expect(listed()).toHaveLength(3);
  });

  it("makes a new folder inside the one being looked at", async () => {
    vi.spyOn(teachers, "createTeacherFolder").mockResolvedValue(FOLDERS[0]);
    renderWith(<TeacherDatabase />);
    await waitFor(() => expect(listed()).toHaveLength(3));

    fireEvent.click(screen.getByRole("combobox", { name: "Folder" }));
    fireEvent.click(screen.getByRole("option", { name: /^Physics/ }));
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const dialog = screen.getByRole("dialog", { name: "New folder" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Folder name" }), { target: { value: "Labs" } });
    fireEvent.click(screen.getByRole("button", { name: "Create folder" }));

    await waitFor(() =>
      expect(vi.mocked(teachers.createTeacherFolder).mock.calls[0]?.[0]).toEqual({ name: "Labs", parentId: "f-physics" }),
    );
  });

  it("puts the tasks in the same place as the list, and the teachers back again", async () => {
    renderWith(<TeacherDatabase />);
    await waitFor(() => expect(listed()).toHaveLength(3));

    fireEvent.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(screen.getByRole("tab", { name: "Tasks" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("searchbox", { name: "Search tasks" })).toBeTruthy();
    // The teacher filters belong to the teachers, and go with them.
    expect(screen.queryByRole("combobox", { name: "Folder" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Teachers" }));
    expect(listed()).toHaveLength(3);
  });
});

describe("a teacher's profile", () => {
  function profile(onOpenRequisition = vi.fn()) {
    renderWith(
      <TeacherProfile teacherId="t-marie" onBack={vi.fn()} onOpenRequisition={onOpenRequisition} onChanged={vi.fn()} />,
    );
    return onOpenRequisition;
  }

  it("keeps the contact, notes and documents in the rail, and the tasks in a tab of their own", async () => {
    profile();

    const rail = await screen.findByRole("complementary", { name: "Teacher summary" });
    expect(within(rail).getByText("marie@example.edu")).toBeTruthy();
    expect(within(rail).getByText("Physics labs.")).toBeTruthy();
    expect(within(rail).getByRole("region", { name: /Documents/ })).toBeTruthy();
    expect(within(rail).queryByRole("region", { name: "Tasks" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Marie Curie" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /^Tasks/ }));
    expect(await screen.findByRole("region", { name: "Tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add task/ })).toBeTruthy();
  });

  it("shows each requisition with its teaching and admin hours", async () => {
    profile();

    const row = (await screen.findByRole("button", { name: "Open Semester 1" })).closest("article") as HTMLElement;
    await waitFor(() => expect(within(row).getByText("24 h")).toBeTruthy());
    expect(within(row).getByText("6 h")).toBeTruthy();
    expect(within(row).getByText("2026-2027")).toBeTruthy();
  });

  it("switches between the requisitions and the time sheets", async () => {
    profile();

    const requisitions = await screen.findByRole("tab", { name: /Requisitions/ });
    expect(requisitions.getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByRole("searchbox", { name: "Search requisitions" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Time sheets/ }));

    expect(screen.getByRole("tab", { name: /Time sheets/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("searchbox", { name: "Search requisitions" })).toBeNull();
    expect(await screen.findByRole("combobox", { name: "Semester for the hours" })).toBeTruthy();
  });

  it("has Requisitions, Time sheets and Tasks, and no Timetable tab", async () => {
    profile();
    await screen.findByRole("tab", { name: /Requisitions/ });
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual([
      "Requisitions",
      "Time sheets",
      "Tasks",
    ]);
  });

  it("starts a requisition from a dialog whose fields sit side by side, and opens it", async () => {
    const created = { ...REQUISITION, id: "req-new", label: "Semester 2" };
    vi.spyOn(teachers, "createTeacherRequisition").mockResolvedValue(created);
    const onOpenRequisition = profile();

    fireEvent.click(await screen.findByRole("button", { name: /New requisition/ }));
    const dialog = screen.getByRole("dialog", { name: "New requisition for Marie Curie" });
    const create = within(dialog).getByRole("button", { name: "Create and edit" });
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox", { name: "Request label" }), { target: { value: "Semester 2" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Academic year" }), { target: { value: "2027-2028" } });
    fireEvent.click(within(dialog).getByRole("combobox", { name: "Starting point" }));
    fireEvent.click(screen.getByRole("option", { name: "Copy of Semester 1 — 2026-2027" }));
    fireEvent.click(create);

    await waitFor(() =>
      expect(teachers.createTeacherRequisition).toHaveBeenCalledWith("t-marie", {
        label: "Semester 2",
        academicYear: "2027-2028",
        sourceRequisitionId: "req-1",
      }),
    );
    await waitFor(() => expect(onOpenRequisition).toHaveBeenCalledWith("req-new"));
  });

  it("edits the profile from the header, in a dialog", async () => {
    vi.spyOn(teachers, "updateTeacher").mockImplementation(async (_id, input) => ({ ...TEACHERS[0], ...input }));
    profile();

    fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
    const dialog = screen.getByRole("dialog", { name: "Edit profile" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Full name" }), { target: { value: "Marie Skłodowska-Curie" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(teachers.updateTeacher).toHaveBeenCalledWith(
        "t-marie",
        expect.objectContaining({ fullName: "Marie Skłodowska-Curie" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit profile" })).toBeNull());
  });
});
