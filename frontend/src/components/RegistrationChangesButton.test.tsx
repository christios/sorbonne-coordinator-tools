import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RegistrationChangesButton } from "@/components/RegistrationChangesButton";
import * as lists from "@/services/portalLists";
import type { Cohort } from "@/services/studentDatabase";

const L1 = { id: "l1", name: "L1" } as Cohort;

const missing = (studentId: string, termId: string, termCode: string, crn: string): lists.Mismatch => ({
  studentId,
  termId,
  termCode,
  courseCode: "MATH-001",
  kind: "missing",
  expected: [crn],
  registered: [],
});

afterEach(() => vi.restoreAllMocks());

describe("the registrar's worklist", () => {
  it("is the semester on screen's, not every semester's", async () => {
    // Once Semester 2's registrations are pulled, Semester 1's lines beside them would be
    // copied to admissions as changes to make now.
    vi.spyOn(lists, "fetchRegistrationCheck").mockResolvedValue({
      mismatches: [missing("A001", "plan:262710", "262710", "23223"), missing("A002", "plan:262720", "262720", "33223")],
      coverage: [],
      electives: [],
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RegistrationChangesButton
          cohorts={[L1]}
          cohortId="l1"
          cohortName="L1"
          nameOf={() => ""}
          yearOf={() => ""}
          warningsIn={() => []}
          semesterId="plan:262720"
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Registrations to change" }));

    const mine = (await screen.findByText("L1")).parentElement!;
    expect(mine.textContent).toContain("1 line, 1 student");
  });
});
