import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemesterList } from "@/components/SemesterList";
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

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SemesterList host="scen.example.dev" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([TERM]);
});

afterEach(() => vi.restoreAllMocks());

describe("the semesters the platform holds", () => {
  it("lists them with what each one contains", async () => {
    renderList();

    const row = await screen.findByRole("row", { name: /Physics & Maths/ });
    expect(within(row).getByText("43")).toBeTruthy();
    expect(within(row).getByText("975")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "Hidden" })).toBeTruthy();
  });

  it("uses the shared select control, not a native one", async () => {
    // docs/handoffs/ui-ux-decisions.md: no native <select> in product UI.
    renderList();
    await screen.findByRole("row", { name: /Physics & Maths/ });

    expect(document.querySelector("select")).toBeNull();
  });

  it("publishes a hidden semester", async () => {
    const publish = vi
      .spyOn(timetables, "setTimetableTermPublished")
      .mockResolvedValue({ ...TERM, isPublished: true });
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Hidden" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith("term-1", true));
  });

  it("asks for confirmation before deleting a semester", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/975 sessions will be removed/)).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete semester" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("term-1"));
  });

  it("leaves the semester alone when the confirmation is dismissed", async () => {
    const remove = vi.spyOn(timetables, "deleteTimetableTerm").mockResolvedValue();
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(remove).not.toHaveBeenCalled();
  });
});


/*
 * Uploading a timetable is retired: the hours a clash is worked out from come from the
 * registrar's own timetable now, swept section by section as the last step of Portal sync.
 *
 * The tests that drove the two upload flows through this page went with the buttons. The
 * components themselves are untouched and `SemesterImport.test.tsx` still exercises one
 * directly, so bringing the feature back is uncommenting two buttons — not rebuilding it.
 */
describe("uploading a timetable, retired", () => {
  it("offers neither way in, and says why", async () => {
    renderList();

    expect(await screen.findByText(/Uploading a timetable is retired/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Import a timetable/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update timetable/ })).toBeNull();
  });

  it("still lists what was uploaded before, so nothing is lost", async () => {
    renderList();

    expect(await screen.findByText("Physics & Maths — Semester 1")).toBeTruthy();
    expect(screen.getByText("PHYS-MATHS-FY-SEM.1-Revised.xls")).toBeTruthy();
  });
});
