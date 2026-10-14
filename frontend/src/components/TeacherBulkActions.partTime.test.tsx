import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TeacherBulkActions } from "@/components/TeacherBulkActions";
import * as teachers from "@/services/teachers";

const person = (id: string, fullName: string): teachers.Teacher => ({
  id, folderId: null, fullName, email: "", phone: "", notes: "", archivedAt: null, createdAt: "", updatedAt: "",
});

const approved = (periodId: string, teacherId: string, periodStart: string, over: Partial<teachers.SubmittedTimeSheet> = {}) =>
  ({
    periodId, version: 1, teacherId, periodStart, periodEnd: "", periodLabel: "",
    staff: { name: "", staffId: "", email: "", department: "SCEN", position: "Part Time Lecturer" },
    claimedHours: 12, approvedBy: "Lama Tarsissi", approvedByEmail: "", approvedOn: "2026-10-14T05:44:10Z",
    days: [], sentAt: "", receivedAt: "", hrSubmittedAt: "", ...over,
  }) as teachers.SubmittedTimeSheet;

function show(chosen: string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TeacherBulkActions chosen={chosen} teachers={[person("t1", "Amina"), person("t2", "Bilal"), person("t3", "Chadi")]} onClear={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("Part Time Sheets for the ticked teachers", () => {
  it("downloads one period's sheets together, then marks exactly those as submitted to HR", async () => {
    vi.spyOn(teachers, "listEverySubmittedTimeSheet").mockResolvedValue([
      approved("41", "t1", "2026-09-15"),
      approved("42", "t2", "2026-09-15"),
      approved("40", "t1", "2026-08-15", { hrSubmittedAt: "2026-09-20T08:00:00Z" }),
      approved("99", "t9", "2026-09-15"), // not ticked
    ]);
    const download = vi.spyOn(teachers, "downloadPartTimeSheets").mockResolvedValue({ notPlaced: 0 });
    const mark = vi.spyOn(teachers, "markSubmittedToHr").mockResolvedValue({ marked: 2 });

    show(["t1", "t2", "t3"]);
    fireEvent.click(screen.getByRole("button", { name: /Part Time Sheets/ }));
    const dialog = await screen.findByRole("dialog");

    // The newest period first, and who has nothing approved for it said out loud.
    expect(await within(dialog).findByText("Amina")).toBeTruthy();
    expect(within(dialog).getByText("Bilal")).toBeTruthy();
    expect(within(dialog).getByText(/No approved sheet for .* from Chadi/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Download 2 sheets (.zip)" }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(["41", "42"]));
    // Downloading is not sending: nothing is marked until somebody says so.
    expect(mark).not.toHaveBeenCalled();

    fireEvent.click(await within(dialog).findByRole("button", { name: "Mark these 2 as submitted to HR" }));
    await waitFor(() => expect(mark).toHaveBeenCalledWith(["41", "42"]));
  });

  it("says so when none of them has a period approved yet", async () => {
    vi.spyOn(teachers, "listEverySubmittedTimeSheet").mockResolvedValue([]);

    show(["t3"]);
    fireEvent.click(screen.getByRole("button", { name: /Part Time Sheets/ }));

    expect(await screen.findByText(/has a period approved in the Timesheets app yet/)).toBeTruthy();
  });
});
