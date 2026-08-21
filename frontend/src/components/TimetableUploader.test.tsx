import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimetableUploader } from "@/components/TimetableUploader";
import * as timetables from "@/services/timetables";

const TERM: timetables.TimetableTerm = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "physics-maths-semester-1",
  timezone: "Asia/Dubai",
  isPublished: false,
  courseCount: 43,
  sessionCount: 975,
  studentCount: 180,
  timetableFilename: "PHYS-MATHS-FY-SEM.1-Revised.xls",
  enrolmentFilename: "students.xlsx",
  updatedAt: "2026-08-21T18:00:00Z",
};

function renderTool() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TimetableUploader />
    </QueryClientProvider>,
  );
}

function chooseFiles(students = ["FYS-Groups.xlsx"]) {
  const excel = new File(["x"], "timetable.xls", { type: "application/vnd.ms-excel" });
  const lists = students.map((name) => new File(["y"], name, { type: "application/vnd.ms-excel" }));
  fireEvent.change(screen.getByLabelText(/Timetable export/), { target: { files: [excel] } });
  fireEvent.change(screen.getByLabelText(/Student lists/), { target: { files: lists } });
  fireEvent.change(screen.getByLabelText(/Semester name/), { target: { value: "Physics & Maths — Semester 1" } });
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableStatus").mockResolvedValue({ configured: true, host: "scen.example.dev" });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([TERM]);
  // The announcement editor shares this screen; keep its own request out of the way.
  vi.spyOn(timetables, "fetchAnnouncements").mockResolvedValue({ announcements: [], icons: ["info"] });
});

afterEach(() => vi.restoreAllMocks());

describe("TimetableUploader", () => {
  it("explains itself when the deployment has no student platform configured", async () => {
    vi.spyOn(timetables, "fetchTimetableStatus").mockResolvedValue({ configured: false, host: null });

    renderTool();

    expect(await screen.findByText("Timetable uploads are not configured")).toBeTruthy();
    expect(screen.getByText(/SCEN_STUDENT_PLATFORM_URL/)).toBeTruthy();
  });

  it("lists the semesters already on the platform", async () => {
    renderTool();

    const row = await screen.findByRole("row", { name: /Physics & Maths/ });
    expect(within(row).getByText("43")).toBeTruthy();
    expect(within(row).getByText("975")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Hidden" })).toBeTruthy();
  });

  it("keeps the upload button disabled until the name and both files are chosen", async () => {
    renderTool();
    await screen.findByRole("row", { name: /Physics & Maths/ });
    const upload = screen.getByRole("button", { name: /Upload to student platform/ });

    expect((upload as HTMLButtonElement).disabled).toBe(true);
    chooseFiles();

    expect((upload as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports what the platform stored after an upload", async () => {
    const importTerm = vi.spyOn(timetables, "importTimetableTerm").mockResolvedValue(TERM);
    renderTool();
    await screen.findByRole("row", { name: /Physics & Maths/ });
    chooseFiles();

    fireEvent.click(screen.getByRole("button", { name: /Upload to student platform/ }));

    expect(await screen.findByText(/uploaded/)).toBeTruthy();
    expect(screen.getByText(/43 courses, 975 sessions, 180 students/)).toBeTruthy();
    expect(importTerm).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Physics & Maths — Semester 1" }),
    );
    expect(importTerm.mock.calls[0][0].enrolments).toHaveLength(1);
  });

  it("shows the platform's own explanation when a workbook is rejected", async () => {
    vi.spyOn(timetables, "importTimetableTerm").mockRejectedValue(
      new Error("That file could not be read as an Excel workbook."),
    );
    renderTool();
    await screen.findByRole("row", { name: /Physics & Maths/ });
    chooseFiles();

    fireEvent.click(screen.getByRole("button", { name: /Upload to student platform/ }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent).join(" ")).toContain("could not be read as an Excel workbook");
  });

  it("publishes a hidden semester", async () => {
    const publish = vi
      .spyOn(timetables, "setTimetableTermPublished")
      .mockResolvedValue({ ...TERM, isPublished: true });
    renderTool();

    fireEvent.click(await screen.findByRole("button", { name: "Hidden" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith("term-1", true));
  });

  it("asks for confirmation before deleting a semester", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderTool();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/975 sessions will be removed/)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete semester" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("term-1"));
  });

  it("leaves the semester alone when the confirmation is dismissed", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderTool();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });
});


describe("TimetableUploader with several student workbooks", () => {
  it("sends every list the coordinator picked", async () => {
    const importTerm = vi.spyOn(timetables, "importTimetableTerm").mockResolvedValue({
      ...TERM,
      studentLists: [
        { filename: "FYS-Groups.xlsx", style: "groups", sheets: ["TD"], students: 24, unknownGroups: [] },
        { filename: "LANG-Groups.xlsx", style: "groups", sheets: ["LANG"], students: 24, unknownGroups: ["LANG: LANG|B2-G9|SCEN101"] },
      ],
    });
    renderTool();
    await screen.findByRole("row", { name: /Physics & Maths/ });

    chooseFiles(["FYS-Groups.xlsx", "L1-Groups.xlsx", "LANG-Groups.xlsx"]);
    fireEvent.click(screen.getByRole("button", { name: /Upload to student platform/ }));

    await waitFor(() => expect(importTerm).toHaveBeenCalled());
    expect(importTerm.mock.calls[0][0].enrolments.map((file: File) => file.name)).toEqual([
      "FYS-Groups.xlsx",
      "L1-Groups.xlsx",
      "LANG-Groups.xlsx",
    ]);
  });

  it("reports what each workbook contributed, including groups with no CRN", async () => {
    vi.spyOn(timetables, "importTimetableTerm").mockResolvedValue({
      ...TERM,
      studentLists: [
        { filename: "FYS-Groups.xlsx", style: "groups", sheets: ["TD"], students: 24, unknownGroups: [] },
        { filename: "LANG-Groups.xlsx", style: "groups", sheets: ["LANG"], students: 24, unknownGroups: ["LANG: LANG|B2-G9|SCEN101"] },
      ],
    });
    renderTool();
    await screen.findByRole("row", { name: /Physics & Maths/ });
    chooseFiles(["FYS-Groups.xlsx", "LANG-Groups.xlsx"]);

    fireEvent.click(screen.getByRole("button", { name: /Upload to student platform/ }));

    expect(await screen.findByText(/FYS-Groups.xlsx: 24 students from TD/)).toBeTruthy();
    expect(screen.getByText(/1 groups with no CRN/)).toBeTruthy();
  });
});
