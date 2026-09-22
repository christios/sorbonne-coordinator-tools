import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

beforeEach(() => {
  vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
  vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([PHYSICS]);
  vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([]);
});

describe("the banner", () => {
  it("says how many sections changed, and how much teaching that is", async () => {
    show();

    expect(await screen.findByText(/1 section/)).toBeTruthy();
    expect(screen.getByText(/4 h removed/)).toBeTruthy();
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
    expect(screen.getByTitle("2026-09-14: 1 class removed")).toBeTruthy();
    expect(screen.getByTitle("2026-09-07: still meets")).toBeTruthy();
  });

  it("approves against the changed classes themselves, not the section", async () => {
    const approve = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(null);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith(PHYSICS.key, true));
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
    expect(screen.getByTitle("2026-09-28: 1 added")).toBeTruthy();
    expect(screen.getByTitle("2026-09-07: still meets")).toBeTruthy();
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

    expect(screen.getByTitle("2026-09-14: 1 class removed, 1 added")).toBeTruthy();
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
    expect(screen.getByTitle("2026-09-14: 1 class removed, which you had cancelled")).toBeTruthy();
    expect(screen.getByText("you had cancelled it")).toBeTruthy();
  });
});
