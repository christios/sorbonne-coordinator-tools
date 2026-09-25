import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProgrammeCodesPanel } from "@/components/ProgrammeCodesPanel";
import * as codes from "@/services/programmeCodes";

const MATS = { code: "MATS", sameAs: "MATH", createdAt: "2026-09-25T09:00:00Z", createdBy: "christian.kha.work@gmail.com" };

function shown(canChange: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProgrammeCodesPanel canChange={canChange} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("programme codes in Settings", () => {
  it("lets an administrator say once that a new code means an old one", async () => {
    vi.spyOn(codes, "fetchProgrammeCodes").mockResolvedValue([]);
    const saved = vi.spyOn(codes, "setProgrammeCode").mockResolvedValue([MATS]);
    shown(true);

    expect(await screen.findByText(/No codes are treated as the same yet/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("The new code"), { target: { value: "mats" } });
    fireEvent.change(screen.getByLabelText("The code it means"), { target: { value: "MATH" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(saved).toHaveBeenCalledWith("mats", "MATH"));
    const row = (await screen.findByText("MATS")).closest("li");
    expect(row?.textContent).toContain("means");
    expect(row?.textContent).toContain("MATH");
  });

  it("says why a pair is refused, in the server's words", async () => {
    vi.spyOn(codes, "fetchProgrammeCodes").mockResolvedValue([MATS]);
    vi.spyOn(codes, "setProgrammeCode").mockRejectedValue(new Error("MATS already means MATH: say MATX means MATH instead."));
    shown(true);

    await screen.findByText("MATS");
    fireEvent.change(screen.getByLabelText("The new code"), { target: { value: "MATX" } });
    fireEvent.change(screen.getByLabelText("The code it means"), { target: { value: "MATS" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByRole("alert")).textContent).toContain("say MATX means MATH instead");
  });

  it("shows everybody else the list, to read", async () => {
    vi.spyOn(codes, "fetchProgrammeCodes").mockResolvedValue([MATS]);
    shown(false);

    expect(await screen.findByText("MATS")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Stop treating/ })).toBeNull();
    expect(screen.getByText("Only an administrator can change this list.")).toBeTruthy();
  });
});
