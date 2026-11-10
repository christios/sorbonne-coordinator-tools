import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CarrySet } from "@/components/CarrySet";
import * as database from "@/services/studentDatabase";
import type { TimetableTerm } from "@/services/timetables";

const TERMS = [
  { id: "plan:262710", name: "Semester 1" },
  { id: "plan:262720", name: "Semester 2" },
] as TimetableTerm[];

afterEach(() => vi.restoreAllMocks());

function show(onCarried = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CarrySet scope={{ id: "lang-s1", code: "LANG", termId: "plan:262710" }} semesters={TERMS} onCarried={onCarried} />
    </QueryClientProvider>,
  );
  return onCarried;
}

describe("carrying a set into another semester", () => {
  it("makes it again there, says what came across, and shows it", async () => {
    // Semester 2's LANG, with the 26 French exemptions that had to be typed again by hand.
    const carry = vi
      .spyOn(database, "carryScope")
      .mockResolvedValue({ scopeId: "lang-s2", courses: 3, groups: 20, exemptions: 26 });
    const onCarried = show();

    fireEvent.click(screen.getByRole("button", { name: "Carry LANG into another semester" }));
    // The only other semester is chosen already.
    fireEvent.click(await screen.findByRole("button", { name: /Carry into Semester 2/ }));

    await waitFor(() => expect(carry).toHaveBeenCalledWith("lang-s1", "plan:262720"));
    expect((await screen.findByRole("status")).textContent).toContain("3 courses, 20 groups, 26 exemptions");
    fireEvent.click(screen.getByRole("button", { name: /Show LANG in Semester 2/ }));
    expect(onCarried).toHaveBeenCalledWith("plan:262720", "lang-s2");
  });

  it("says why when it cannot be made there", async () => {
    vi.spyOn(database, "carryScope").mockRejectedValue(new Error("There is already a block in that semester called LANG."));
    show();

    fireEvent.click(screen.getByRole("button", { name: "Carry LANG into another semester" }));
    fireEvent.click(await screen.findByRole("button", { name: /Carry into Semester 2/ }));

    expect((await screen.findByRole("alert")).textContent).toContain("already a block in that semester called LANG");
  });
});
