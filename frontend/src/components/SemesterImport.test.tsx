import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SemesterImport } from "@/components/SemesterImport";
import * as timetables from "@/services/timetables";

const TERM: timetables.TimetableTerm = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "physics-maths-semester-1",
  timezone: "Asia/Dubai",
  isPublished: false,
  courseCount: 43,
  sessionCount: 975,
  studentCount: 0,
  timetableFilename: "PHYS-MATHS-FY-SEM.1-Revised.xls",
  enrolmentFilename: "",
  updatedAt: "2026-08-21T18:00:00Z",
};

function renderImport() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SemesterImport host="scen.example.dev" />
    </QueryClientProvider>,
  );
}

function fillIn() {
  const excel = new File(["x"], "timetable.xls", { type: "application/vnd.ms-excel" });
  fireEvent.change(screen.getByLabelText(/Timetable export/), { target: { files: [excel] } });
  fireEvent.change(screen.getByLabelText(/Semester name/), {
    target: { value: "Physics & Maths — Semester 1" },
  });
}

const importButton = () => screen.getByRole("button", { name: /Import to student platform/ }) as HTMLButtonElement;

afterEach(() => vi.restoreAllMocks());

describe("importing a timetable", () => {
  it("asks for the registrar export and nothing else", () => {
    // The student lists are gone: who is in which group is this application's own
    // knowledge now, and it reaches students through Publish.
    renderImport();

    expect(screen.getByText("Import a timetable")).toBeTruthy();
    expect(screen.queryByLabelText(/Student lists/)).toBeNull();
  });

  it("waits for a name and the export, then allows the import", () => {
    renderImport();
    expect(importButton().disabled).toBe(true);

    fillIn();

    expect(importButton().disabled).toBe(false);
  });

  it("sends the export alone", async () => {
    const importTerm = vi.spyOn(timetables, "importTimetableTerm").mockResolvedValue(TERM);
    renderImport();
    fillIn();

    fireEvent.click(importButton());

    expect(await screen.findByText(/uploaded/)).toBeTruthy();
    expect(importTerm).toHaveBeenCalledWith({
      name: "Physics & Maths — Semester 1",
      timetable: expect.any(File),
    });
  });

  it("says a semester with nobody on it is waiting to be published to, not broken", async () => {
    vi.spyOn(timetables, "importTimetableTerm").mockResolvedValue(TERM);
    renderImport();
    fillIn();

    fireEvent.click(importButton());

    const banner = (await screen.findByText(/uploaded/)).closest("div") as HTMLElement;
    expect(banner.textContent).toContain("0 student(s) on it");
    expect(banner.textContent).toContain("place the cohort, then publish");
  });

  it("shows the platform's own explanation when the export is rejected", async () => {
    vi.spyOn(timetables, "importTimetableTerm").mockRejectedValue(
      new Error("That file could not be read as an Excel workbook."),
    );
    renderImport();
    fillIn();

    fireEvent.click(importButton());

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((alert) => alert.textContent).join(" ")).toContain(
      "could not be read as an Excel workbook",
    );
  });
});
