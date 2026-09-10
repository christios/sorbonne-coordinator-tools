import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveCourses } from "@/components/ActiveCourses";
import * as lists from "@/services/portalLists";

const EMPTY: lists.RegisterCheck = {
  gone: [],
  arrived: [],
  unregistered: [],
  teacherDiffers: [],
  teacherUnnamed: [],
  collides: [],
  settledCollisions: [],
  swept: true,
};

const drift = (over: Partial<lists.TeacherDrift>): lists.TeacherDrift => ({
  crn: "23638", courseCode: "PHYS-125", groupLabel: "1",
  ours: "Sara Khaled", theirs: "Diaa Mereib", planning: "named", ...over,
});

function show(props: { onShowStudents?: (ids: string[]) => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActiveCourses {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

/*
 * A plain string compare over the registrar's teacher column reports twenty-six
 * disagreements on the real data, and five of the eleven distinct pairs behind them are
 * nothing but where the space falls in a surname. The rule that knows better is the
 * server's — this page only has to show what it decided, and show BOTH sides so the
 * decision can be made.
 */
describe("who the registrar says teaches a section", () => {
  it("says nothing at all when the two sides agree", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue(EMPTY);

    show();

    expect(await screen.findByText(/Nothing registered yet/)).toBeTruthy();
    expect(screen.queryByText(/staffs differently/)).toBeNull();
  });

  it("counts the sections staffed differently, and shows both names", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      teacherDiffers: [drift({}), drift({ crn: "23652", courseCode: "MATH-011", ours: "Wafaa Ahmed", theirs: "Wafa Ahmed" })],
    });

    show();

    expect(await screen.findByText(/2 sections the registrar staffs differently/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show them/ }));

    // Both sides, because "ours differs from theirs" cannot be acted on without them.
    expect(screen.getByText(/23638 PHYS-125 1 — we say Sara Khaled, the registrar says Diaa Mereib/)).toBeTruthy();
    expect(screen.getByText(/23652 MATH-011 1 — we say Wafaa Ahmed, the registrar says Wafa Ahmed/)).toBeTruthy();
  });

  it("keeps a section the registrar staffs and we have not on its own list", async () => {
    // A line to copy across, not a conversation to have. Counting it with the
    // disagreements would send somebody to argue about a name nobody has written yet.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      teacherUnnamed: [drift({ crn: "24071", courseCode: "PHYS-118", ours: "", theirs: "Valerie LE GUYON", planning: "unplanned" })],
    });

    show();

    expect(await screen.findByText(/1 the registrar staffs and we have not/)).toBeTruthy();
    expect(screen.queryByText(/staffs differently/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show them/ }));
    expect(screen.getByText(/24071 PHYS-118 1 — Valerie LE GUYON/)).toBeTruthy();
  });
});

const collision = (over: Partial<lists.SectionCollision> = {}): lists.SectionCollision => ({
  ourCrn: "23302", ourCourse: "SCEN-101", weekday: "Tue", startsAt: "16:30", endsAt: "18:00",
  dates: 14, minutes: 90, theirs: [{ crn: "20581", courseCode: "ENGL-604" }], students: ["A001", "A002"], ...over,
});

/*
 * The third kind of overlap. Two of ours is a student clash and belongs to the cohort's
 * page; neither ours is nobody's business; exactly one is this, and its remedies are about
 * the SECTION — move ours, accept it, or refer it once about the slot.
 */
