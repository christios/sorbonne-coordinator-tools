import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CourseHours } from "@/components/CourseRequest";
import type { CardSet } from "@/services/courseCards";
import type { CoursePlan } from "@/services/coursePlans";
import * as database from "@/services/studentDatabase";
import { EMPTY_REQUEST } from "@/services/studentDatabase";

const set = (id: string, code: string, hours = "", duration = "", weeks = ""): CardSet =>
  ({
    scope: { id: `scope-${id}`, code },
    course: { id, code: "MATH-001", name: "Pre Calculus 1", component: code, request: { ...EMPTY_REQUEST, hours, duration, weeks } },
    rows: [],
  }) as unknown as CardSet;

const PLAN = {
  courseCode: "MATH-001",
  components: {
    CM: { hours: 50, length: 1.5, issue: "", source: "sections", exceptions: [] },
    TD: { hours: 50, length: 1.5, issue: "", source: "asks", exceptions: ["TD 3 says 45 h"] },
    TP: { hours: null, length: null, issue: "", source: "", exceptions: [] },
  },
} as unknown as CoursePlan;

const form = (sets: CardSet[], onSaved = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CourseHours sets={sets} plan={PLAN} onSaved={onSaved} />
    </QueryClientProvider>,
  );
  return onSaved;
};

beforeEach(() => vi.restoreAllMocks());

describe("the course's hours, set in the open (23 Nov 2026)", () => {
  it("says where the plan reads them from, and the sections with their own", () => {
    form([set("cm", "CM"), set("td", "TD", "50", "1.5")]);

    // The CM asks nothing here: its sections' 50 h, offered as the figure to type.
    expect((screen.getByRole("textbox", { name: "Hours for CM" }) as HTMLInputElement).placeholder).toBe("50");
    expect(screen.getByText(/From its sections, which agree/)).toBeTruthy();
    expect(screen.getByText("Own figure: TD 3 says 45 h")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save the hours" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves the hours and session length into what the set asks, keeping the rest of it", async () => {
    const update = vi.spyOn(database, "updateCourseRequest").mockResolvedValue(undefined);
    const saved = form([set("cm", "CM", "", "", "1-14"), set("td", "TD", "50", "1.5")]);

    fireEvent.change(screen.getByRole("textbox", { name: "Hours for CM" }), { target: { value: "50" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Session length for CM" }), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save the hours" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("cm", { ...EMPTY_REQUEST, hours: "50", duration: "1.5", weeks: "1-14" }));
    expect(update).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saved).toHaveBeenCalled());
  });
});
