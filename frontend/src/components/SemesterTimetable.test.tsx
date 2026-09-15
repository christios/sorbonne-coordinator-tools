import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SemesterTimetable } from "@/components/SemesterTimetable";
import * as lists from "@/services/portalLists";
import * as notes from "@/services/sessionChanges";
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
  render(
    <QueryClientProvider client={client}>
      <SemesterTimetable term={TERM} open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 9, 10, 0, 0));
  vi.spyOn(notes, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(lists, "fetchTermCrns").mockResolvedValue({ portalTermCode: "262710", crns: CRNS });
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

    expect(await screen.findByText("3 of 3 sections")).toBeTruthy();
    // The one the portal no longer lists is not asked about at all.
    expect(lists.fetchFacilitySections).toHaveBeenCalledWith("262710", ["22610", "23436", "24092"]);
  });

  it("narrows to a subject, and says so, and can be widened again", async () => {
    /*
     * The filters are part of the feature rather than a refinement of it: at the worst
     * hour of a real semester sixteen sections share one weekday and start time, which is
     * enough to see the shape of the hour and not enough to read a room off.
     */
    show();
    await screen.findByText("3 of 3 sections");

    fireEvent.click(screen.getByRole("combobox", { name: "Subjects" }));
    fireEvent.click(await screen.findByRole("option", { name: "MATH" }));

    expect(await screen.findByText("2 of 3 sections shown")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show every section" }));
    expect(await screen.findByText("3 of 3 sections")).toBeTruthy();
  });

  it("says plainly when the semester is not linked to a portal term", async () => {
    // Without a link the registrar has nothing filed under it, and a blank grid would read
    // as "nothing is taught" rather than "nobody has asked".
    vi.spyOn(lists, "fetchTermCrns").mockRejectedValue(new Error("no link"));
    show();

    expect(await screen.findByText(/not linked to a portal term/)).toBeTruthy();
  });
});
