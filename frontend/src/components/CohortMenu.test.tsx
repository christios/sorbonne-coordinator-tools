import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CohortMenu } from "@/components/CohortMenu";
import * as lists from "@/services/portalLists";

afterEach(() => vi.restoreAllMocks());

const L1 = { id: "l1", name: "L1", term: "2026-27", memberCount: 120, memberCounts: { "plan:262710": 108, "plan:262720": 12 } };

/*
 * Every menu that chooses a cohort says it the same way — the semester's tag, the cohort's
 * year, its name and its students in that semester — because it is the same menu.
 */
describe("the cohort menu", () => {
  it("says each cohort with the semester's tag, its year and its students there", async () => {
    vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({ "plan:262720": "S2" });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CohortMenu cohorts={[L1]} semesterId="plan:262720" value="" onChange={vi.fn()} placeholder="Which cohort…" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Cohort" }));
    const option = await screen.findByRole("option", { name: /L1/ });
    await vi.waitFor(() => expect(option.textContent).toBe("short name S2academic year 2026-27L112"));
  });
});
