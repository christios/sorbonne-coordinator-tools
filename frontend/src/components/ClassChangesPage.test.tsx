import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClassChangesPage, PortalChanges } from "@/components/ClassChangesPage";
import * as lists from "@/services/portalLists";
import * as timetables from "@/services/timetables";
import * as dismissals from "@/services/warningDismissals";

/** Maths Readiness G.10: Tuesday's class went, a Thursday one arrived. */
const MOVED: lists.ChangedClasses = {
  crn: "24007",
  courseCode: "SCEN-102",
  title: "Maths Readiness",
  teacherName: "Ahmed Menaa",
  scheduleState: "published",
  removed: [{ meetsOn: "2026-11-03", startsAt: "08:30", endsAt: "10:00", room: "4.024" }],
  added: [{ meetsOn: "2026-11-05", startsAt: "13:15", endsAt: "14:45", room: "4.024" }],
  kept: [{ meetsOn: "2026-11-06", startsAt: "08:30", endsAt: "10:00", room: "4.024" }],
  noticedAt: "2026-10-21T06:00:00+00:00",
  key: "registrar-classes-changed:262710:24007:abc",
};
const OTHER: lists.ChangedClasses = { ...MOVED, crn: "23638", courseCode: "PHYS-125", teacherName: "Sara Khaled", key: "k-physics" };

const TUESDAY = { meetsOn: "2026-11-03", startsAt: "08:30", endsAt: "10:00" };
const THURSDAY = { meetsOn: "2026-11-05", startsAt: "13:15", endsAt: "14:45" };

function page(props: { place?: string; onLeavePlace?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ClassChangesPage {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
  vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([MOVED, OTHER]);
  vi.spyOn(lists, "fetchClassNotes").mockResolvedValue({ links: [], notes: [] });
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm,
  ]);
  vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([
    { key: "k-physics", byEmail: "p@sorbonne.ae", byName: "Patricia", at: "2026-10-20T08:00:00+00:00" },
  ]);
});

afterEach(() => vi.restoreAllMocks());

const card = (course: string) => screen.getByText(new RegExp(`^${course}`)).closest("section") as HTMLElement;

