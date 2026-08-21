import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import * as timetables from "@/services/timetables";

const EXISTING = [
  { id: "a1", icon: "calendar", message: "Week 1 starts Monday 31 August" },
  { id: "a2", icon: "alert", message: "Room 5.033 is closed this week" },
];

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnnouncementEditor />
    </QueryClientProvider>,
  );
}

function messageBoxes(): HTMLInputElement[] {
  return screen.getAllByLabelText("Announcement") as HTMLInputElement[];
}

beforeEach(() => {
  vi.spyOn(timetables, "fetchAnnouncements").mockResolvedValue({
    announcements: EXISTING,
    icons: ["info", "alert", "calendar"],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("AnnouncementEditor", () => {
  it("loads the strip that is currently on the student platform", async () => {
    renderEditor();

    await waitFor(() => expect(messageBoxes()).toHaveLength(2));
    expect(messageBoxes().map((input) => input.value)).toEqual([
      "Week 1 starts Monday 31 August",
      "Room 5.033 is closed this week",
    ]);
  });

  it("saves edited text with the icon each line carries", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue(EXISTING);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.change(messageBoxes()[0], { target: { value: "Week 2 starts Monday 7 September" } });
    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith([
        { icon: "calendar", message: "Week 2 starts Monday 7 September" },
        { icon: "alert", message: "Room 5.033 is closed this week" },
      ]),
    );
  });

  it("adds a line and removes one", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /Add announcement/ }));
    expect(messageBoxes()).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: /Remove announcement Week 1/ }));
    expect(messageBoxes()).toHaveLength(2);
  });

  it("will not save while a line is still empty", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue([]);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /Add announcement/ }));

    expect((screen.getByRole("button", { name: "Save strip" }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("lets the coordinator clear the strip entirely", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue([]);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /Remove announcement Week 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /Remove announcement Room 5.033/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith([]));
    expect(screen.getByText(/No announcements/)).toBeTruthy();
  });

  it("chooses an icon through the shared menu, not a native select", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    const [firstRow] = screen.getAllByRole("listitem");
    // The repo forbids native <select> in product UI; SelectMenu renders a button.
    expect(within(firstRow).getByRole("combobox").tagName).toBe("BUTTON");
    expect(document.querySelector("select")).toBeNull();
  });

  it("shows the platform's complaint if the save is refused", async () => {
    vi.spyOn(timetables, "saveAnnouncements").mockRejectedValue(
      new Error("Keep each announcement under 160 characters."),
    );
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    expect((await screen.findByRole("alert")).textContent).toContain("under 160 characters");
  });
});
