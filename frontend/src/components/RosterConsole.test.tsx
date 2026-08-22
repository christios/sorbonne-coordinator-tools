import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RosterConsole } from "@/components/RosterConsole";
import * as rosters from "@/services/scenRosters";
import * as timetables from "@/services/timetables";

const TERM = {
  id: "term-1",
  name: "Physics & Maths — Semester 1",
  slug: "s1",
  timezone: "Asia/Dubai",
  isPublished: true,
  courseCount: 3,
  sessionCount: 9,
  studentCount: 1,
  timetableFilename: "timetable.xlsx",
  enrolmentFilename: "groups.xlsx",
  updatedAt: "2026-08-22T06:00:00+00:00",
} satisfies timetables.TimetableTerm;

const ROSTER: timetables.Roster = {
  courses: [
    { crn: "22151", code: "MATH-001-CM-GR.A", title: "Pre-Calculus", shortTitle: "Pre-Calculus", kind: "Lecture", group: "Gr. A", staff: "" },
    { crn: "22152", code: "MATH-001-CM-GR.B", title: "Pre-Calculus", shortTitle: "Pre-Calculus", kind: "Lecture", group: "Gr. B", staff: "" },
  ],
  students: [{ studentId: "A00021503", crns: ["22151"], version: 2, updatedAt: "", updatedBy: "" }],
};

const PORTAL: rosters.PortalRoster = {
  presetId: "scen-fy",
  name: "SCEN — First Year",
  count: 2,
  expect: 2,
  warning: null,
  fetchedAt: Date.now(),
  rows: [
    { SPRIDEN_ID: "A00021503", FULL_NAME: "Amira Example", YEARLEVEL_CODE: "FY" },
    { SPRIDEN_ID: "A00099999", FULL_NAME: "Nadia Newcomer", YEARLEVEL_CODE: "FY" },
  ],
};

function renderConsole() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RosterConsole term={TERM} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchRoster").mockResolvedValue(ROSTER);
  vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(true);
  vi.spyOn(rosters, "listPresets").mockResolvedValue([{ id: "scen-fy", name: "SCEN — First Year", expect: 2 }]);
  vi.spyOn(rosters, "pullRoster").mockResolvedValue(PORTAL);
});

afterEach(() => vi.restoreAllMocks());

async function pull() {
  fireEvent.click(await screen.findByRole("button", { name: /pull from portal/i }));
  await screen.findByText(/2 students from/i);
}

describe("RosterConsole", () => {
  it("shows the semester's students by id until a roster is pulled", async () => {
    renderConsole();

    expect(await screen.findByText("A00021503")).toBeTruthy();
    expect(screen.getByText(/no name until you pull the roster/i)).toBeTruthy();
  });

  it("names the students once the extension answers, and flags the new one", async () => {
    renderConsole();
    await pull();

    expect(screen.getByText("Amira Example")).toBeTruthy();
    // "Joined" is also a filter button, so read the badge inside the newcomer's own row.
    const newcomer = screen.getByText("Nadia Newcomer").closest("tr") as HTMLElement;
    expect(within(newcomer).getByText("Joined")).toBeTruthy();
  });

  it("flags a student the portal no longer has", async () => {
    vi.spyOn(rosters, "pullRoster").mockResolvedValue({
      ...PORTAL,
      count: 1,
      rows: [{ SPRIDEN_ID: "A00099999", FULL_NAME: "Nadia Newcomer" }],
    });
    renderConsole();
    fireEvent.click(await screen.findByRole("button", { name: /pull from portal/i }));

    expect(await screen.findByText(/left the portal/i)).toBeTruthy();
  });

  it("sends only the id and the CRNs when a group changes", async () => {
    const save = vi.spyOn(timetables, "saveStudentAssignment").mockResolvedValue({
      studentId: "A00021503",
      crns: ["22152"],
      version: 3,
      updatedAt: "2026-08-22T07:00:00+00:00",
      updatedBy: "christian@sorbonne.ae",
    });
    renderConsole();
    await pull();

    fireEvent.change(screen.getByLabelText("MATH-001 CM group for Amira Example"), { target: { value: "22152" } });

    await waitFor(() => expect(save).toHaveBeenCalled());
    const sent = save.mock.calls[0][0];
    expect(sent).toEqual({ termId: "term-1", studentId: "A00021503", crns: ["22152"], version: 2 });
    // The privacy rule, pinned: no name and no e-mail may cross to our API.
    expect(JSON.stringify(sent)).not.toContain("Amira");
  });

  it("places a student the portal has just added", async () => {
    const save = vi.spyOn(timetables, "saveStudentAssignment").mockResolvedValue({
      studentId: "A00099999",
      crns: ["22151"],
      version: 1,
      updatedAt: "2026-08-22T07:00:00+00:00",
      updatedBy: "christian@sorbonne.ae",
    });
    renderConsole();
    await pull();

    fireEvent.change(screen.getByLabelText("MATH-001 CM group for Nadia Newcomer"), { target: { value: "22151" } });

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toMatchObject({ studentId: "A00099999", crns: ["22151"], version: 0 });
  });

  it("says who got there first when the save is refused", async () => {
    vi.spyOn(timetables, "saveStudentAssignment").mockRejectedValue(
      new timetables.AssignmentConflictError(3, "patricia@sorbonne.ae", new Date().toISOString()),
    );
    renderConsole();
    await pull();

    fireEvent.change(screen.getByLabelText("MATH-001 CM group for Amira Example"), { target: { value: "22152" } });

    const warning = await screen.findByRole("alert");
    expect(warning.textContent).toContain("patricia@sorbonne.ae");
  });

  it("still works with no extension, and says so", async () => {
    vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(false);
    vi.spyOn(rosters, "listPresets").mockResolvedValue([]);
    renderConsole();

    expect(await screen.findByText(/extension is not answering/i)).toBeTruthy();
    expect(screen.getByText("A00021503")).toBeTruthy();
  });

  it("warns when the saved search comes back empty", async () => {
    vi.spyOn(rosters, "pullRoster").mockResolvedValue({ ...PORTAL, count: 0, rows: [], warning: "zero_rows" });
    renderConsole();
    fireEvent.click(await screen.findByRole("button", { name: /pull from portal/i }));

    expect(await screen.findByText(/returned nobody/i)).toBeTruthy();
  });
});
