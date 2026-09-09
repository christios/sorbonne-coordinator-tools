import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GroupRoster } from "@/components/GroupRoster";
import * as lists from "@/services/portalLists";
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
  vi.spyOn(store, "rowsHeld").mockResolvedValue([
    { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", MAJOR_CODE_DESC: "Physics" },
  ] as never);
  vi.spyOn(database, "fetchCohorts").mockResolvedValue([]);
  vi.spyOn(database, "fetchStudents").mockResolvedValue([
    { studentId: "A001", status: "in_portal", cohortId: "c1", cohortName: "FYS-S1", cohortSince: "", firstSeenAt: "", lastSeenAt: "", groups: [] },
    { studentId: "A003", status: "in_portal", cohortId: "c1", cohortName: "FYS-S1", cohortSince: "", firstSeenAt: "", lastSeenAt: "", groups: [] },
  ]);
  vi.spyOn(lists, "fetchRegistrations").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({});
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

describe("looking one of them up", () => {
  beforeEach(() => {
    vi.spyOn(store, "namesHeld").mockResolvedValue({ A001: "Amira Haddad", A003: "Rana Aziz" });
  });

  it("narrows the list to what is typed, by name or by id", async () => {
    show();
    await screen.findByRole("list");

    fireEvent.change(screen.getByLabelText("Search this group"), { target: { value: "rana" } });

    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Rana Aziz")).toBeTruthy();

    // And by id, which is what somebody pastes out of an e-mail from the registrar.
    fireEvent.change(screen.getByLabelText("Search this group"), { target: { value: "A001" } });
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Amira Haddad")).toBeTruthy();
  });

  it("says so rather than showing an empty list when nothing matches", async () => {
    show();
    await screen.findByRole("list");

    fireEvent.change(screen.getByLabelText("Search this group"), { target: { value: "zzz" } });

    expect(screen.getByText(/Nobody in this group matches/)).toBeTruthy();
  });

  it("opens a student's record from their row, and comes back to the list", async () => {
    show();
    await screen.findByRole("list");

    fireEvent.click(screen.getByRole("button", { name: /Amira Haddad/ }));

    // The record replaces the list: two dialogs at one z-index would both take Escape.
    expect(await screen.findByRole("heading", { name: "Amira Haddad" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByLabelText("Search this group")).toBeNull());

    // Escape reaches only the record: the list's dialog is closed, so its own key
    // listener is not mounted at all. That is the point of showing one at a time.
    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByLabelText("Search this group")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Amira Haddad" })).toBeNull();
  });
});
