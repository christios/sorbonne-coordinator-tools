import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaleSyncWarning } from "@/components/StaleSyncWarning";
import * as lists from "@/services/portalLists";
import * as rosters from "@/services/scenRosters";
import * as run from "@/services/syncRun";
import * as targets from "@/services/syncTargets";

const CHECK: lists.Check = {
  name: "portal_sync_age",
  title: "Portal data old enough that the pages should not be trusted",
  measures: "hours old",
  enabled: true,
  threshold: 8,
  defaultEnabled: true,
  defaultThreshold: 8,
};

const hoursAgo = (hours: number) => Date.now() - hours * 3_600_000;

function synced(at: number | null) {
  vi.spyOn(targets, "useSyncTargets").mockReturnValue({
    targets: [{ kind: "students", id: "view-1", label: "L1" }] as never,
    ready: true,
    syncedAt: at,
  });
}

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StaleSyncWarning />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.spyOn(lists, "fetchChecks").mockResolvedValue([CHECK]);
  vi.spyOn(run, "getRun").mockReturnValue(null);
  vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe("data too old to work from", () => {
  it("says so, with how old it is", async () => {
    synced(hoursAgo(21));
    show();

    expect(await screen.findByText("The portal data is 21 hours old")).toBeTruthy();
  });

  it("stays out of the way while the data is fresh", async () => {
    synced(hoursAgo(2));
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });

  it("says nothing while a sync is already going", async () => {
    // It is being answered, and warning about it would be warning somebody about the
    // thing they are watching happen.
    synced(hoursAgo(21));
    vi.spyOn(run, "getRun").mockReturnValue({ steps: [] } as never);
    vi.spyOn(run, "isRunning").mockReturnValue(true);
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });

  it("takes the hours from the department's check, not from the code", async () => {
    synced(hoursAgo(21));
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([{ ...CHECK, threshold: 48 }]);
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });

  it("is silent when the department has switched the check off", async () => {
    synced(hoursAgo(80));
    vi.spyOn(lists, "fetchChecks").mockResolvedValue([{ ...CHECK, enabled: false }]);
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });

  it("does not come back once it has been answered in this tab", async () => {
    synced(hoursAgo(21));
    const first = show();
    fireEvent.click(await screen.findByRole("button", { name: /Work from it anyway/ }));
    expect(screen.queryByText(/portal data is/)).toBeNull();

    first.unmount();
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });

  it("starts the sync from the warning itself", async () => {
    synced(hoursAgo(21));
    const begin = vi.spyOn(run, "startRun").mockResolvedValue(undefined);
    show();

    fireEvent.click(await screen.findByRole("button", { name: /Sync now/ }));

    await waitFor(() => expect(begin).toHaveBeenCalled());
    // And gets out of the way: the run's own report is what says what happens next.
    await waitFor(() => expect(screen.queryByText(/portal data is/)).toBeNull());
  });

  it("says what to do when the registrar extension is not there to ask", async () => {
    synced(hoursAgo(21));
    vi.spyOn(rosters, "isExtensionInstalled").mockResolvedValue(false);
    const begin = vi.spyOn(run, "startRun").mockResolvedValue(undefined);
    show();

    fireEvent.click(await screen.findByRole("button", { name: /Sync now/ }));

    expect(await screen.findByText(/extension did not answer/)).toBeTruthy();
    expect(begin).not.toHaveBeenCalled();
  });

  it("says nothing to a department that has never synced at all", async () => {
    synced(null);
    show();

    await waitFor(() => expect(lists.fetchChecks).toHaveBeenCalled());
    expect(screen.queryByText(/portal data is/)).toBeNull();
  });
});
