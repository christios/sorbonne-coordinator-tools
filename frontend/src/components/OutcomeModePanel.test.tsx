import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OutcomeModePanel } from "./OutcomeModePanel";
import { fetchOutcomeMode, setOutcomeMode } from "@/services/syllabusOutcomeMode";

vi.mock("@/services/syllabusOutcomeMode", async (original) => ({
  ...(await original<typeof import("@/services/syllabusOutcomeMode")>()),
  fetchOutcomeMode: vi.fn().mockResolvedValue({ mode: "teacher", updatedAt: "", updatedBy: "", updatedByName: "" }),
  setOutcomeMode: vi.fn().mockResolvedValue({ mode: "hod", updatedAt: "2026-11-10T08:00:00Z", updatedBy: "chair@sorbonne.ae", updatedByName: "Chair" }),
}));

const panel = (canChange: boolean) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><OutcomeModePanel canChange={canChange} /></QueryClientProvider>);

describe("Who writes course learning outcomes", () => {
  it("asks before handing every syllabus's outcomes to the Head of Department, then switches", async () => {
    panel(true);

    expect(await screen.findByText("Nobody has chosen yet, so teachers write their own outcomes.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /Head of Department/ }));
    expect(screen.getByRole("dialog", { name: "Hand the course learning outcomes to the Head of Department?" })).toBeTruthy();
    expect(setOutcomeMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(setOutcomeMode).toHaveBeenCalledWith("hod"));
    expect(await screen.findByText(/Set by Chair/)).toBeTruthy();
  });

  it("shows the choice to everyone but lets only the builder's administrators change it", async () => {
    panel(false);

    await waitFor(() => expect(fetchOutcomeMode).toHaveBeenCalled());
    expect((screen.getByRole("radio", { name: /Teachers/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Only an administrator of the syllabus builder can change it/)).toBeTruthy();
  });
});
