import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CohortActions } from "@/components/CohortActions";
import * as database from "@/services/studentDatabase";
import type { Cohort, SemesterReach } from "@/services/studentDatabase";
import * as timetables from "@/services/timetables";
import type { TimetableTerm } from "@/services/timetables";

const FYS: Cohort = {
  id: "fys",
  name: "FYS",
  term: "2026-27",
  notes: "",
  majors: [],
  terms: [],
  yearLevel: "FY",
  workbookTab: "",
  firstSemester: 0,
  allowedCodes: [],
  memberCount: 139,
  scopeCount: 4,
  createdAt: "",
  updatedAt: "",
};

const SPRING = { id: "plan:262720", name: "Semester 2" };

const reach = (over: Partial<SemesterReach> = {}): SemesterReach => ({
  termId: SPRING.id,
  members: 139,
  sets: [{ code: "TD", openToAll: false, groups: 7, placements: 139, others: 0 }],
  groups: 7,
  placements: 139,
  othersPlacements: 0,
  sharedSets: [],
  sharedPlacements: 0,
  otherSemesters: ["plan:262710"],
  ...over,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CohortActions cohort={FYS} semester={SPRING} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "plan:262710", name: "Semester 1" } as TimetableTerm,
    { id: "plan:262720", name: "Semester 2" } as TimetableTerm,
  ]);
});

afterEach(() => vi.restoreAllMocks());

/*
 * On 9 Nov 2026 FYS was deleted from Semester 2 and took Semester 1 with it — every
 * student's French group included. The bin button now acts on the semester on screen only.
 */
describe("the bin button, with a semester on screen", () => {
  it("removes the cohort from that semester only, once its name is typed", async () => {
    vi.spyOn(database, "fetchSemesterReach").mockResolvedValue(reach());
    const removed = vi.spyOn(database, "removeCohortFromSemester").mockResolvedValue(reach());
    const deleted = vi.spyOn(database, "deleteCohort").mockResolvedValue();
    show();

    fireEvent.click(screen.getByRole("button", { name: "Remove FYS from Semester 2" }));

    expect(await screen.findByText("Remove FYS from Semester 2?")).toBeTruthy();
    const said = await screen.findByText(/Only Semester 2 changes/);
    expect(said.textContent).toContain("FYS stays exactly as it is in Semester 1");
    const confirm = screen.getByRole("button", { name: "Remove from Semester 2" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Type FYS to confirm" }), { target: { value: "FYS" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(removed).toHaveBeenCalledWith("fys", "plan:262720"));
    expect(deleted).not.toHaveBeenCalled();
  });

  it("says out loud when a set open to every cohort takes other cohorts' students with it", async () => {
    vi.spyOn(database, "fetchSemesterReach").mockResolvedValue(
      reach({
        sets: [{ code: "LANG", openToAll: true, groups: 20, placements: 330, others: 195 }],
        placements: 330,
        othersPlacements: 195,
      }),
    );
    show();

    fireEvent.click(screen.getByRole("button", { name: "Remove FYS from Semester 2" }));

    expect((await screen.findByText(/Only Semester 2 changes/)).textContent).toContain(
      "195 of those placements are OTHER cohorts' students in LANG, which is open to every cohort",
    );
  });

  it("says its students lose their language groups, kept in another cohort's set", async () => {
    vi.spyOn(database, "fetchSemesterReach").mockResolvedValue(
      reach({ sets: [], groups: 0, placements: 0, sharedSets: ["LANG"], sharedPlacements: 43 }),
    );
    show();

    fireEvent.click(screen.getByRole("button", { name: "Remove FYS from Semester 2" }));

    expect((await screen.findByText(/Only Semester 2 changes/)).textContent).toContain(
      "Its students also lose their 43 group(s) in LANG, the set open to every cohort",
    );
  });

  it("removes nothing when the cohort holds nothing in that semester, and says where it is", async () => {
    vi.spyOn(database, "fetchSemesterReach").mockResolvedValue(reach({ members: 0, sets: [], groups: 0, placements: 0 }));
    const removed = vi.spyOn(database, "removeCohortFromSemester");
    show();

    fireEvent.click(screen.getByRole("button", { name: "Remove FYS from Semester 2" }));

    expect(await screen.findByText("FYS has nothing in Semester 2")).toBeTruthy();
    expect(screen.getByText(/It holds students or sets in Semester 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(removed).not.toHaveBeenCalled();
  });

  it("deletes the cohort itself only when no other semester holds anything of it", async () => {
    vi.spyOn(database, "fetchSemesterReach").mockResolvedValue(reach({ otherSemesters: [] }));
    const deleted = vi.spyOn(database, "deleteCohort").mockResolvedValue();
    show();

    fireEvent.click(screen.getByRole("button", { name: "Remove FYS from Semester 2" }));

    expect(await screen.findByText("Delete FYS?")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Type FYS to confirm" }), { target: { value: "FYS" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete cohort" }));

    await waitFor(() => expect(deleted).toHaveBeenCalledWith("fys"));
  });
});
