import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderSemester } from "@/components/HeaderSemester";
import * as lists from "@/services/portalLists";
import { recall, SCHEMA_TERM } from "@/services/remembered";
import * as timetables from "@/services/timetables";

function show() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HeaderSemester />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    { id: "plan:262710", name: "Semester 1 2026-27" },
    { id: "plan:262720", name: "Semester 2 2026-27" },
  ] as timetables.TimetableTerm[]);
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "plan:262710": "262710", "plan:262720": "262720" });
});

afterEach(() => vi.restoreAllMocks());

describe("the header's semester, the only semester menu", () => {
  it("tells every page the semester it shows, when none has been chosen yet", async () => {
    // A page reading the choice alone was empty until a semester was picked, on a menu that
    // already looked picked — and with the pages' own menus gone, there is nowhere else.
    show();

    await waitFor(() => expect(recall(SCHEMA_TERM)).toBe("plan:262710"));
  });

  it("moves every page when another is chosen", async () => {
    show();

    fireEvent.click(await screen.findByRole("combobox", { name: "Semester" }));
    fireEvent.click(await screen.findByRole("option", { name: /Semester 2/ }));

    expect(recall(SCHEMA_TERM)).toBe("plan:262720");
  });
});
