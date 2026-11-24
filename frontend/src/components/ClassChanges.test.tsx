import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ClassChangesBanner } from "@/components/ClassChanges";
import { stillToLookAt } from "@/services/classDiff";
import * as lists from "@/services/portalLists";
import * as dismissals from "@/services/warningDismissals";

const PHYSICS: lists.ChangedClasses = {
  crn: "23638",
  courseCode: "PHYS-125",
  title: "Mechanics",
  teacherName: "Sara Khaled",
  scheduleState: "published",
  removed: [
    { meetsOn: "2026-09-14", startsAt: "10:30", endsAt: "12:30", room: "4.128" },
    { meetsOn: "2026-09-21", startsAt: "10:30", endsAt: "12:30", room: "4.128" },
  ],
  added: [],
  kept: [{ meetsOn: "2026-09-07", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
  noticedAt: "2026-09-22T10:41:18+00:00",
  key: "registrar-classes-changed:262710:23638:abc123",
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClassChangesBanner />
    </QueryClientProvider>,
  );
}

/** A section's header, course code, CRN and teacher, however its links break the text up. */
const header = (text: RegExp) => (_: string, element: Element | null) =>
  element?.tagName === "SUMMARY" && text.test(element.textContent ?? "");

beforeEach(() => {
  vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
  vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([PHYSICS]);
  vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([]);
  // The register, read to know which CRNs open a record: empty unless a test says.
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
});

describe("the banner", () => {
  it("says how many sections changed, and how much teaching that is", async () => {
    show();

    expect(await screen.findByText(/1 section/)).toBeTruthy();
    expect(screen.getByText(/4 h removed/)).toBeTruthy();
  });

  it("is the semester on screen's, not the newest swept", async () => {
    // Semester 2 swept, Semester 1 still taught: on Semester 1 the banner is Semester 1's.
    vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262720", "262710"]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ClassChangesBanner term="262710" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/1 section/)).toBeTruthy();
    expect(lists.fetchChangedClasses).toHaveBeenCalledWith("262710");
    expect(lists.fetchChangedClasses).not.toHaveBeenCalledWith("262720");
  });

  it("stays away when the registrar has changed nothing", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([]);
    show();

    await waitFor(() => expect(lists.fetchChangedClasses).toHaveBeenCalled());
    expect(screen.queryByText(/changed the classes/i)).toBeNull();
  });

  it("does not come back once a coordinator has approved that same change", async () => {
    vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([
      { key: PHYSICS.key, byEmail: "c@sorbonne.ae", byName: "Christian", at: "2026-09-22T11:00:00+00:00" },
    ]);
    show();

    await waitFor(() => expect(dismissals.fetchDismissals).toHaveBeenCalled());
    expect(screen.queryByText(/1 section/)).toBeNull();
  });

  it("opens on the months, with what is gone beside what still meets", async () => {
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));

    expect(await screen.findByText("September 2026")).toBeTruthy();
    expect(screen.getByText(/PHYS-125/)).toBeTruthy();
    expect(screen.getByText(/2 classes gone \(4 h\), 1 unchanged \(2 h\)/)).toBeTruthy();
    expect(screen.getByLabelText("2026-09-14: 1 class removed")).toBeTruthy();
    expect(screen.getByLabelText("2026-09-07: still meets")).toBeTruthy();

    // Held over, a day says what it holds: the section, and each class with its hours and room.
    fireEvent.focus(screen.getByLabelText("2026-09-14: 1 class removed"));
    const card = await screen.findByRole("tooltip");
    expect(card.textContent).toContain("Monday 14 September 2026");
    expect(card.textContent).toMatch(/Removed/);
    expect(card.textContent).toMatch(/\d{2}:\d{2}–\d{2}:\d{2}/);
  });

  it("lays every section across the same months, the empty ones too", async () => {
    // One section in September, one that only has classes in November.
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([
      PHYSICS,
      { ...PHYSICS, crn: "24246", key: "k2", kept: [], removed: [], added: [{ meetsOn: "2026-11-05", startsAt: "08:30", endsAt: "10:30", room: "5.110" }] },
    ]);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));

    // September to November for both: the late one shows its empty September and October.
    await screen.findAllByText("September 2026");
    expect(screen.getAllByText("September 2026")).toHaveLength(2);
    expect(screen.getAllByText("October 2026")).toHaveLength(2);
    expect(screen.getAllByText("November 2026")).toHaveLength(2);
  });

  it("approves against the changed classes themselves, not the section", async () => {
    const approve = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(null);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith(PHYSICS.key, true));
  });
});

