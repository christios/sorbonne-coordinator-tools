import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import * as lists from "@/services/portalLists";
import * as notes from "@/services/sessionChanges";

const MONDAY = { meetsOn: "2026-09-07", startsAt: "08:30", endsAt: "10:00", room: "5.101" };
const TUESDAY = { meetsOn: "2026-09-08", startsAt: "13:30", endsAt: "15:00", room: "5.202" };

function show(entries: TimetableEntry[], onPickSession?: (session: { crn: string; date: string }) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SectionTimetable entries={entries} emptyMessage="Nobody here." onPickSession={onPickSession} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 9, 10, 0, 0));
  vi.spyOn(notes, "fetchSessionChanges").mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a handful of sections, as the registrar has them", () => {
  it("draws every meeting of the week the next class falls in, and names what it cannot see", async () => {
    const read = vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, TUESDAY] },
        { crn: "99999", courseCode: "", title: "", teacherName: "", state: "unchecked", meetings: [] },
      ],
    });

    show([
      { termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" },
      { termCode: "262710", crn: "99999", code: "PHYS-101", title: "Mechanics" },
    ]);

    expect(await screen.findAllByLabelText(/CRN 23436/)).toHaveLength(2);
    expect(screen.getByText("7 Sep 2026 – 11 Sep 2026")).toBeTruthy();
    // One read per term, for exactly the sections asked about.
    expect(read).toHaveBeenCalledWith("262710", ["23436", "99999"]);
    const cannot = screen.getByLabelText("What the timetable cannot show");
    expect(within(cannot).getByText(/Nobody has asked the registrar about 99999/)).toBeTruthy();
  });

  it("walks the weeks, and comes back to the current one", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "",
      sections: [{ crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "", state: "published", meetings: [MONDAY] }],
    });

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]);
    await screen.findByLabelText(/CRN 23436/);

    fireEvent.click(screen.getByLabelText("Next week"));
    expect(screen.getByText("14 Sep 2026 – 18 Sep 2026")).toBeTruthy();
    expect(screen.getByText("No classes this week.")).toBeTruthy();
    fireEvent.click(screen.getByText("Current week"));
    expect(screen.getByText("7 Sep 2026 – 11 Sep 2026")).toBeTruthy();
  });

  it("asks each portal term separately and says which sections have no term to ask", async () => {
    const read = vi.spyOn(lists, "fetchFacilitySections").mockImplementation(async (termCode, crns) => ({
      termCode,
      pulledAt: "",
      sections: crns.map((crn) => ({ crn, courseCode: "", title: "", teacherName: "", state: "published" as const, meetings: [MONDAY] })),
    }));

    show([
      { termCode: "262710", crn: "1", code: "A", title: "" },
      { termCode: "262720", crn: "2", code: "B", title: "" },
      { termCode: "", crn: "3", code: "C", title: "" },
    ]);

    await screen.findAllByLabelText(/CRN 1/);
    expect(read).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/3 is in a semester linked to no portal term/)).toBeTruthy();
    // Two courses, so a legend says which colour is which.
    expect(within(screen.getByLabelText("Legend")).getByText("B")).toBeTruthy();
  });

  it("says when there is nothing to draw rather than drawing an empty week", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "",
      sections: [{ crn: "23436", courseCode: "", title: "", teacherName: "", state: "published", meetings: [] }],
    });

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "" }]);

    expect(await screen.findByText(/holds no meetings for this section/)).toBeTruthy();
    expect(screen.getByText(/booked no room for 23436/)).toBeTruthy();
    expect(screen.queryByLabelText("Next week")).toBeNull();
  });

  it("has nothing to ask about with no entries", () => {
    const read = vi.spyOn(lists, "fetchFacilitySections");
    show([]);
    expect(screen.getByText("Nobody here.")).toBeTruthy();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("what the coordinators have said about the classes", () => {
  it("draws a cancelled class as cancelled and a covered one with who covered it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "",
      sections: [{ crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, TUESDAY] }],
    });
    vi.spyOn(notes, "fetchSessionChanges").mockResolvedValue([
      { id: "a", termCode: "262710", crn: "23436", meetsOn: "2026-09-07", startsAt: "08:30:00", endsAt: "10:00:00", kind: "cancelled", coverTeacherId: "", coverTeacherName: "", note: "storm", authorEmail: "", authorName: "", createdAt: "", updatedAt: "" },
      { id: "b", termCode: "262710", crn: "23436", meetsOn: "2026-09-08", startsAt: "13:30", endsAt: "15:00", kind: "covered", coverTeacherId: "", coverTeacherName: "Sudarshan Shinde", note: "", authorEmail: "", authorName: "", createdAt: "", updatedAt: "" },
    ]);

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]);

    expect(await screen.findByLabelText(/CANCELLED.*storm/)).toBeTruthy();
    expect(screen.getByLabelText(/covered by Sudarshan Shinde/)).toBeTruthy();
  });

  it("hands the pressed class to whoever wants to say what happened to it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "",
      sections: [{ crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "", state: "published", meetings: [MONDAY] }],
    });
    const picked = vi.fn();

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }], picked);

    fireEvent.click(await screen.findByLabelText(/^Open CRN 23436/));
    expect(picked).toHaveBeenCalledWith(expect.objectContaining({ crn: "23436", date: "2026-09-07", termCode: "262710" }));
    expect(screen.getByText(/Press a class to say it was cancelled/)).toBeTruthy();
  });
});
