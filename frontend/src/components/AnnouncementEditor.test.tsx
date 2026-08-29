import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnnouncementEditor } from "@/components/AnnouncementEditor";
import * as timetables from "@/services/timetables";

const EXISTING: timetables.PlatformAnnouncement[] = [
  { id: "a1", icon: "calendar", level: "notice", message: "Week 1 starts Monday 31 August" },
  { id: "a2", icon: "alert", level: "urgent", message: "Room 5.033 is closed this week" },
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
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([
    {
      id: "term-1",
      name: "Physics & Maths — Semester 1",
      slug: "s1",
      timezone: "Asia/Dubai",
      isPublished: true,
      courseCount: 1,
      sessionCount: 1,
      studentCount: 1,
      timetableFilename: "t.xls",
      enrolmentFilename: "",
      updatedAt: "2026-08-21T18:00:00Z",
    },
  ]);
  vi.spyOn(timetables, "fetchAnnouncements").mockResolvedValue({
    announcements: EXISTING,
    icons: ["info", "alert", "calendar"],
    cohorts: [{ key: "cohort-1", name: "Foundation Year", students: 24 }],
  });
});

afterEach(() => vi.restoreAllMocks());

describe("AnnouncementEditor", () => {
  it("loads the strip that is currently on the Student Hub", async () => {
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
      expect(save).toHaveBeenCalledWith("term-1", [
        {
          id: "a1",
          icon: "calendar",
          level: "notice",
          cohortKey: "",
          message: "Week 2 starts Monday 7 September",
        },
        {
          id: "a2",
          icon: "alert",
          level: "urgent",
          cohortKey: "",
          message: "Room 5.033 is closed this week",
        },
      ]),
    );
  });

  it("sends each notice back with the id it arrived with", async () => {
    // The platform keeps a notice's identity while its words are unchanged, and every
    // student's dismissal hangs off that identity. Saving a fix to one line must not
    // hand the other seven back to everybody who had already read them.
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue(EXISTING);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].map((item) => item.id)).toEqual(["a1", "a2"]);
  });

  it("says how much each notice matters, and starts a new one quiet", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue(EXISTING);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: /Add announcement/ }));
    fireEvent.change(messageBoxes()[2], { target: { value: "The library closes at 6" } });
    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].map((item) => item.level)).toEqual(["notice", "urgent", "notice"]);
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

    await waitFor(() => expect(save).toHaveBeenCalledWith("term-1", []));
    expect(screen.getByText(/No announcements/)).toBeTruthy();
  });

  it("chooses an icon through the shared menu, not a native select", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    const [firstRow] = screen.getAllByRole("listitem");
    // The repo forbids native <select> in product UI; SelectMenu renders a button.
    expect(within(firstRow).getByRole("combobox", { name: "Icon" }).tagName).toBe("BUTTON");
    // How much it matters is three buttons rather than a menu: the choice decides what
    // the notice looks like, so it wears those colours instead of hiding in a list.
    expect(within(firstRow).getByRole("radiogroup", { name: /How much it matters/ })).toBeTruthy();
    expect(within(firstRow).getByRole("combobox", { name: /Who sees it/ })).toBeTruthy();
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


describe("who a notice is for", () => {
  it("offers the semester's cohorts as well as everyone in it", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    const [firstRow] = screen.getAllByRole("listitem");
    fireEvent.click(within(firstRow).getByRole("combobox", { name: /Who sees it/ }));

    expect(await screen.findByRole("option", { name: /Everyone this semester/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Foundation Year \(24\)/ })).toBeTruthy();
  });

  it("sends the chosen cohort with the notice", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue(EXISTING);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    const [firstRow] = screen.getAllByRole("listitem");
    fireEvent.click(within(firstRow).getByRole("combobox", { name: /Who sees it/ }));
    fireEvent.click(await screen.findByRole("option", { name: /Foundation Year \(24\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1].map((item) => item.cohortKey)).toEqual(["cohort-1", ""]);
  });

  it("saves against the semester on screen, because each has its own strip", async () => {
    const save = vi.spyOn(timetables, "saveAnnouncements").mockResolvedValue(EXISTING);
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Save strip" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toBe("term-1");
  });
});

describe("seeing what the student will see", () => {
  it("wears the level's own colour, so the choice shows where it is made", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));
    const [first, second] = screen.getAllByRole("listitem");

    // EXISTING is one "notice" and one "urgent".
    expect(first.className).toContain("#cfe0ef");
    expect(second.className).toContain("#e5b7b9");
  });

  it("changes colour the moment the level does", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));
    const [first] = screen.getAllByRole("listitem");

    fireEvent.click(within(first).getByRole("radio", { name: "Urgent" }));

    expect(screen.getAllByRole("listitem")[0].className).toContain("#e5b7b9");
  });

  it("counts down only once the room left is worth knowing about", async () => {
    renderEditor();
    await waitFor(() => expect(messageBoxes()).toHaveLength(2));

    fireEvent.change(messageBoxes()[0], { target: { value: "Short" } });
    expect(screen.queryByText(/left$/)).toBeNull();

    fireEvent.change(messageBoxes()[0], { target: { value: "x".repeat(145) } });
    expect(screen.getByText("15 left")).toBeTruthy();
  });

  it("flags a notice addressed to a cohort this semester no longer has", async () => {
    // The coordinator would otherwise see a normal-looking notice that reaches nobody.
    vi.spyOn(timetables, "fetchAnnouncements").mockResolvedValue({
      announcements: [{ id: "a1", icon: "info", level: "notice", cohortKey: "gone", message: "Orphan" }],
      icons: ["info"],
      cohorts: [{ key: "cohort-1", name: "Foundation Year", students: 24 }],
    });
    renderEditor();

    expect(await screen.findByText(/Not a cohort on this semester/)).toBeTruthy();
  });
})