describe("the Class changes page", () => {
  it("opens on what is still to look at, and keeps the approved ones with who and when", async () => {
    page();

    expect(await screen.findByText(/SCEN-102 · CRN 24007/)).toBeTruthy();
    expect(screen.queryByText(/PHYS-125 · CRN 23638/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Approved/ }));

    expect(await screen.findByText(/PHYS-125 · CRN 23638/)).toBeTruthy();
    expect(screen.getByText(/Approved by Patricia, 20 Oct/)).toBeTruthy();
    expect(screen.queryByText(/SCEN-102 · CRN 24007/)).toBeNull();
  });

  it("finds a section by course, CRN or teacher", async () => {
    page();
    await screen.findByText(/SCEN-102 · CRN 24007/);
    fireEvent.click(screen.getByRole("button", { name: /All/ }));

    fireEvent.change(screen.getByLabelText("Find a section"), { target: { value: "sara" } });

    expect(await screen.findByText(/PHYS-125 · CRN 23638/)).toBeTruthy();
    expect(screen.queryByText(/SCEN-102 · CRN 24007/)).toBeNull();
  });

  it("links a class that went to the one it was rescheduled into", async () => {
    const link = vi.spyOn(lists, "linkClasses").mockResolvedValue({} as lists.ClassLink);
    page();
    await screen.findByText(/SCEN-102 · CRN 24007/);
    const section = card("SCEN-102");

    fireEvent.click(within(section).getByRole("button", { name: /Rescheduled to/ }));
    expect(within(section).getByText(/Choose the class that Tue 3 Nov, 08:30–10:00 was rescheduled into/)).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: "Rescheduled into this" }));

    await waitFor(() =>
      expect(link).toHaveBeenCalledWith("262710", { crn: "24007", gone: expect.objectContaining(TUESDAY), arrived: expect.objectContaining(THURSDAY) }),
    );
  });

  it("shows a link both ways, and unlinks it", async () => {
    vi.spyOn(lists, "fetchClassNotes").mockResolvedValue({
      links: [
        {
          id: "l1", termCode: "262710", crn: "24007", from: TUESDAY, to: THURSDAY, note: "",
          byEmail: "p@sorbonne.ae", byName: "Patricia", at: "2026-10-21T08:00:00Z", matches: true,
        },
      ],
      notes: [],
    });
    const unlink = vi.spyOn(lists, "unlinkClasses").mockResolvedValue(undefined);
    page();
    await screen.findByText(/SCEN-102 · CRN 24007/);
    const section = card("SCEN-102");

    // On the class that went, where it went to; on the class that arrived, where it came from.
    expect(within(section).getAllByText("Thu 5 Nov, 13:15–14:45")).toHaveLength(2);
    expect(within(section).getByText("from Tue 3 Nov, 08:30–10:00")).toBeTruthy();
    fireEvent.click(within(section).getByRole("button", { name: /Unlink Tue 3 Nov/ }));

    await waitFor(() => expect(unlink).toHaveBeenCalledWith("l1", expect.anything()));
  });

  it("puts a note on a single class", async () => {
    const note = vi.spyOn(lists, "noteClass").mockResolvedValue(null);
    page();
    await screen.findByText(/SCEN-102 · CRN 24007/);
    const section = card("SCEN-102");

    fireEvent.click(within(section).getByRole("button", { name: "Add a note to Thu 5 Nov, 13:15–14:45" }));
    fireEvent.change(within(section).getByLabelText("Note on Thu 5 Nov, 13:15–14:45"), {
      target: { value: "Extra class before the exam" },
    });
    fireEvent.click(within(section).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(note).toHaveBeenCalledWith("262710", {
        crn: "24007",
        side: "added",
        cls: expect.objectContaining(THURSDAY),
        note: "Extra class before the exam",
      }),
    );
  });

  it("keeps a link the registrar has since overtaken, under its own heading", async () => {
    vi.spyOn(lists, "fetchClassNotes").mockResolvedValue({
      links: [
        {
          id: "l9", termCode: "262710", crn: "24007", from: { ...TUESDAY, meetsOn: "2026-10-27" }, to: THURSDAY, note: "Old move",
          byEmail: "p@sorbonne.ae", byName: "Patricia", at: "2026-10-21T08:00:00Z", matches: false,
        },
      ],
      notes: [],
    });
    page();

    expect(await screen.findByText("No longer matching the timetable")).toBeTruthy();
    expect(screen.getByText(/CRN 24007: Tue 27 Oct, 08:30–10:00 → Thu 5 Nov, 13:15–14:45 · Old move/)).toBeTruthy();
  });
});

describe("one CRN's changes", () => {
  function record(crn: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PortalChanges termCode="262710" crn={crn} />
      </QueryClientProvider>,
    );
  }

  it("are on its record, approved ones included, with who approved them", async () => {
    record("23638");

    expect(await screen.findByText(/Approved by Patricia, 20 Oct/)).toBeTruthy();
    // What the portal says, and what the department made of it, each tagged with whose word it is.
    expect(within(screen.getByText("Went (1)")).getByText("portal")).toBeTruthy();
    expect(within(screen.getByText("Arrived (1)")).getByText("portal")).toBeTruthy();
    expect(within(screen.getByText(/Approved by Patricia/).parentElement as HTMLElement).getByText("planning")).toBeTruthy();
    // The record already says which CRN it is.
    expect(screen.queryByText(/PHYS-125 · CRN 23638/)).toBeNull();
  });

  it("can be approved from the record", async () => {
    const approve = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(null);
    record("24007");

    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith(MOVED.key, true));
  });

  it("say so when the registrar has left the CRN alone", async () => {
    record("99999");

    expect(await screen.findByText(/Nothing changed/)).toBeTruthy();
  });

  it("open on the page at that CRN, approved or not, until somebody looks at anything else", async () => {
    const leave = vi.fn();
    page({ place: "262710:23638", onLeavePlace: leave });

    expect(await screen.findByText(/PHYS-125 · CRN 23638/)).toBeTruthy();
    expect(screen.queryByText(/SCEN-102 · CRN 24007/)).toBeNull();
    expect((screen.getByLabelText("Find a section") as HTMLInputElement).value).toBe("23638");
    expect(leave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Find a section"), { target: { value: "" } });

    expect(leave).toHaveBeenCalled();
    expect(await screen.findByText(/SCEN-102 · CRN 24007/)).toBeTruthy();
  });
});
