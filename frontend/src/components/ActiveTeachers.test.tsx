import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveTeachers } from "@/components/ActiveTeachers";
import * as lists from "@/services/portalLists";
import { ApiError } from "@/services/portalLists";

beforeEach(() => {
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
    {
      id: "act-1", portalTeacherId: "A001", partTimeTeacherId: "", fullName: "Ahlem Trabelsi", email: "ahlem@sorbonne.ae",
      source: "portal", addedAt: "2026-09-05T10:00:00", addedBy: "c@sorbonne.ae", teacherStatus: "AC", category: "Professor",
      type: "Part-Time", lastTerm: "262710", department: "LPEM", rank: "", courses: "ECON-101", institution: "", portalStatus: "in_portal",
    },
  ]);
  vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({ matches: [], partTime: [], unnamed: [] });
  vi.spyOn(lists, "fetchPartTimeTeachers").mockResolvedValue([
    { id: "pt-1", fullName: "Ahlem Trabelsi", email: "ahlem@sorbonne.ae" },
    { id: "pt-2", fullName: "Carla Nasr", email: "carla@example.org" },
  ]);
});

afterEach(() => vi.restoreAllMocks());

function show() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ActiveTeachers />
    </QueryClientProvider>,
  );
}

describe("the department's active teachers", () => {
  it("lists them on the shared table with where each came from", async () => {
    show();

    expect(await screen.findByText("Ahlem Trabelsi")).toBeTruthy();
    expect(screen.getByText("Portal")).toBeTruthy();
    expect(screen.getByText("1 teachers")).toBeTruthy();
  });

  it("adds teachers picked from the part-time database", async () => {
    const add = vi.spyOn(lists, "addActiveTeachers").mockResolvedValue({ added: 1, linked: 0, skipped: 0 });
    show();
    await screen.findByText("Ahlem Trabelsi");

    fireEvent.click(screen.getByText("Add from part-time database"));
    const list = await screen.findByLabelText("Part-time teachers");
    // Everyone in the database is offered — nobody is linked to a part-time record yet.
    expect(list.textContent).toContain("Carla Nasr");
    fireEvent.click(screen.getByLabelText(/Carla Nasr/).querySelector("input") ?? screen.getByText("Carla Nasr"));
    fireEvent.click(screen.getByText("Add 1"));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith({ partTime: [{ id: "pt-2", fullName: "Carla Nasr", email: "carla@example.org" }] }),
    );
    expect(await screen.findByText(/1 added/)).toBeTruthy();
  });
});

describe("somebody the portal has started listing", () => {
  it("is offered as a match, and linking hands the portal the lead", async () => {
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
      {
        id: "act-1", portalTeacherId: "", partTimeTeacherId: "pt-1", fullName: "Dr Ahlem TRABELSI",
        email: "ahlem@gmail.com", source: "part-time", addedAt: "2026-01-01", addedBy: "", teacherStatus: "",
        category: "", type: "", lastTerm: "", department: "", rank: "", courses: "", institution: "", portalStatus: "",
      },
    ]);
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [
        {
          activeId: "act-1", activeName: "Dr Ahlem TRABELSI", activeEmail: "ahlem@gmail.com",
          portalTeacherId: "A001", portalName: "Ahlem Trabelsi", portalEmail: "ahlem@sorbonne.ae",
          portalStatus: "in_portal",
        },
      ],
      partTime: [],
      unnamed: [],
    });
    const link = vi.spyOn(lists, "linkActiveTeacher").mockResolvedValue();
    show();

    // Offered, not applied — the row is still the part-time one until somebody says so.
    expect(await screen.findByText(/1 teacher is now in the portal/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Same person/ }));

    await waitFor(() => expect(link).toHaveBeenCalledWith("act-1", "A001"));
  });

  it("says nothing when nobody looks like anybody", async () => {
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({ matches: [], partTime: [], unnamed: [] });
    show();

    await screen.findByRole("button", { name: /Add from part-time database/ });
    expect(screen.queryByText(/now in the portal/)).toBeNull();
  });
});

