import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ViewBar } from "@/components/ViewBar";
import * as rosters from "@/services/scenRosters";
import type { StudentView } from "@/services/studentDatabase";

const VIEW: StudentView = {
  id: "view-fy",
  name: "FY 262710",
  description: "",
  filter: {
    DEPT_CODE: ["SCEN"],
    YEARLEVEL_CODE: ["FY"],
    TERM_CODE: ["262710"],
  },
  held: 239,
  gone: 0,
  lastSyncedAt: "2026-08-25T09:00:00Z",
  createdAt: "2026-08-01T09:00:00Z",
  updatedBy: "coordinator@sorbonne.ae",
};

const SCHEMA = {
  columns: [],
  fields: [
    { key: "YEARLEVEL_CODE", label: "Year level", options: [{ value: "FY", label: "Foundation Year" }] },
    { key: "DEPT_CODE", label: "Department", options: [{ value: "SCEN", label: "Sciences & Engineering" }] },
  ],
  term: null,
};

function show(views = [VIEW], viewId = VIEW.id) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ViewBar views={views} viewId={viewId} onChoose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const openCog = async () =>
  fireEvent.click(await screen.findByRole("button", { name: /The filter behind FY 262710/ }));

beforeEach(() => {
  vi.spyOn(rosters, "fetchSchema").mockResolvedValue(SCHEMA as never);
});

afterEach(() => vi.restoreAllMocks());

describe("reading the filter behind a view", () => {
  it("offers it beside the sync button, for anybody, not just an administrator", async () => {
    show();

    expect(await screen.findByRole("button", { name: /The filter behind FY 262710/ })).toBeTruthy();
  });

  it("names each field the way the portal names it, with the code beneath", async () => {
    show();
    await openCog();

    expect(await screen.findByText("Year level")).toBeTruthy();
    expect(screen.getByText("YEARLEVEL_CODE")).toBeTruthy();
    expect(screen.getByText("Foundation Year")).toBeTruthy();
  });

  it("shows a field the schema does not describe rather than hiding it", async () => {
    // The filter outlives the schema, and a field nobody can name is still being asked for.
    show();
    await openCog();

    expect(await screen.findByText("TERM_CODE")).toBeTruthy();
    expect(screen.getByText("262710")).toBeTruthy();
  });

  it("says the filter cannot be edited, because that is why it can be trusted", async () => {
    show();
    await openCog();

    expect(await screen.findByText(/Fixed when the view was made/)).toBeTruthy();
  });

  it("says plainly when a view filters on nothing at all", async () => {
    const everyone: StudentView = { ...VIEW, id: "all", name: "All students", filter: {} };
    show([everyone], "all");

    fireEvent.click(await screen.findByRole("button", { name: /The filter behind All students/ }));

    expect(await screen.findByText(/asks for every student the portal will return/)).toBeTruthy();
  });
});