const HISTORY: lists.ChangeHistory = {
  crn: PHYSICS.crn,
  courseCode: PHYSICS.courseCode,
  title: PHYSICS.title,
  teacherName: PHYSICS.teacherName,
  entries: [
    {
      kind: "changed",
      at: "2026-09-15T10:41:18+00:00",
      removed: [{ meetsOn: "2026-09-14", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
      added: [],
    },
    { kind: "approved", at: "2026-09-16T08:00:00+00:00", by: "Christian" },
    {
      kind: "changed",
      at: "2026-09-22T10:41:18+00:00",
      removed: [{ meetsOn: "2026-09-21", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
      added: [{ meetsOn: "2026-09-24", startsAt: "13:00", endsAt: "15:00", room: "5.110" }],
    },
  ],
  lastAt: "2026-09-22T10:41:18+00:00",
};

describe("the history", () => {
  beforeEach(() => {
    vi.spyOn(lists, "fetchChangeHistory").mockResolvedValue([HISTORY]);
  });

  it("is still one click away when nothing is waiting", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([]);
    show();

    // A line where the warning would be, saying so, with the history on a button of its own.
    expect(await screen.findByText(/No class changes waiting for approval/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Class change history/ }));

    expect(await screen.findByText(header(/PHYS-125 · CRN 23638/))).toBeTruthy();
    expect(lists.fetchChangeHistory).toHaveBeenCalledWith("262710");
  });

  it("withdraws the latest approval, and only after asking", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([]);
    const withdraw = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(null);
    const keyed = (at: string, key: string): lists.ChangeHistoryEntry => ({ kind: "approved", at, by: "Patricia", key });
    vi.spyOn(lists, "fetchChangeHistory").mockResolvedValue([
      {
        ...HISTORY,
        entries: [
          HISTORY.entries[0],
          keyed("2026-09-16T08:00:00+00:00", "older"),
          HISTORY.entries[2],
          keyed("2026-09-23T08:00:00+00:00", "newest"),
        ],
      },
    ]);
    show();

    fireEvent.click(await screen.findByRole("button", { name: /Class change history/ }));
    fireEvent.click(await screen.findByText(header(/PHYS-125 · CRN 23638/)));

    // Beside the newest approval only: an older one under it would bring nothing back.
    const [unapprove, ...more] = await screen.findAllByRole("button", { name: "Unapprove" });
    expect(more).toHaveLength(0);
    expect(unapprove.closest("li")?.textContent).toMatch(/23 Sep 2026/);
    fireEvent.click(unapprove);

    const asked = await screen.findByRole("dialog", { name: "Unapprove this change?" });
    expect(withdraw).not.toHaveBeenCalled();
    fireEvent.click(within(asked).getByRole("button", { name: "Unapprove" }));

    await waitFor(() => expect(withdraw).toHaveBeenCalledWith("newest", false));
  });

  it("opens on one section from its card, newest first, with who approved what", async () => {
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    const [, fromTheCard] = await screen.findAllByRole("button", { name: /History/ });
    fireEvent.click(fromTheCard);

    expect(await screen.findByText("Change history · CRN 23638")).toBeTruthy();
    const lines = (await screen.findAllByText(/· the portal changed|· approved/)).map((line) => line.textContent ?? "");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/22 Sep 2026/);
    expect(lines[1]).toMatch(/approved by Christian/);
    expect(screen.getAllByText("Removed")).toHaveLength(2);
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText(/Thu 24 Sep · 13:00–15:00/)).toBeTruthy();
  });
});

describe("stillToLookAt", () => {
  it("keeps a section whose approval was for a different set of changed classes", () => {
    const approved = new Map([
      ["registrar-classes-changed:262710:23638:older", { key: "older", byEmail: "", byName: "", at: "" }],
    ]);

    expect(stillToLookAt([PHYSICS], approved)).toEqual([PHYSICS]);
  });
});

/*
 * The half that was invisible. A class the registrar puts into a section is teaching
 * somebody has to do, and drawn as "still booked" it looked exactly like a class that had
 * been in the timetable since August.
 */
