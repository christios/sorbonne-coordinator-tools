import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupRoster } from "@/components/GroupRoster";
import * as store from "@/services/rosterStore";
import * as database from "@/services/studentDatabase";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <GroupRoster
        open
        cohortId="c1"
        cohortName="FYS-S1"
        scopeId="scope-td"
        scopeCode="TD"
        groupId="td-1"
        groupLabel="1"
        onClose={() => {}}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(database, "fetchAssignments").mockResolvedValue({
    A001: { "scope-td": "td-1", "scope-cm": "cm-a" },
    A002: { "scope-td": "td-2" },
    A003: { "scope-td": "td-1" },
  });
});
afterEach(() => vi.restoreAllMocks());

describe("who is in a group", () => {
  it("lists this group's students and nobody else's", async () => {
    vi.spyOn(store, "namesHeld").mockResolvedValue({ A001: "Amira Haddad", A003: "Rana Aziz" });

    show();

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Amira Haddad")).toBeTruthy();
    expect(within(list).getByText("Rana Aziz")).toBeTruthy();
    // A002 is in another group of the same set.
    expect(within(list).queryByText("A002")).toBeNull();
    expect(screen.getByText(/2 students in FYS-S1/)).toBeTruthy();
  });

  it("is still a list when this browser holds no names", async () => {
    /*
     * Names live only in the browser — the server is told ids and CRNs and never who they
     * belong to. A browser that has not synced must still be able to answer the question,
     * because an id is what goes in a message to the registrar anyway.
     */
    vi.spyOn(store, "namesHeld").mockResolvedValue({});

    show();

    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("A001")).toBeTruthy();
    expect(screen.getByText(/This browser holds no names yet/)).toBeTruthy();
  });

  it("says so when nobody has been placed here", async () => {
    vi.spyOn(store, "namesHeld").mockResolvedValue({});
    vi.spyOn(database, "fetchAssignments").mockResolvedValue({ A002: { "scope-td": "td-2" } });

    show();

    expect(await screen.findByText("Nobody is in this group yet.")).toBeTruthy();
  });
});
