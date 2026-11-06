import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SelectMenu } from "@/components/SelectMenu";
import { SemesterShortName } from "@/components/SemesterShortName";
import * as lists from "@/services/portalLists";
import { semesterShown } from "@/services/semesterYears";

afterEach(() => vi.restoreAllMocks());

describe("a semester's short name", () => {
  it("is saved when the box is left, trimmed, and only when it changed", async () => {
    vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({ "term-1": "S1" });
    const save = vi.spyOn(lists, "setSemesterShortName").mockResolvedValue({ termId: "term-1", shortName: "Fall" });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <SemesterShortName termId="term-1" />
      </QueryClientProvider>,
    );
    const box = (await screen.findByDisplayValue("S1")) as HTMLInputElement;

    fireEvent.blur(box);
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(box, { target: { value: " Fall " } });
    fireEvent.blur(box);
    await waitFor(() => expect(save).toHaveBeenCalledWith("term-1", "Fall"));
  });

  it("shows in a semester menu as a tag in front of the name, beside the year", () => {
    render(
      <SelectMenu
        label="Semester"
        value="term-2"
        onChange={vi.fn()}
        options={[{ value: "term-2", ...semesterShown("Semester 2 2026-27", "2026-27", "S2") }]}
      />,
    );

    const chosen = screen.getByRole("combobox", { name: "Semester" });
    expect(chosen.textContent).toBe("short name S2Semester 2academic year 2026-27");
  });

  it("is left out where a semester has none", () => {
    expect(semesterShown("Semester 1 2026-27", "2026-27", "")).toEqual({ label: "Semester 1", year: "2026-27" });
  });
});
