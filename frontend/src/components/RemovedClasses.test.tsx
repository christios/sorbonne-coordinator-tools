import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RemovedClassesBanner } from "@/components/RemovedClasses";
import { stillToLookAt } from "@/services/classDiff";
import * as lists from "@/services/portalLists";
import * as dismissals from "@/services/warningDismissals";

const PHYSICS: lists.RemovedClasses = {
  crn: "23638",
  courseCode: "PHYS-125",
  title: "Mechanics",
  teacherName: "Sara Khaled",
  scheduleState: "published",
  removed: [
    { meetsOn: "2026-09-14", startsAt: "10:30", endsAt: "12:30", room: "4.128" },
    { meetsOn: "2026-09-21", startsAt: "10:30", endsAt: "12:30", room: "4.128" },
  ],
  kept: [{ meetsOn: "2026-09-07", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
  noticedAt: "2026-09-22T10:41:18+00:00",
  key: "registrar-classes-removed:262710:23638:abc123",
};

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RemovedClassesBanner />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
  vi.spyOn(lists, "fetchRemovedClasses").mockResolvedValue([PHYSICS]);
  vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([]);
});

describe("the banner", () => {
  it("says how many sections lost classes, and how much teaching that is", async () => {
    show();

    expect(await screen.findByText(/1 section/)).toBeTruthy();
    expect(screen.getByText(/4 h of teaching/)).toBeTruthy();
  });

  it("stays away when the registrar has removed nothing", async () => {
    vi.spyOn(lists, "fetchRemovedClasses").mockResolvedValue([]);
    show();

    await waitFor(() => expect(lists.fetchRemovedClasses).toHaveBeenCalled());
    expect(screen.queryByText(/removed classes/i)).toBeNull();
  });

  it("does not come back once a coordinator has approved that same removal", async () => {
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
    expect(screen.getByText(/2 classes gone \(4 h\), 1 still booked \(2 h\)/)).toBeTruthy();
    expect(screen.getByTitle("2026-09-14: 1 class removed")).toBeTruthy();
    expect(screen.getByTitle("2026-09-07: still meets")).toBeTruthy();
  });

  it("approves against the missing classes themselves, not the section", async () => {
    const approve = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(null);
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Show what changed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approve).toHaveBeenCalledWith(PHYSICS.key, true));
  });
});

describe("stillToLookAt", () => {
  it("keeps a section whose approval was for a different set of missing classes", () => {
    const approved = new Map([
      ["registrar-classes-removed:262710:23638:older", { key: "older", byEmail: "", byName: "", at: "" }],
    ]);

    expect(stillToLookAt([PHYSICS], approved)).toEqual([PHYSICS]);
  });
});

describe("a class the department had already cancelled", () => {
  it("is drawn as a gap it knew about, and left out of what the banner counts", async () => {
    vi.spyOn(lists, "fetchRemovedClasses").mockResolvedValue([
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
    expect(await screen.findByText(/2 h of teaching/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show what changed" }));

    expect(screen.getByText(/1 class gone \(2 h\), 1 you had cancelled/)).toBeTruthy();
    expect(screen.getByTitle("2026-09-14: you cancelled this, and the registrar has now removed it")).toBeTruthy();
    expect(screen.getByText("you had cancelled it")).toBeTruthy();
  });
});
