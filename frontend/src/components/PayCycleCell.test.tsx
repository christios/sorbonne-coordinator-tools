import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PayCycleCell } from "@/components/PayCycleCell";
import * as teachers from "@/services/teachers";

/**
 * Open the menu once the control will accept it.
 *
 * It is disabled until the answer arrives, and the period it prints while waiting is the
 * department's usual one — which is what it prints afterwards too, in every semester
 * today. So there is nothing on screen that changes when the answer lands, and the only
 * honest thing to wait for is the control becoming usable.
 */
async function open(name: string) {
  const trigger = await screen.findByRole("combobox", { name });
  await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
  fireEvent.click(trigger);
  return trigger;
}

function show(termId = "term-1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PayCycleCell termId={termId} termName="Semester 1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 20));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which day a semester's pay periods open on", () => {
  it("shows the usual day, and says it is the usual one", async () => {
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });

    show();

    expect(await screen.findByText(/as the department usually pays/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Pay periods for Semester 1" }).textContent).toContain("the 15th");
  });

  it("spells out the period running now, because a day alone says nothing about a claim", async () => {
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });

    show();

    expect(await screen.findByText(/15 Sep – 14 Oct 2026/)).toBeTruthy();
  });

  it("shows a semester paid on its own cycle, and stops calling it usual", async () => {
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: { "term-1": 1 }, default: 15 });

    show();

    // The period first: the control renders before the answer arrives, so reading its
    // value straight away reads the day it shows while it is still waiting.
    expect(await screen.findByText(/1 Sep – 30 Sep 2026/)).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Pay periods for Semester 1" }).textContent).toContain("the 1st");
    expect(screen.queryByText(/as the department usually pays/)).toBeNull();
  });

  it("saves the day that was chosen against this semester", async () => {
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });
    const save = vi.spyOn(teachers, "setPayCycle").mockResolvedValue({ opensOn: 20 });

    show();
    await open("Pay periods for Semester 1");
    fireEvent.click(await screen.findByRole("option", { name: "Opens the 20th" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith("term-1", 20));
  });

  it("offers no day some month would not have", async () => {
    // The 29th onwards would leave February without a period at all in most years.
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });

    show();
    await open("Pay periods for Semester 1");

    expect(await screen.findAllByRole("option")).toHaveLength(28);
    expect(screen.getByRole("option", { name: "Opens the 28th" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Opens the 29th" })).toBeNull();
  });

  it("uses the shared control, not a native select", () => {
    vi.spyOn(teachers, "fetchPayCycles").mockResolvedValue({ cycles: {}, default: 15 });

    show();

    expect(document.querySelector("select")).toBeNull();
  });
});
