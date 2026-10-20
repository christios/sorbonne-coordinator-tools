import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SectionTimetable, type TimetableEntry } from "@/components/SectionTimetable";
import { setPortalChangesShown } from "@/services/portalChangesShown";
import * as lists from "@/services/portalLists";
import * as notes from "@/services/sessionChanges";
import * as termWeeks from "@/services/termWeeks";

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
  setPortalChangesShown(true);
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
    expect(within(cannot).getByText(/Nobody has asked the portal about 99999/)).toBeTruthy();
  });

  it("draws only the dates a stand-in was actually in the room", async () => {
    /*
     * A cover is one afternoon, not a standing commitment. Adding the CRN to the stand-in's
     * week outright would put them in that room every week of the semester on the strength
     * of one Tuesday.
     */
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, TUESDAY] },
      ],
    });

    show([
      { termCode: "262710", crn: "23436", code: "", title: "", onlyOn: [TUESDAY.meetsOn], standingIn: true },
    ]);

    const boxes = await screen.findAllByLabelText(/CRN 23436/);
    expect(boxes).toHaveLength(1);
    // And from their side of it: whose class it was, not who took it — which is them.
    const said = boxes[0].getAttribute("aria-label") ?? "";
    expect(said).toContain("covering for Grace Younes");
    // Named once. The section's own teacher and the "covering for" line are one person,
    // and printing both read as two.
    expect(said.match(/Grace Younes/g)).toHaveLength(1);
  });

  it("says covered by, not covering for, on the week of the teacher who was down for it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [TUESDAY] },
      ],
    });
    vi.spyOn(notes, "fetchSessionChanges").mockResolvedValue([
      {
        id: "n1", termCode: "262710", crn: "23436", meetsOn: TUESDAY.meetsOn, startsAt: TUESDAY.startsAt,
        endsAt: TUESDAY.endsAt, kind: "covered", coverTeacherId: "", coverTeacherName: "Dr Kaur", note: "",
        authorEmail: "", authorName: "", createdAt: "", updatedAt: "",
      },
    ]);

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]);

    const boxes = await screen.findAllByLabelText(/CRN 23436/);
    expect(boxes[0].getAttribute("aria-label")).toContain("covered by Dr Kaur");
    expect(boxes[0].getAttribute("aria-label")).not.toContain("covering for");
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
    expect(screen.getByText(/no classes booked for 23436/)).toBeTruthy();
    expect(screen.queryByLabelText("Next week")).toBeNull();
  });

  it("says a section the portal never had a class under has none booked, not that it stopped answering", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "",
      sections: [{ crn: "24240", courseCode: "", title: "", teacherName: "", state: "never", meetings: [] }],
    });

    show([{ termCode: "262710", crn: "24240", code: "PHYS-221", title: "" }]);

    expect(await screen.findByText(/no classes booked for 24240/)).toBeTruthy();
    expect(screen.queryByText(/stopped answering/)).toBeNull();
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

    expect(await screen.findByLabelText(/Planning: CANCELLED.*storm/)).toBeTruthy();
    expect(screen.getByLabelText(/Planning: covered by Sudarshan Shinde/)).toBeTruthy();
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

describe("the week number on a record's calendar", () => {
  it("is found from the term the sections are filed under, and said on a card as on the full week", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
      ],
    });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: [] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SectionTimetable compact title="Algebra" entries={[{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]} />
      </QueryClientProvider>,
    );

    // Week 1 is the week of 31 August; the class on 7 September is in Week 2.
    expect(await screen.findByText("Week 2")).toBeTruthy();
  });

  it("finds the Week 1 when two semesters are linked to the term and only one says it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
      ],
    });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-old": "262710", "term-1": "262710" });
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: [] } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SectionTimetable compact title="Algebra" entries={[{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Week 2")).toBeTruthy();
  });

  it("says no week where the semester has no Week 1", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY] },
      ],
    });
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({});
    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]);

    expect(await screen.findByText("7 Sep 2026 – 11 Sep 2026")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Teaching week" })).toBeNull();
  });
});

describe("a class a coordinator linked as rescheduled", () => {
  it("says where it came from, on whichever page draws it", async () => {
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, TUESDAY] },
      ],
    });
    vi.spyOn(lists, "fetchClassNotes").mockResolvedValue({
      links: [
        {
          id: "l1", termCode: "262710", crn: "23436",
          from: { meetsOn: "2026-09-04", startsAt: "08:30", endsAt: "10:00" },
          to: { meetsOn: TUESDAY.meetsOn, startsAt: TUESDAY.startsAt, endsAt: TUESDAY.endsAt },
          note: "", byEmail: "", byName: "Patricia", at: "", matches: true,
        },
      ],
      notes: [],
    });

    show([{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]);

    const boxes = await screen.findAllByLabelText(/CRN 23436/);
    const said = boxes.map((box) => box.getAttribute("aria-label") ?? box.getAttribute("title") ?? "");
    expect(said.filter((text) => text.includes("rescheduled from Fri 4 Sep, 08:30–10:00"))).toHaveLength(1);
  });
});

