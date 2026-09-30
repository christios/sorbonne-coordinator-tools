import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveTeachers } from "@/components/ActiveTeachers";
import * as lists from "@/services/portalLists";
import * as sessionChanges from "@/services/sessionChanges";
import * as database from "@/services/studentDatabase";
import * as termWeeks from "@/services/termWeeks";
import * as timetables from "@/services/timetables";
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
  // The planning, for the Teaches column.
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue([
    {
      cohort: { id: "c1", name: "L1-S1", term: "2026-27" },
      scopes: [
        {
          id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [{ id: "c-econ", code: "ECON-101", name: "Economics", component: "CM", request: database.EMPTY_REQUEST }],
          groups: [{ id: "g-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 20, crns: { "c-econ": { ...database.EMPTY_SECTION, crn: "22001", teacherId: "act-1" } } }],
        },
        {
          id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
          courses: [{ id: "t-econ", code: "ECON-101", name: "Economics", component: "TD", request: database.EMPTY_REQUEST }],
          groups: [{ id: "g-1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 20, crns: { "t-econ": { ...database.EMPTY_SECTION, crn: "22002", teacher: "Ahlem Trabelsi" } } }],
        },
      ],
    },
  ]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(timetables, "fetchTimetableTerms").mockResolvedValue([{ id: "term-1", name: "Semester 1" } as unknown as timetables.TimetableTerm]);
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
  it("says how many sections will be left with no teacher chosen", async () => {
    // Removing somebody clears the sections that chose them, because a link to nothing
    // reads as the old typed name rather than as an empty cell. So it is said before, not
    // discovered after.
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
      {
        id: "act-1", portalTeacherId: "A001", partTimeTeacherId: "", fullName: "Ahlem Trabelsi",
        email: "ahlem@sorbonne.ae", source: "portal", addedAt: "", addedBy: "", teacherStatus: "",
        category: "", type: "", lastTerm: "", department: "", rank: "", courses: "", institution: "",
        portalStatus: "in_portal", linkedSections: 6,
      } as unknown as lists.ActiveTeacher,
    ]);
    show();
    await screen.findByText("Ahlem Trabelsi");
    const row = screen.getByText("Ahlem Trabelsi").closest("tr");
    fireEvent.click(row?.querySelector("input[type=checkbox]") as HTMLElement);
    fireEvent.click(screen.getByText("Remove 1"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/6 sections have them chosen/)).toBeTruthy();
  });


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

describe("what a teacher takes", () => {
  it("says which kinds of class the planning names them on, chosen by id or by name", async () => {
    show();
    const row = (await screen.findByText("Ahlem Trabelsi")).closest("tr") as HTMLElement;
    // The lecture chose her by id; the tutorial only carries her name. Both are hers,
    // and each kind is drawn as itself rather than read out as one string.
    await waitFor(() => expect(within(row).getByText("CM")).toBeTruthy());
    expect(within(row).getByText("TD")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sort by Course types" })).toBeTruthy();
  });

  it("says which cohorts the planning has them standing in front of", async () => {
    show();
    const row = (await screen.findByText("Ahlem Trabelsi")).closest("tr") as HTMLElement;

    /*
     * Both her sections belong to L1-S1 — the lecture by id, the tutorial by name — so the
     * cohort is named once rather than once per section. "Who teaches L1" was a question
     * that could only be answered by opening every teacher in turn.
     */
    await waitFor(() => expect(within(row).getAllByText("L1-S1")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Sort by Cohorts" })).toBeTruthy();
  });

  it("draws the portal's course codes as values of their own, not as a sentence", async () => {
    show();
    const row = (await screen.findByText("Ahlem Trabelsi")).closest("tr") as HTMLElement;

    await waitFor(() => expect(within(row).getByText("ECON-101")).toBeTruthy());
  });
});

describe("who is free in a window of time", () => {
  const teacher = (id: string, fullName: string) =>
    ({
      id, portalTeacherId: "", partTimeTeacherId: "", fullName, email: "", source: "portal", addedAt: "", addedBy: "",
      teacherStatus: "", category: "", type: "", lastTerm: "", department: "", rank: "", courses: "", institution: "",
      portalStatus: "in_portal",
    }) as lists.ActiveTeacher;
  const meeting = (meetsOn: string, startsAt: string, endsAt: string) => ({ meetsOn, startsAt, endsAt, room: "5.111" });
  const sweep: Record<string, lists.FacilitySection> = {
    // Ahlem's lecture is on Thursday afternoon; her tutorial, by name only, on Tuesday morning.
    "22001": { crn: "22001", courseCode: "ECON-101", title: "Economics", teacherName: "", state: "published", meetings: [meeting("2026-10-01", "14:00", "16:00")] },
    "22002": { crn: "22002", courseCode: "ECON-101", title: "Economics", teacherName: "", state: "published", meetings: [meeting("2026-10-06", "10:00", "12:00")] },
    // Grace teaches on Thursday morning only.
    "22003": { crn: "22003", courseCode: "MATH-101", title: "Algebra", teacherName: "", state: "published", meetings: [meeting("2026-10-01", "08:30", "10:00")] },
  };

  beforeEach(() => {
    vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([
      teacher("act-1", "Ahlem Trabelsi"),
      teacher("act-2", "Grace Younes"),
      // On the list, and on no section at all.
      teacher("act-3", "Carla Nasr"),
    ]);
    vi.spyOn(database, "fetchCourseCards").mockResolvedValue([
      {
        cohort: { id: "c1", name: "L1-S1", term: "2026-27" },
        scopes: [
          {
            id: "s-cm", code: "CM", name: "Lectures", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
            courses: [
              { id: "c-econ", code: "ECON-101", name: "Economics", component: "CM", request: database.EMPTY_REQUEST },
              { id: "c-math", code: "MATH-101", name: "Algebra", component: "CM", request: database.EMPTY_REQUEST },
            ],
            groups: [
              {
                id: "g-a", label: "A", capacity: 0, note: "", parentGroupId: "", assigned: 20,
                crns: {
                  "c-econ": { ...database.EMPTY_SECTION, crn: "22001", teacherId: "act-1" },
                  "c-math": { ...database.EMPTY_SECTION, crn: "22003", teacherId: "act-2" },
                },
              },
            ],
          },
          {
            id: "s-td", code: "TD", name: "Tutorials", note: "", termId: "term-1", kind: "shared", parentScopeId: "", openToAll: false,
            courses: [{ id: "t-econ", code: "ECON-101", name: "Economics", component: "TD", request: database.EMPTY_REQUEST }],
            groups: [{ id: "g-1", label: "1", capacity: 0, note: "", parentGroupId: "", assigned: 20, crns: { "t-econ": { ...database.EMPTY_SECTION, crn: "22002", teacher: "Ahlem Trabelsi" } } }],
          },
        ],
      },
    ]);
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });
    vi.spyOn(termWeeks, "fetchTermWeeks").mockResolvedValue({ "term-1": { weekOne: "2026-08-31", without: ["2026-10-12"] } });
    vi.spyOn(sessionChanges, "fetchSessionChanges").mockResolvedValue([]);
    vi.spyOn(lists, "fetchFacilitySections").mockImplementation(async (termCode, crns) => ({
      termCode,
      pulledAt: "",
      sections: crns.map((crn) => sweep[crn] ?? { crn, courseCode: "", title: "", teacherName: "", state: "unchecked", meetings: [] }),
    }));
  });

  async function ask({ date, start, end, teaching = false }: { date: string; start: string; end: string; teaching?: boolean }) {
    show();
    await screen.findByText("Grace Younes");
    fireEvent.click(screen.getByRole("button", { name: "Who is free" }));
    fireEvent.change(await screen.findByLabelText("Day"), { target: { value: date } });
    fireEvent.change(screen.getByLabelText("Starts at"), { target: { value: start } });
    fireEvent.change(screen.getByLabelText("Ends at"), { target: { value: end } });
    if (teaching) fireEvent.click(screen.getByLabelText(/Only teachers who have a class that day/));
    fireEvent.click(screen.getByRole("button", { name: "Show who is free" }));
    // The answer is in once the piles are counted.
    await screen.findByRole("group", { name: "Show" });
  }

  const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

  it("narrows the list to who is free, and says how many of how many", async () => {
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });

    expect(screen.getByText("1 free of 3 teachers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Free 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Busy 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unknown 1" })).toBeTruthy();
    // Only asked about when the question asks about it.
    expect(screen.queryByRole("button", { name: /Not teaching that day/ })).toBeNull();
    const grace = rowOf("Grace Younes");
    expect(within(grace).getByText("Free")).toBeTruthy();
    // Her morning class is said: she is in that day.
    expect(within(grace).getByText("That day: MATH-101 · CRN 22003 · 08:30–10:00")).toBeTruthy();
    expect(screen.queryByText("Ahlem Trabelsi")).toBeNull();
    // The button says what is being asked, because the rows underneath do not.
    expect(screen.getByRole("button", { name: "Who is free: Thu 1 Oct · 14:00–16:00" })).toBeTruthy();
  });

  it("says what a busy teacher has in the window", async () => {
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });

    fireEvent.click(screen.getByRole("button", { name: "Busy 1" }));

    const row = rowOf("Ahlem Trabelsi");
    expect(within(row).getByText("Busy")).toBeTruthy();
    expect(within(row).getByText("ECON-101 · CRN 22001 · 14:00–16:00")).toBeTruthy();
    expect(screen.getByText("1 busy of 3 teachers")).toBeTruthy();
  });

  it("never calls somebody free whose classes are not known", async () => {
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });

    fireEvent.click(screen.getByRole("button", { name: "Unknown 1" }));

    const row = rowOf("Carla Nasr");
    expect(within(row).getByText("Unknown")).toBeTruthy();
    expect(within(row).getByText("no CRN matched to them")).toBeTruthy();
  });

  it("does not take an empty timetable for a free afternoon", async () => {
    // Grace's section has never been asked about: her Thursday is a hole, not a gap.
    vi.spyOn(lists, "fetchFacilitySections").mockImplementation(async (termCode, crns) => ({
      termCode,
      pulledAt: "",
      sections: crns.map((crn) => (crn === "22003" ? { ...sweep[crn], state: "unchecked" as const, meetings: [] } : sweep[crn])),
    }));
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });

    expect(screen.getByRole("button", { name: "Free 0" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unknown 2" }));
    expect(within(rowOf("Grace Younes")).getByText("CRN 22003: not swept yet")).toBeTruthy();
  });

  it("counts a cancelled class as no class", async () => {
    vi.spyOn(sessionChanges, "fetchSessionChanges").mockResolvedValue([
      {
        id: "n1", termCode: "262710", crn: "22001", meetsOn: "2026-10-01", startsAt: "14:00", endsAt: "16:00", kind: "cancelled",
        coverTeacherId: "", coverTeacherName: "", note: "", authorEmail: "", authorName: "", createdAt: "", updatedAt: "",
      },
    ]);
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });

    expect(screen.getByText("2 free of 3 teachers")).toBeTruthy();
    expect(within(rowOf("Ahlem Trabelsi")).getByText("ECON-101 cancelled")).toBeTruthy();
  });

  it("with the tick, keeps Free for somebody already teaching that day, and lists the rest apart", async () => {
    // Tuesday afternoon: Ahlem has her tutorial that morning; Grace teaches nothing that day.
    await ask({ date: "2026-10-06", start: "14:00", end: "16:00", teaching: true });

    expect(screen.getByRole("button", { name: "Who is free: Tue 6 Oct · 14:00–16:00 · teaching that day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Free 1" })).toBeTruthy();
    expect(within(rowOf("Ahlem Trabelsi")).getByText("That day: ECON-101 · CRN 22002 · 10:00–12:00")).toBeTruthy();
    expect(screen.queryByText("Grace Younes")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Not teaching that day 1" }));

    expect(within(rowOf("Grace Younes")).getByText("Not teaching that day")).toBeTruthy();
    expect(screen.getByText("1 not teaching that day, of 3 teachers")).toBeTruthy();
    // Unknown stays unknown: whether Carla teaches that day is exactly what nobody can say.
    expect(screen.getByRole("button", { name: "Unknown 1" })).toBeTruthy();
  });

  it("without the tick, calls the same teacher simply free", async () => {
    await ask({ date: "2026-10-06", start: "14:00", end: "16:00" });

    expect(screen.getByText("2 free of 3 teachers")).toBeTruthy();
    expect(within(rowOf("Grace Younes")).getByText("Free")).toBeTruthy();
  });

  it("keeps the tick with the question, across a step away from the page", async () => {
    await ask({ date: "2026-10-06", start: "14:00", end: "16:00", teaching: true });
    cleanup();
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Who is free: Tue 6 Oct · 14:00–16:00 · teaching that day" }));

    expect((await screen.findByLabelText(/Only teachers who have a class that day/) as HTMLInputElement).checked).toBe(true);
  });

  it("says when the day is in a week without classes", async () => {
    await ask({ date: "2026-10-14", start: "10:00", end: "12:00" });

    expect(screen.getByText("The week of 12 Oct has no classes (Settings → Semesters).")).toBeTruthy();
  });

  it("shows everybody again, without the column, when the question is put away", async () => {
    await ask({ date: "2026-10-01", start: "14:00", end: "16:00" });
    expect(screen.getByRole("button", { name: "Sort by Availability" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Stop asking who is free" }));

    expect(await screen.findByText("Ahlem Trabelsi")).toBeTruthy();
    expect(screen.getByText("3 teachers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sort by Availability" })).toBeNull();
  });

  it("asks nothing of the portal's timetable until somebody asks who is free", async () => {
    const sections = vi.spyOn(lists, "fetchFacilitySections");
    show();

    await screen.findByText("Grace Younes");
    expect(sections).not.toHaveBeenCalled();
  });

  it("will not ask a window that ends before it starts", async () => {
    show();
    await screen.findByText("Grace Younes");
    fireEvent.click(screen.getByRole("button", { name: "Who is free" }));
    fireEvent.change(await screen.findByLabelText("Starts at"), { target: { value: "16:00" } });
    fireEvent.change(screen.getByLabelText("Ends at"), { target: { value: "14:00" } });

    expect(screen.getByText("The window has to end after it starts.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Show who is free" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
