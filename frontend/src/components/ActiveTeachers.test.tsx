import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveTeachers } from "@/components/ActiveTeachers";
import * as lists from "@/services/portalLists";

beforeEach(() => {
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
    {
      id: "act-1", portalTeacherId: "A001", partTimeTeacherId: "", fullName: "Ahlem Trabelsi", email: "ahlem@sorbonne.ae",
      source: "portal", addedAt: "2026-09-05T10:00:00", addedBy: "c@sorbonne.ae", teacherStatus: "AC", category: "Professor",
      type: "Part-Time", lastTerm: "262710", department: "LPEM", rank: "", courses: "ECON-101", institution: "", portalStatus: "in_portal",
    },
  ]);
  vi.spyOn(lists, "fetchPartTimeTeachers").mockResolvedValue([
    { id: "pt-1", fullName: "Ahlem Trabelsi", email: "ahlem@sorbonne.ae" },
    { id: "pt-2", fullName: "Carla Nasr", email: "carla@example.org" },
  ]);
});

afterEach(() => vi.restoreAllMocks());

function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ActiveTeachers />
    </QueryClientProvider>,
  );
}

describe("the department's active teachers", () => {
  it("lists them on the shared table with where each came from", async () => {
    show();

    expect(await screen.findByText("Ahlem Trabelsi")).toBeTruthy();
    expect(screen.getByText("Portal")).toBeTruthy();
    expect(screen.getByText("1 teachers")).toBeTruthy();
  });

  it("adds teachers picked from the part-time database", async () => {
    const add = vi.spyOn(lists, "addActiveTeachers").mockResolvedValue({ added: 1, linked: 0, skipped: 0 });
    show();
    await screen.findByText("Ahlem Trabelsi");

    fireEvent.click(screen.getByText("Add from part-time database"));
    const list = await screen.findByLabelText("Part-time teachers");
    // Everyone in the database is offered — nobody is linked to a part-time record yet.
    expect(list.textContent).toContain("Carla Nasr");
    fireEvent.click(screen.getByLabelText(/Carla Nasr/).querySelector("input") ?? screen.getByText("Carla Nasr"));
    fireEvent.click(screen.getByText("Add 1"));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ partTime: [{ id: "pt-2", fullName: "Carla Nasr", email: "carla@example.org" }] }),
    );
    expect(await screen.findByText(/1 added/)).toBeTruthy();
  });
});
