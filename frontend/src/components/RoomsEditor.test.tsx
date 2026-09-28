import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RoomsEditor } from "@/components/RoomsEditor";
import * as http from "@/services/http";
import * as rooms from "@/services/rooms";

const ROOM = (code: string, seats: number | null, aliases: string[] = []): rooms.Room => ({
  id: `id-${code}`, code, name: "", building: "B-5, FF", kind: "Classroom", seats, aliases, updatedAt: "", updatedBy: "",
});

function show(portalRooms: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomsEditor portalRooms={portalRooms} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // The list, as the server answers it.
  vi.spyOn(http, "apiFetch").mockImplementation(async () =>
    new Response(JSON.stringify({ rooms: [ROOM("5.101/5.103", 58), ROOM("Roberto Sorbonne", 154, ["B4.Robert"])] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
});

describe("the rooms and their seats", () => {
  it("says which rooms the portal books that the list does not have, matching the portal's own spellings", async () => {
    show(["5.101/.103", "B4.Robert", "3.024-Oval", ""]);

    expect(await screen.findByText(/The portal books a room this list does not have/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "3.024-Oval" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "5.101/.103" })).toBeNull();
  });

  it("saves a room's new seats, and only once something has changed", async () => {
    const update = vi.spyOn(rooms, "updateRoom").mockResolvedValue(ROOM("5.101/5.103", 60));
    show();

    const seats = await screen.findByLabelText("Seats in 5.101/5.103");
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(seats, { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("id-5.101/5.103", expect.objectContaining({ code: "5.101/5.103", seats: 60 })));
  });

  it("adds a room the portal books from its name, with the seats typed in", async () => {
    const add = vi.spyOn(rooms, "addRoom").mockResolvedValue(ROOM("3.024-Oval", 20));
    show(["3.024-Oval"]);

    fireEvent.click(await screen.findByRole("button", { name: "3.024-Oval" }));
    fireEvent.change(screen.getByLabelText("Seats in new room"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(add).toHaveBeenCalledWith(expect.objectContaining({ code: "3.024-Oval", seats: 20 })));
  });
});
