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

  it("marks the CRN's own row, with both names in reach", async () => {
    /*
     * These were counted lines in a band — "2 sections the registrar staffs differently" —
     * which said how many and left the reader to open a list and match CRNs by eye against
     * the rows below. A fact about a row belongs on the row.
     *
     * Both sides are still there, on the pill's title: "ours differs from theirs" cannot be
     * acted on without seeing which is which, and half of them are two spellings of one
     * person where the whole job is to pick one.
     */
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([crnRow({ crn: "23638", courseCode: "PHYS-125" })]);
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, teacherDiffers: [drift({})] });

    show();

    const pill = await screen.findByTitle(/We say Sara Khaled, the registrar says Diaa Mereib/);
    expect(pill.textContent).toBe("Staffed differently");
    expect(pill.closest("tr")?.textContent).toContain("23638");
  });

  it("keeps a section the registrar staffs and we have not apart from a disagreement", async () => {
    // A line to copy across, not a conversation to have. Counting it with the
    // disagreements would send somebody to argue about a name nobody has written yet.
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([crnRow({ crn: "24071", courseCode: "PHYS-118" })]);
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      teacherUnnamed: [drift({ crn: "24071", courseCode: "PHYS-118", ours: "", theirs: "Valerie LE GUYON", planning: "unplanned" })],
    });

    show();

    expect(await screen.findByText("Staffed only by the registrar")).toBeTruthy();
    expect(screen.queryByText("Staffed differently")).toBeNull();
  });
});

/** One row of the register, for the pills to land on. */
const crnRow = (over: Partial<lists.ActiveCrn> = {}): lists.ActiveCrn =>
  ({
    id: over.crn ?? "1", termCode: "262710", crn: "23638", courseCode: "PHYS-125", parentCrn: "",
    courseTitle: "", ue: "", mutualized: "", portalTitle: "", teacherName: "", registered: 0,
    usedBy: 0, portalStatus: "in_portal", sequence: "", partOfTerm: "", credits: "",
    contactHours: "", addedAt: "", addedBy: "", childCount: 0, parentStatus: "in_portal",
    parentTitle: "",
    ...over,
  }) as unknown as lists.ActiveCrn;

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

    expect(screen.getByText("2 in both")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "2 in both" })).toBeNull();
  });
});

describe("what has a row, and what has none", () => {
  it("keeps the band for the one difference the table cannot hold", async () => {
    /*
     * Five of the six checks are about a CRN the department holds and are pills on it. The
     * sixth is about a CRN we have NOT taken in, so by definition there is no row for it —
     * which is also why the button that takes it in lives up there.
     */
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      arrived: [{ id: "9", termCode: "262710", crn: "99999", courseCode: "PHYS-303", title: "Quantum", teacherName: "" }],
      gone: [{ id: "1", termCode: "262710", crn: "23638", courseCode: "PHYS-125", usedBy: 0 }],
    } as never);
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([crnRow({ crn: "23638", courseCode: "PHYS-125" })]);

    show();

    expect(await screen.findByText(/1 CRN the portal lists for our courses, not registered/)).toBeTruthy();
    // And the one that HAS a row is not counted up there any more.
    expect(screen.queryByText(/we hold, gone from the portal/)).toBeNull();
    expect(await screen.findByText("Gone from the portal")).toBeTruthy();
  });

  it("reaches the collisions even when nothing has arrived from the portal", async () => {
    // They used to live inside that band, so a department with nothing newly listed had no
    // way to reach a settle button at all.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, collides: [collision()] });

    show();
    fireEvent.click(await screen.findByRole("button", { name: "Show" }));

    expect(screen.getByText(/1 h 30/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
  });
});