describe("a class the registrar has added", () => {
  const ARRIVED: lists.ChangedClasses = {
    ...PHYSICS,
    removed: [],
    added: [{ meetsOn: "2026-09-28", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
  };

  it("warns on its own, with the hours it brings", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([ARRIVED]);
    show();

    expect(await screen.findByText(/1 section/)).toBeTruthy();
    expect(screen.getByText(/2 h added/)).toBeTruthy();
  });

  it("gets its own colour in the month, apart from the classes that were always there", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([ARRIVED]);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));

    expect(screen.getByText(/1 arrived \(2 h\), 1 unchanged \(2 h\)/)).toBeTruthy();
    expect(screen.getByLabelText("2026-09-28: 1 added")).toBeTruthy();
    expect(screen.getByLabelText("2026-09-07: still meets")).toBeTruthy();
    expect(screen.getByText("added")).toBeTruthy();
  });

  it("says both when a day loses one class and gains another, and calls it neither a move nor a loss", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([
      {
        ...PHYSICS,
        removed: [PHYSICS.removed[0]],
        added: [{ meetsOn: "2026-09-14", startsAt: "13:30", endsAt: "15:30", room: "4.128" }],
      },
    ]);
    show();

    expect(await screen.findByText(/2 h removed, 2 h added/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show what changed" }));

    expect(screen.getByLabelText("2026-09-14: 1 class removed, 1 added")).toBeTruthy();
    // And the ring around that square says so in the legend, rather than only on hover.
    expect(screen.getByText(/arrived where one was removed the same day/)).toBeTruthy();
  });

  it("does not explain the ring on a report that has no day like that", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([ARRIVED]);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));

    expect(screen.queryByText(/arrived where one was removed the same day/)).toBeNull();
  });
});

describe("a class the department had already cancelled", () => {
  it("is drawn as a gap it knew about, and left out of what the banner counts", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([
      {
        ...PHYSICS,
        removed: [
          { ...PHYSICS.removed[0], weCancelled: true },
          { ...PHYSICS.removed[1] },
        ],
      },
    ]);
    show();

    // Two hours gone, not four: the one we cancelled is not an hour lost on us.
    expect(await screen.findByText(/2 h removed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show what changed" }));

    expect(screen.getByText(/1 class gone \(2 h\), 1 you had cancelled/)).toBeTruthy();
    expect(screen.getByLabelText("2026-09-14: 1 class removed, which you had cancelled")).toBeTruthy();
    expect(screen.getByText("you had cancelled it")).toBeTruthy();
  });
});

/*
 * The course, the CRN and the teacher in a section's header each open their record over the
 * changes (24 Nov 2026), the CRN only when the register holds it.
 */
describe("records from the changes", () => {
  it("offers each one, and the CRN only when the register holds it", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));

    expect(await screen.findByRole("button", { name: "PHYS-125" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sara Khaled" })).toBeTruthy();
    // Not in the register: no record to open, so the CRN is plain text.
    expect(screen.queryByRole("button", { name: "23638" })).toBeNull();
  });

  it("opens the CRN's record over the changes", async () => {
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([
      { id: "r1", termCode: "262710", crn: "23638", courseCode: "PHYS-125" } as unknown as lists.ActiveCrn,
    ]);
    vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    fireEvent.click(await screen.findByRole("button", { name: "23638" }));

    // Two windows now: the changes, and the CRN's record on top of them.
    await waitFor(() => expect(screen.getAllByRole("dialog").length).toBeGreaterThan(1));
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[dialogs.length - 1].textContent).toContain("23638");
  });
});

/*
 * The whole term beside what waits (24 Nov 2026): every section the portal changed, from when
 * it was first seen, the approved ones too, tagged and read-only.
 */
describe("the whole term", () => {
  const APPROVED_ONE: lists.ChangedClasses = { ...PHYSICS, crn: "24100", courseCode: "MATH-001", teacherName: "Bilal Maaz", key: "registrar-classes-changed:262710:24100:def456" };

  it("lists every changed section, tagged, with approving left to the waiting list", async () => {
    const read = vi.spyOn(lists, "fetchChangedClasses").mockImplementation(async (_term, whole) => (whole ? [PHYSICS, APPROVED_ONE] : [PHYSICS]));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    expect(await screen.findByRole("button", { name: "Approve" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Whole term" }));

    expect(await screen.findByText("MATH-001")).toBeTruthy();
    expect(read).toHaveBeenCalledWith("262710", true);
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("stays one press away when nothing is waiting", async () => {
    vi.spyOn(lists, "fetchChangedClasses").mockImplementation(async (_term, whole) => (whole ? [APPROVED_ONE] : []));
    vi.spyOn(lists, "fetchChangeHistory").mockResolvedValue([]);
    show();

    fireEvent.click(await screen.findByRole("button", { name: /All changes this term/ }));

    expect(await screen.findByText("MATH-001")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Whole term" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Approved")).toBeTruthy();
  });
});