describe("somebody the part-time database has held all along", () => {
  it("is offered as a match, and linking only adds the tag", async () => {
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [],
      partTime: [
        {
          activeId: "act-1", activeName: "Ahlem Trabelsi", activeEmail: "ahlem@sorbonne.ae",
          partTimeTeacherId: "pt-1", partTimeName: "Ahlem Trabelsi", partTimeEmail: "ahlem@gmail.com",
        },
      ],
      unnamed: [],
    });
    const link = vi.spyOn(lists, "linkPartTimeTeacher").mockResolvedValue();
    show();

    expect(await screen.findByText(/1 teacher is also in the part-time database/)).toBeTruthy();
    // Both addresses are shown, because the two of them are the reason a name had to do.
    expect(screen.getByText("ahlem@gmail.com")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Same person/ }));

    await waitFor(() => expect(link).toHaveBeenCalledWith("act-1", "pt-1"));
    // One of them is not a list to offer joining in one press.
    expect(screen.queryByRole("button", { name: /all 1/ })).toBeNull();
  });

  it("joins the whole list in one press, because the tag is all that changes", async () => {
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [],
      partTime: [
        {
          activeId: "act-1", activeName: "Ahlem Trabelsi", activeEmail: "ahlem@sorbonne.ae",
          partTimeTeacherId: "pt-1", partTimeName: "Ahlem Trabelsi", partTimeEmail: "",
        },
        {
          activeId: "act-2", activeName: "Cecile Paillot", activeEmail: "cecile@sorbonne.ae",
          partTimeTeacherId: "pt-2", partTimeName: "Cécile Paillot", partTimeEmail: "",
        },
      ],
      unnamed: [],
    });
    const link = vi.spyOn(lists, "linkPartTimeTeacher").mockResolvedValue();
    show();

    fireEvent.click(await screen.findByRole("button", { name: /Same person, all 2/ }));

    await waitFor(() => expect(link).toHaveBeenCalledTimes(2));
    expect(link.mock.calls).toEqual([
      ["act-1", "pt-1"],
      ["act-2", "pt-2"],
    ]);
  });

  it("keeps the joins it managed when one of them fails", async () => {
    // Separate writes: one that fails must not take the ones before it with it, and the
    // banner must come back showing what is left rather than an empty success.
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [],
      partTime: [
        {
          activeId: "act-1", activeName: "Ahlem Trabelsi", activeEmail: "",
          partTimeTeacherId: "pt-1", partTimeName: "Ahlem Trabelsi", partTimeEmail: "",
        },
        {
          activeId: "act-2", activeName: "Cecile Paillot", activeEmail: "",
          partTimeTeacherId: "pt-2", partTimeName: "Cécile Paillot", partTimeEmail: "",
        },
      ],
      unnamed: [],
    });
    const link = vi
      .spyOn(lists, "linkPartTimeTeacher")
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new ApiError("Somebody else on the department's list is already that record.", 409));
    show();

    fireEvent.click(await screen.findByRole("button", { name: /Same person, all 2/ }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(link).toHaveBeenCalledTimes(2);
  });

  it("says nothing when every row already knows both sides", async () => {
    show();

    await screen.findByRole("button", { name: /Add from part-time database/ });
    expect(screen.queryByText(/also in the part-time database/)).toBeNull();
  });
});

describe("teachers our sections name and the list does not hold", () => {
  it("names them with their section count, and offers the profile the registrar has", async () => {
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [],
      partTime: [],
      unnamed: [
        {
          name: "Wafaa Ahmed", sections: 6, portalTeacherId: "A007", portalName: "Wafa Ahmed",
          portalEmail: "wafa.ahmed@sorbonne.ae", portalDepartment: "SCEN",
        },
      ],
    });
    const add = vi.spyOn(lists, "addActiveTeachers").mockResolvedValue({ added: 1, linked: 0, skipped: 0 });
    show();

    expect(await screen.findByText(/1 teacher is named on our sections/)).toBeTruthy();
    expect(screen.getByText("6 sections")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add them/ }));

    await waitFor(() => expect(add).toHaveBeenCalledWith({ portalTeacherIds: ["A007"] }));
  });

  it("still names a gap the registrar has nobody close to, rather than hiding it", async () => {
    // Six sections taught by somebody nobody holds is worth knowing even when the answer
    // is not obvious — and a guess between two people is not an answer.
    vi.spyOn(lists, "fetchTeacherMatches").mockResolvedValue({
      matches: [],
      partTime: [],
      unnamed: [
        { name: "Sara Khaled", sections: 2, portalTeacherId: "", portalName: "", portalEmail: "", portalDepartment: "" },
      ],
    });
    show();

    expect(await screen.findByText("Sara Khaled")).toBeTruthy();
    expect(screen.getByText(/Nobody in the portal is close enough/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add them/ })).toBeNull();
  });
});

describe("removing teachers from the active list", () => {
  async function pickOneAndPressRemove() {
    show();
    await screen.findByText("Ahlem Trabelsi");
    const row = screen.getByText("Ahlem Trabelsi").closest("tr");
    fireEvent.click(row?.querySelector("input[type=checkbox]") as HTMLElement);
    fireEvent.click(screen.getByText("Remove 1"));
    return within(await screen.findByRole("dialog"));
  }

  it("treats a teacher who has already been removed as removed", async () => {
    // Somebody else removed them, or a first pass half-landed. The row being gone is
    // the outcome we asked for, so it must not stall the dialog and it must not make
    // the retry impossible.
    const remove = vi.spyOn(lists, "removeActiveTeacher").mockRejectedValue(new ApiError("That active teacher no longer exists.", 404));
    const dialog = await pickOneAndPressRemove();

    fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(remove).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("closes the dialog and says what failed, instead of leaving a dead button", async () => {
    vi.spyOn(lists, "removeActiveTeacher").mockRejectedValue(new ApiError("The server is having a moment.", 500));
    const dialog = await pickOneAndPressRemove();

    fireEvent.click(dialog.getByRole("button", { name: "Remove" }));

    // Today the dialog only closes on success, so one failure leaves a live-looking red
    // button over an error banner rendered underneath the dialog's own backdrop.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByRole("alert")).textContent).toContain("The server is having a moment.");
  });
});
