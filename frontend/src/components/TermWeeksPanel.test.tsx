import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TermWeeksPanel } from "@/components/TermWeeksPanel";
import * as termWeeks from "@/services/termWeeks";
import * as timetables from "@/services/timetables";
import type { TimetableTerm } from "@/services/timetables";

function shown(canChange: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TermWeeksPanel canChange={canChange} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 25, 10, 0, 0));
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "term-1", name: "Semester 1" } as TimetableTerm,
    { id: "term-2", name: "Semester 2" } as TimetableTerm,
  ]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("each semester's Week 1, in Settings", () => {
  it("lets an administrator set it, and says what week today is", async () => {
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({});
    const saved = vi.spyOn(termWeeks, "setWeekOne").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: [] } });
    shown(true);

    fireEvent.change(await screen.findByLabelText("Week 1 of Semester 1"), { target: { value: "2026-08-31" } });

    await waitFor(() => expect(saved).toHaveBeenCalledWith("term-1", "2026-08-31"));
    expect(await screen.findByText(/counted from Mon 31 Aug 2026 · this is Week 4/)).toBeTruthy();
  });

  it("shows everybody else where the weeks start, to read", async () => {
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: [] } });
    shown(false);

    expect(await screen.findByText(/counted from Mon 31 Aug 2026/)).toBeTruthy();
    expect(screen.queryByLabelText("Week 1 of Semester 1")).toBeNull();
    expect(screen.getByText("No Week 1 set")).toBeTruthy();
    expect(screen.getByText(/Only an administrator/)).toBeTruthy();
  });

  it("keeps the weeks without classes, and counts past them", async () => {
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: ["2026-09-14"] } });
    const saved = vi
      .spyOn(termWeeks, "setWeeksWithout")
      .mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: ["2026-09-14", "2026-10-12"] } });
    shown(true);

    // 25 September is the fourth week from 31 August, less the week of 14 September.
    expect(await screen.findByText(/this is Week 3/)).toBeTruthy();
    expect(screen.getByText("14 – 18 Sep 2026")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Add a week without classes to Semester 1"), { target: { value: "2026-10-14" } });
    await waitFor(() => expect(saved).toHaveBeenCalledWith("term-1", ["2026-09-14", "2026-10-14"]));
    expect(await screen.findByText("12 – 16 Oct 2026")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Count the week of 14 – 18 Sep 2026 again" }));
    await waitFor(() => expect(saved).toHaveBeenLastCalledWith("term-1", ["2026-10-12"]));
  });
});
