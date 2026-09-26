import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemesterTimetable } from "@/components/SemesterTimetable";
import * as lists from "@/services/portalLists";
import * as notes from "@/services/sessionChanges";
import * as termWeeks from "@/services/termWeeks";
import type { TimetableTerm } from "@/services/timetables";

const TERM = { id: "term-1", name: "Semester 1" } as TimetableTerm;
const MONDAY = { meetsOn: "2026-09-07", startsAt: "08:30", endsAt: "10:00", room: "5.101" };

/** Three sections of two subjects, taught by two people. */
const CRNS = {
  "23436": { courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", status: "in_portal" },
  "22610": { courseCode: "PHYS-210", title: "Maths for Physics", teacherName: "Gianluca Mola", status: "in_portal" },
  "24092": { courseCode: "MATH-257", title: "Graphs", teacherName: "Grace Younes", status: "in_portal" },
  // Gone from the portal's list: not part of the week any more.
  "11111": { courseCode: "MATH-999", title: "Withdrawn", teacherName: "Nobody", status: "not_in_portal" },
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SemesterTimetable term={TERM} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The filters, the zooms and the week are kept by the browser now; each test starts clean.
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 9, 10, 0, 0));
  vi.spyOn(notes, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({ portalTermCode: "262710", crns: CRNS });
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
    termCode: "262710",
    pulledAt: "2026-09-01T00:00:00+00:00",
    sections: [
      { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
      { crn: "22610", courseCode: "PHYS-210", title: "Maths for Physics", teacherName: "Gianluca Mola", state: "published", meetings: [MONDAY] },
      { crn: "24092", courseCode: "MATH-257", title: "Graphs", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
    ],
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a semester's whole week", () => {
  it("asks the registrar for every live section of the semester, and not the withdrawn one", async () => {
    show();

    expect(await screen.findByText("3 of 3")).toBeTruthy();
    // The one the portal no longer lists is not asked about at all.
    expect(lists.fetchFacilitySections).toHaveBeenCalledWith("262710", ["22610", "23436", "24092"]);
  });

  /** Compose a filter the way a table's is: pick the column, then the value. */
  const filterOn = async (column: string, value: string) => {
    fireEvent.click(screen.getByRole("button", { name: /^(Filter|Add filter)$/ }));
    fireEvent.click(await screen.findByRole("button", { name: column }));
    fireEvent.click(await screen.findByRole("combobox", { name: `${column} value` }));
    fireEvent.click(await screen.findByRole("option", { name: value }));
  };

  it("narrows with the tables' own filters, says so, and can be widened again", async () => {
    /*
     * The filters are part of the feature rather than a refinement of it: at the worst
     * hour of a real semester sixteen sections share one weekday and start time, which is
     * enough to see the shape of the hour and not enough to read a room off.
     */
    show();
    await screen.findByText("3 of 3");

    await filterOn("Subject", "MATH");

    expect(await screen.findByText("2 of 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Every section" }));
    expect(await screen.findByText("3 of 3")).toBeTruthy();
  });

  it("filters on a class's room, and draws only the classes in it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, { ...MONDAY, meetsOn: "2026-09-09", room: "4.124" }] },
        { crn: "22610", courseCode: "PHYS-210", title: "Maths for Physics", teacherName: "Gianluca Mola", state: "published", meetings: [MONDAY] },
        { crn: "24092", courseCode: "MATH-257", title: "Graphs", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
      ],
    });
    show();
    await screen.findByText("3 of 3");

    await filterOn("Room", "4.124");

    expect(await screen.findByText("1 of 3")).toBeTruthy();
    // Algebra's Wednesday in 4.124 is drawn; its Monday in 5.101 is not.
    expect(document.querySelector('[title*="4.124"]')).toBeTruthy();
    expect(document.querySelector('[title*="5.101"]')).toBeNull();
  });

  it("searches the sections as a table does", async () => {
    show();
    await screen.findByText("3 of 3");

    fireEvent.change(screen.getByLabelText("Search sections"), { target: { value: "mola" } });

    expect(await screen.findByText("1 of 3")).toBeTruthy();
  });

  it("keeps its filters and zooms when you leave and come back", async () => {
    // They were the page's alone: a step to a CRN's record and back put every one to its default.
    const first = show();
    await screen.findByText("3 of 3");
    await filterOn("Subject", "MATH");
    expect(await screen.findByText("2 of 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Height of a class"), { target: { value: "40" } });
    first.unmount();

    show();

    expect(await screen.findByText("2 of 3")).toBeTruthy();
    expect((screen.getByLabelText("Height of a class") as HTMLInputElement).value).toBe("40");
  });

  it("numbers the week from the semester's Week 1, and jumps to any week", async () => {
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": "2026-09-02" });
    const first = show();

    // The classes meet on 7 September; Week 1 is the week of 2 September.
    const week = await screen.findByRole("combobox", { name: "Teaching week" });
    // The closed picker says the week and nothing else: a date beside it squeezed "Week 2" to "W".
    expect(week.textContent).toBe("Week 2");
    fireEvent.click(week);
    fireEvent.click(await screen.findByRole("option", { name: /Week 1/ }));
    expect(await screen.findByText("31 Aug 2026 – 4 Sep 2026")).toBeTruthy();

    // And coming back, in this tab, lands on the week you left.
    first.unmount();
    show();
    expect(await screen.findByText("31 Aug 2026 – 4 Sep 2026")).toBeTruthy();
  });

  it("says no week number where the semester has no Week 1", async () => {
    show();

    await screen.findByText("3 of 3");
    expect(screen.queryByRole("combobox", { name: "Teaching week" })).toBeNull();
  });

  describe("what it says it could not draw", () => {
    /** A register row, with only the fields the count reads spelled out. */
    const row = (crn: string, childCount: number, usedBy: number) =>
      ({ crn, courseCode: "MATH-100", childCount, usedBy }) as lists.ActiveCrn;

    /** Two sections nobody has swept: one a real class, one the course-level row above it. */
    function unswept() {
      vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({
        portalTermCode: "262710",
        crns: {
          ...CRNS,
          "24001": { courseCode: "MATH-100", title: "Maths G.4-TD", teacherName: "", status: "in_portal" },
          "24248": { courseCode: "MATH-100", title: "Mathematics 1", teacherName: "", status: "in_portal" },
        },
      });
      vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
        termCode: "262710",
        pulledAt: "2026-09-01T00:00:00+00:00",
        sections: [
          { crn: "24001", courseCode: "", title: "", teacherName: "", state: "unchecked", meetings: [] },
          { crn: "24248", courseCode: "", title: "", teacherName: "", state: "unchecked", meetings: [] },
        ],
      });
    }

    it("passes over a course-level row, which holds no hours of its own", async () => {
      // Thirty of these on a real semester, against eighteen sections genuinely missing:
      // counted, they made the honest number unreadable.
      unswept();
      vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([row("24001", 0, 1), row("24248", 4, 0)]);
      show();

      expect(await screen.findByText("1 not drawn")).toBeTruthy();
    });

    it("counts a parent that is itself taught, whose absence from the week is real", async () => {
      unswept();
      vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([row("24001", 0, 1), row("24248", 4, 2)]);
      show();

      expect(await screen.findByText("2 not drawn")).toBeTruthy();
    });
  });

  it("says plainly when the semester is not linked to a portal term", async () => {
    // Without a link the registrar has nothing filed under it, and a blank grid would read
    // as "nothing is taught" rather than "nobody has asked".
    vi.spyOn(lists, "fetchTermCrns").mockRejectedValue(new Error("no link"));
    show();

    expect(await screen.findByText(/not linked to a portal term/)).toBeTruthy();
  });
});
