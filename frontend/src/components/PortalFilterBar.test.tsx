import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalFilterBar } from "@/components/PortalFilterBar";
import * as lists from "@/services/portalLists";
import * as rosters from "@/services/scenRosters";

vi.mock("@/components/useStaffUser", () => ({ useStaffUser: () => ({ email: "c@sorbonne.ae", name: "C", isAdmin: true }) }));

const FILTER: lists.PortalFilter = {
  id: "f1", kind: "registrations", name: "SCEN", filter: { DEPT_CODE: ["SCEN"] },
  held: 0, gone: 0, lastSyncedAt: "", createdAt: "", updatedBy: "",
};

function show(kind: lists.ListKind, onPulled = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PortalFilterBar kind={kind} filterId="f1" onChoose={() => {}} onPulled={onPulled} />
    </QueryClientProvider>,
  );
  return onPulled;
}

beforeEach(() => {
  vi.spyOn(lists, "fetchPortalFilters").mockResolvedValue([FILTER]);
  vi.spyOn(rosters, "fetchGridSchema").mockResolvedValue({
    ok: true, source: "built-in", fields: [], columns: [], term: { code: "262710", label: "S1" }, harvestedAt: null, error: "",
  });
});

afterEach(() => vi.restoreAllMocks());

describe("syncing a registrations filter", () => {
  it("asks the extension for that grid, sends ids and CRNs only, and hands the pull back", async () => {
    const pull = vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      kind: "registrations", term: { code: "262710", label: "S1" }, presetId: "", name: "SCEN", count: 2, expect: null,
      warning: null, fetchedAt: 1,
      rows: [
        { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", COURSE_CRN: "22151", COURSE_CODE: "MATH-001" },
        { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", COURSE_CRN: "23652", COURSE_CODE: "MATH-011" },
      ],
    });
    const sync = vi.spyOn(lists, "syncRegistrations").mockResolvedValue({ seen: 1, added: 1, missing: 0, syncedAt: "now", rows: 2 });
    const onPulled = show("registrations");

    const button = await screen.findByText("Seed this filter");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    await waitFor(() => expect(sync).toHaveBeenCalledWith("f1", "262710", [
      { studentId: "A001", crn: "22151", courseCode: "MATH-001" },
      { studentId: "A001", crn: "23652", courseCode: "MATH-011" },
    ]));
    expect(pull.mock.calls[0][1]).toMatchObject({ kind: "registrations", name: "SCEN" });
    expect(onPulled).toHaveBeenCalled();
    expect(await screen.findByText(/1 student returned/)).toBeTruthy();
  });

  it("says so when the extension refuses", async () => {
    vi.spyOn(rosters, "pullFilter").mockRejectedValue(new rosters.PortalError("auth"));
    show("registrations");

    const button = await screen.findByText("Seed this filter");
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);

    expect((await screen.findByRole("alert")).textContent).toMatch(/portal session has expired/);
  });
});
