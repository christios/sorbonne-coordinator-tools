import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BringOverTeachers } from "@/components/BringOverTeachers";
import * as lists from "@/services/portalLists";

const teacher = (id: string, fullName: string, terms: string[]) =>
  ({ id, fullName, email: `${id}@sorbonne.ae`, terms }) as unknown as lists.ActiveTeacher;

afterEach(() => vi.restoreAllMocks());

function show(onClose = vi.fn()) {
  vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "plan:262710": "262710", "plan:262720": "262720" });
  vi.spyOn(lists, "fetchSemesterShortNames").mockResolvedValue({ "plan:262710": "S1", "plan:262720": "S2" });
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
    teacher("bilal", "Bilal Maaz", ["262710"]),
    teacher("carla", "Carla Nasr", ["262710"]),
    // Already active in Semester 2: nothing to bring.
    teacher("ahlem", "Ahlem Trabelsi", ["262710", "262720"]),
  ]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <BringOverTeachers open term="262720" semesterName="Semester 2 2026-27" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

describe("bringing teachers over into a semester", () => {
  it("lists who is active elsewhere and not here, with where they are", async () => {
    show();

    const list = await screen.findByRole("list", { name: "Teachers to bring over" });
    expect(within(list).getAllByRole("checkbox").length).toBe(2);
    expect(within(list).getByText("Bilal Maaz")).toBeTruthy();
    expect(within(list).queryByText("Ahlem Trabelsi")).toBeNull();
    expect(within(list).getAllByText("S1").length).toBe(2);
  });

  it("makes the ticked ones active in the semester", async () => {
    const activate = vi.spyOn(lists, "activateTeachers").mockResolvedValue({ added: 1 });
    const onClose = show();

    fireEvent.click(await screen.findByRole("checkbox", { name: /Carla Nasr/ }));
    fireEvent.click(screen.getByRole("button", { name: "Bring 1 over" }));

    await waitFor(() => expect(activate).toHaveBeenCalledWith(["carla"], "262720"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("ticks everybody shown at once", async () => {
    const activate = vi.spyOn(lists, "activateTeachers").mockResolvedValue({ added: 2 });
    show();

    await screen.findByRole("list", { name: "Teachers to bring over" });
    fireEvent.click(screen.getByRole("checkbox", { name: "All shown" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring 2 over" }));

    await waitFor(() => expect(activate).toHaveBeenCalledWith(["bilal", "carla"], "262720"));
  });
});