describe("what the registrar changed, behind the Portal changes switch", () => {
  const GONE = { meetsOn: "2026-09-08", startsAt: "09:00", endsAt: "11:00", room: "5.202" };

  beforeEach(() => {
    setPortalChangesShown(true);
    vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({
      termCode: "262710",
      pulledAt: "2026-09-01T00:00:00+00:00",
      sections: [
        { crn: "23436", courseCode: "MATH-351", title: "Algebra", teacherName: "Grace Younes", state: "published", meetings: [MONDAY, TUESDAY] },
      ],
    });
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([
      {
        crn: "23436",
        courseCode: "MATH-351",
        title: "Algebra",
        teacherName: "Grace Younes",
        scheduleState: "published",
        removed: [GONE],
        added: [TUESDAY],
        kept: [MONDAY],
        noticedAt: "2026-09-08T06:00:00+00:00",
        key: "k",
      },
    ]);
  });

  function record(onPickSession = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SectionTimetable
          onPickSession={onPickSession}
          entries={[{ termCode: "262710", crn: "23436", code: "MATH-351", title: "Algebra" }]}
        />
      </QueryClientProvider>,
    );
  }

  it("keeps a removed class on its old day, and marks the one that arrived", async () => {
    record();

    expect(await screen.findByText("Removed")).toBeTruthy();
    expect(screen.getByText("Added")).toBeTruthy();
    const said = screen.getAllByLabelText(/CRN 23436/).map((box) => box.getAttribute("aria-label") ?? "");
    expect(said.filter((text) => text.includes("09:00–11:00") && text.includes("Portal: REMOVED by the registrar"))).toHaveLength(1);
    expect(said.filter((text) => text.includes("13:30–15:00") && text.includes("Portal: added by the registrar"))).toHaveLength(1);
    expect(said.filter((text) => text.includes("08:30–10:00") && text.includes("registrar"))).toHaveLength(0);
    expect(screen.getByText(/Faded and struck through: a class the registrar removed/)).toBeTruthy();
  });

  it("says Moved on both of a linked pair, each naming the other", async () => {
    vi.spyOn(lists, "fetchClassNotes").mockResolvedValue({
      links: [
        {
          id: "l1", termCode: "262710", crn: "23436",
          from: { meetsOn: GONE.meetsOn, startsAt: GONE.startsAt, endsAt: GONE.endsAt },
          to: { meetsOn: TUESDAY.meetsOn, startsAt: TUESDAY.startsAt, endsAt: TUESDAY.endsAt },
          note: "", byEmail: "", byName: "Patricia", at: "", matches: true,
        },
      ],
      notes: [],
    });
    record();

    await waitFor(() => expect(screen.getAllByText("Moved")).toHaveLength(2));
    expect(screen.queryByText("Removed")).toBeNull();
    expect(screen.queryByText("Added")).toBeNull();
    const said = screen.getAllByLabelText(/CRN 23436/).map((box) => box.getAttribute("aria-label") ?? "");
    expect(said.filter((text) => text.includes("Planning: rescheduled to Tue 8 Sep, 13:30–15:00"))).toHaveLength(1);
    expect(said.filter((text) => text.includes("Planning: rescheduled from Tue 8 Sep, 09:00–11:00"))).toHaveLength(1);
  });

  it("has nothing to note on a removed class: it no longer meets", async () => {
    record();
    await screen.findByText("Removed");

    const pressable = screen.getAllByRole("button", { name: /CRN 23436/ }).map((box) => box.getAttribute("aria-label") ?? "");
    expect(pressable.some((text) => text.includes("09:00–11:00"))).toBe(false);
    expect(pressable.some((text) => text.includes("13:30–15:00"))).toBe(true);
  });

  it("draws only what meets once the switch is off, and every calendar follows it", async () => {
    record();
    expect(await screen.findByText("Removed")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Portal changes" }));

    await waitFor(() => expect(screen.queryByText("Removed")).toBeNull());
    expect(screen.queryByText("Added")).toBeNull();
    expect(screen.getAllByLabelText(/CRN 23436/)).toHaveLength(2);
    // The week stays where it was.
    expect(screen.getByText("7 Sep 2026 – 11 Sep 2026")).toBeTruthy();
    expect(window.localStorage.getItem("scen-portal-changes-shown:v1")).toBe("off");
  });

  it("does not ask the portal's changes at all while the switch is off", async () => {
    setPortalChangesShown(false);
    record();

    await screen.findAllByLabelText(/CRN 23436/);
    expect(screen.queryByText("Removed")).toBeNull();
    expect((screen.getByRole("checkbox", { name: "Portal changes" }) as HTMLInputElement).checked).toBe(false);
    expect(lists.fetchChangedClasses).not.toHaveBeenCalled();
  });
});
