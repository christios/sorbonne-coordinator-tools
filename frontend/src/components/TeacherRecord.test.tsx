import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { StaffStatusFact } from "@/components/TeacherRecord";
import * as lists from "@/services/portalLists";
import type { ActiveTeacher } from "@/services/portalLists";

const LOUIS = { id: "act-4", fullName: "Louis Malterre", type: "Full Time", staffStatus: "", source: "portal" } as ActiveTeacher;

function show(teacher: ActiveTeacher | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <StaffStatusFact teacher={teacher} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("a teacher's status for the budget", () => {
  it("goes by the portal until the department says otherwise, and is said here", async () => {
    const save = vi.spyOn(lists, "setStaffStatus").mockResolvedValue({ ...LOUIS, staffStatus: "PHD" });
    show(LOUIS);

    const choice = screen.getByLabelText("Status for the budget") as HTMLSelectElement;
    // The portal lists him as full time; that is what the page reads until told.
    expect(choice.value).toBe("");
    expect(screen.getByRole("option", { name: "As the portal says (FT)" })).toBeTruthy();

    fireEvent.change(choice, { target: { value: "PHD" } });

    await waitFor(() => expect(save).toHaveBeenCalledWith("act-4", "PHD"));
  });

  it("has nothing to set for somebody not on the department's list", () => {
    show(null);

    expect(screen.queryByLabelText("Status for the budget")).toBeNull();
    expect(screen.getByText("not said")).toBeTruthy();
  });
});