describe("our sections sharing an hour with another department's", () => {
  it("names both sides, the slot, and how many students are caught", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, collides: [collision()] });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText(/SCEN-101 23302/)).toBeTruthy();
    expect(screen.getByText(/Tue 16:30–18:00, 14 times/)).toBeTruthy();
    expect(screen.getByText(/vs ENGL-604/)).toBeTruthy();
    expect(screen.getByText("2 in both")).toBeTruthy();
  });

  it("offers accepting and referring, which are the remedies that exist", async () => {
    // Moving OUR section is the third and the real one, but it is a timetable request
    // rather than a button — there is nothing here that could carry it out.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, collides: [collision()] });
    const settle = vi.spyOn(lists, "settleCollision").mockResolvedValue(undefined);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(settle).toHaveBeenCalled());
    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ ourCrn: "23302", weekday: "Tue", startsAt: "16:30", disposition: "accepted" }),
    );
  });

  it("keeps a settled one visible with its reason, and can put it back", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      // Settled rows deliberately do NOT demand attention — that is how the page reaches
      // zero — so something else has to be open for them to be reviewed beneath it.
      unregistered: [{ crn: "1", courseCode: "X" }],
      settledCollisions: [{ ...collision(), disposition: "referred", note: "asked the option block owner", settledAt: "", settledBy: "" }],
    });
    const settle = vi.spyOn(lists, "settleCollision").mockResolvedValue(undefined);

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText(/referred — asked the option block owner/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Put it back" }));
    await waitFor(() => expect(settle).toHaveBeenCalledWith(expect.objectContaining({ disposition: "" })));
  });

  it("says nobody has looked, rather than that nothing collides", async () => {
    // An empty list from an empty record is the exact claim this whole record exists to
    // stop being made.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY, swept: false, unregistered: [{ crn: "1", courseCode: "X" }],
    });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText(/no collision can be found in any of it/)).toBeTruthy();
  });
});

describe("a collision list that leads with what is at stake", () => {
  it("says how long the overlap is, not only when it starts and ends", async () => {
    /*
     * Fifteen minutes at the end of a class and ninety in the middle of one were drawn
     * alike, and the reader was left to subtract two clock times to tell them apart.
     */
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, collides: [collision()] });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText("1 h 30")).toBeTruthy();
  });

  it("folds away the ones no student of ours is in, and says how many", async () => {
    /*
     * 26 of the 32 found on the real sweep caught nobody. They are true and worth keeping
     * — somebody may register into one tomorrow — but twenty-six lines nobody will act on
     * is an alarm that cannot be cleared, and this page has met those before.
     */
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      collides: [
        collision({ students: ["A001"] }),
        collision({ ourCrn: "24006", students: [] }),
        collision({ ourCrn: "24008", students: [] }),
      ],
    });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText(/1 in both/)).toBeTruthy();
    expect(screen.queryByText(/nobody in both/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /2 more, that no student of ours is in/ }));

    expect(screen.getAllByText(/nobody in both/)).toHaveLength(2);
  });

  it("says so plainly when every collision it found catches nobody", async () => {
    // Otherwise the band says "3 of our sections share an hour" over an empty list, which
    // reads as a page that has broken rather than as good news.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      collides: [collision({ students: [] }), collision({ ourCrn: "24006", students: [] })],
    });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText(/None of them catches a student of ours/)).toBeTruthy();
  });
});

describe("opening the students a collision catches", () => {
  it("hands their ids to the students table, where the names are", async () => {
    /*
     * "2 in both" is the first thing anybody wants opened, and a bare count could not be.
     * The ids are the server's — it has never held a name — so the row hands them over
     * rather than listing anybody here.
     */
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      collides: [collision({ students: ["A00028377", "A00028382"] })],
    });
    const shown = vi.fn();

    show({ onShowStudents: shown });
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));
    fireEvent.click(screen.getByRole("button", { name: "2 in both" }));

    expect(shown).toHaveBeenCalledWith(["A00028377", "A00028382"]);
  });

  it("still says how many when there is nowhere to send them", async () => {
    // Mounted without the hook — the count is the fact, and it must not vanish with the
    // link that happens to be able to open it.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      collides: [collision({ students: ["A00028377", "A00028382"] })],
    });

    show();
    fireEvent.click(await screen.findByRole("button", { name: /Show them/ }));

    expect(screen.getByText("2 in both")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "2 in both" })).toBeNull();
  });
});
