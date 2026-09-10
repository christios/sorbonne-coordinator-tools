import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  ...over,
});

function show(props: { cohortId?: string; cohortName?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChecksPanel {...props} />
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

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("collision", { enabled: false, threshold: 30, cohortId: "" }),
    );
  });

  it("keeps the floor in the units it counts, so the box can be filled in correctly", async () => {
    // A number with no unit beside it is a number nobody can enter with confidence.
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check()]);
    const saved = vi.spyOn(lists, "setCheck").mockResolvedValue(undefined);

    show();
    const floor = await screen.findByLabelText(/Fewest minutes of overlap/);
    fireEvent.change(floor, { target: { value: "45" } });
    fireEvent.blur(floor);

    await waitFor(() =>
      expect(saved).toHaveBeenCalledWith("collision", { enabled: true, threshold: 45, cohortId: "" }),
    );
  });

  it("shows no floor at all for a check with no size to it", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check({ measures: "", threshold: 0, defaultThreshold: 0 })]);

    show();

    expect(await screen.findByRole("checkbox")).toBeTruthy();
    expect(screen.queryByLabelText(/Fewest/)).toBeNull();
  });

  it("offers a cohort its way back to the department's answer, and only when it has left it", async () => {
    /*
     * A cohort agreeing with the department is following it whether or not it has a row,
     * so the offer appears where it would change something and nowhere else.
     */
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check({ threshold: 90 })]);
    const followed = vi.spyOn(lists, "clearCheck").mockResolvedValue(undefined);

    show({ cohortId: "c1", cohortName: "L3-S1" });
    fireEvent.click(await screen.findByRole("button", { name: /Follow the department again/ }));

    await waitFor(() => expect(followed).toHaveBeenCalledWith("collision", "c1"));
  });

  it("says nothing about following along when the cohort already agrees", async () => {
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([check()]);

    show({ cohortId: "c1", cohortName: "L3-S1" });

    expect(await screen.findByRole("checkbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Follow the department/ })).toBeNull();
  });
});
