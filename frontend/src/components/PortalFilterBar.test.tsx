import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalFilterBar } from "@/components/PortalFilterBar";
import * as lists from "@/services/portalLists";
import * as rosters from "@/services/scenRosters";

vi.mock("@/components/useStaffUser", () => ({ useStaffUser: () => ({ email: "c@sorbonne.ae", name: "C", isAdmin: true }) }));

const FILTER: lists.PortalFilter = {
  id: "f1", kind: "registrations", name: "SCEN", filter: { DEPT_CODE: ["SCEN"] },
  held: 12, gone: 1, lastSyncedAt: "", createdAt: "", updatedBy: "",
};

function show(kind: lists.ListKind, onChoose: (id: string) => void = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PortalFilterBar kind={kind} filterId="f1" onChoose={onChoose} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(lists, "fetchPortalFilters").mockResolvedValue([FILTER]);
  vi.spyOn(rosters, "fetchGridSchema").mockResolvedValue({
    ok: true, source: "built-in", fields: [], columns: [], term: { code: "262710", label: "S1" }, harvestedAt: null, error: "",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("choosing a portal filter", () => {
  it("forgets a remembered filter that no longer exists, rather than showing nothing", async () => {
    const onChoose = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PortalFilterBar kind="courses" filterId="gone-since-copy" onChoose={onChoose} />
      </QueryClientProvider>,
    );

    await vi.waitFor(() => expect(onChoose).toHaveBeenCalledWith(""));
  });

  it("keeps a remembered filter that still exists", async () => {
    const onChoose = vi.fn();
    show("registrations", onChoose);
    await screen.findByText(/1 no longer returned/);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("says what the filter holds and what it has stopped returning", async () => {
    show("registrations");

    expect(await screen.findByText(/1 no longer returned/)).toBeTruthy();
    expect(screen.getByText(/never synced/)).toBeTruthy();
  });

  it("does not offer to sync — Portal sync does that, for every list at once", async () => {
    show("registrations");
    await screen.findByText(/never synced/);

    expect(screen.queryByText(/Sync this filter|Seed this filter/)).toBeNull();
  });

  it("shows an administrator what the filter asks the portal", async () => {
    show("registrations");

    fireEvent.click(await screen.findByLabelText("What SCEN asks the portal"));

    expect(await screen.findByText(/Fixed when the portal filter was made/)).toBeTruthy();
  });
});
