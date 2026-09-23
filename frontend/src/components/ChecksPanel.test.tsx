import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChecksPanel } from "@/components/ChecksPanel";
import * as lists from "@/services/portalLists";

const check = (over: Partial<lists.Check> = {}): lists.Check => ({
  name: "collision",
  title: "A student in one of our sections and another department's at the same hour",
  measures: "minutes of overlap",
  enabled: true,
  threshold: 30,
  defaultEnabled: true,
  defaultThreshold: 30,
  home: "cohorts",
  perCohort: true,
  ...over,
});

const REGISTER = [
  check(),
  check({ name: "teacher_hours_apart", title: "A teacher's hours disagreeing", measures: "hours apart", threshold: 2, home: "teacher-hours", perCohort: false }),
  check({ name: "portal_sync_age", title: "Portal data too old", measures: "hours old", threshold: 8, home: "settings", perCohort: false }),
];

function show(canChange = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChecksPanel canChange={canChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("switching a check off, and giving it a floor", () => {
  it("saves on the spot, because a toggle that needs confirming reads as one that failed", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check()]);
    const saved = vi.spyOn(lists, "setCheck").mockResolvedValue(undefined);

    show();
    fireEvent.click(await screen.findByRole("checkbox"));

    await waitFor(() => expect(saved).toHaveBeenCalledWith("collision", { enabled: false, threshold: 30 }));
  });

  it("keeps the floor in the units it counts, so the box can be filled in correctly", async () => {
    // A number with no unit beside it is a number nobody can enter with confidence.
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check()]);
    const saved = vi.spyOn(lists, "setCheck").mockResolvedValue(undefined);

    show();
    const floor = await screen.findByLabelText(/Fewest minutes of overlap/);
    fireEvent.change(floor, { target: { value: "45" } });
    fireEvent.blur(floor);

    await waitFor(() => expect(saved).toHaveBeenCalledWith("collision", { enabled: true, threshold: 45 }));
  });

  it("shows no floor at all for a check with no size to it", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check({ measures: "", threshold: 0, defaultThreshold: 0 })]);

    show();

    expect(await screen.findByRole("checkbox")).toBeTruthy();
    expect(screen.queryByLabelText(/Fewest/)).toBeNull();
  });
});

/*
 * Every check in one place, grouped by the page its warning appears on — because a title
 * alone does not say where, and an administrator thinks "what does Teacher hours warn
 * about", not "what is the register's second entry".
 */
describe("the whole register, in one place", () => {
  it("lists every check under the page it speaks on", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue(REGISTER);

    show();

    expect(within(await screen.findByRole("list", { name: "Checks on Cohorts" })).getByText(/another department's/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Checks on Teacher hours" })).getByText("A teacher's hours disagreeing")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Checks on Every student page" })).getByText("Portal data too old")).toBeTruthy();
  });
});

describe("somebody who is not an administrator", () => {
  it("can read every check, and change none of them", async () => {
    // Seeing them is anybody's — a coordinator not told why something is quiet assumes it
    // is broken — but switching one off hides a warning from the whole department.
    vi.spyOn(lists, "fetchChecks").mockResolvedValue(REGISTER);
    const saved = vi.spyOn(lists, "setCheck").mockResolvedValue(undefined);

    show(false);

    expect(await screen.findByText(/Only an administrator can change these/)).toBeTruthy();
    for (const box of screen.getAllByRole("checkbox")) expect((box as HTMLInputElement).disabled).toBe(true);
    for (const floor of screen.getAllByLabelText(/Fewest/)) expect((floor as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(saved).not.toHaveBeenCalled();
  });

  it("is not told about administrators when they are one", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue(REGISTER);

    show(true);

    await screen.findAllByRole("checkbox");
    expect(screen.queryByText(/Only an administrator/)).toBeNull();
  });
});
