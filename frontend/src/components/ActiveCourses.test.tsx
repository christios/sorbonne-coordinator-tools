import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveCourses, CrnDialog } from "@/components/ActiveCourses";
import * as lists from "@/services/portalLists";
import * as dismissals from "@/services/warningDismissals";

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
  // Nothing swept, so the changed-classes banner is silent unless a test asks for it.
  vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue([]);
  vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([]);
  vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([]);
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

  it("says nothing about an hour shared with another department", async () => {
    // It is not a fact about the CRN that this page can act on: what makes an overlap
    // matter is a student sitting in both, which the cohort's page asks and floors.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, collides: [collision()] });

    show();

    // Waited on, so the register's answer has certainly arrived before it is judged.
    expect(await screen.findByText(/CRNs registered/)).toBeTruthy();
    expect(screen.queryByText(/Sharing an hour/)).toBeNull();
    expect(screen.queryByText("Shares an hour")).toBeNull();
  });
});

describe("a CRN gets a record of its own", () => {
  it("opens on the whole CRN when the row is pressed, not on one field of it", async () => {
    /*
     * The row used to open a form about which CRN this one hangs from. That is a real
     * question and it is not the question a row raises: "what is 23638" was answered by
     * reading across eleven columns and then going to two other pages for the rest.
     */
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([crnRow({ crn: "23638", courseCode: "PHYS-125" })]);
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({ ...EMPTY, teacherDiffers: [drift({})] });

    show();
    fireEvent.click(await screen.findByText("23638"));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("CRN 23638")).toBeTruthy();
    // The verdicts in full, since the pill on the row had room for the kind alone.
    expect(await within(dialog).findByText(/We say Sara Khaled/)).toBeTruthy();
    // And the one thing about a CRN that is ours to change is still here.
    expect(within(dialog).getByText("What it hangs from")).toBeTruthy();
  });

  it("says plainly when nobody has asked the registrar about it", async () => {
    // "No days" and "nobody asked" are the same empty answer and very different facts.
    vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([crnRow({ crn: "23638" })]);
    vi.spyOn(lists, "fetchSectionDays").mockResolvedValue({ days: {}, blind: ["23638"] } as never);

    show();
    fireEvent.click(await screen.findByText("23638"));

    expect(await screen.findByText(/Nobody has asked the registrar about this CRN/)).toBeTruthy();
  });
});

/** The course behind a CRN, as the register joins it on. */
const courseRow = (over: Partial<lists.ActiveCourse> = {}): lists.ActiveCourse =>
  ({
    id: "a1", courseCode: "PHYS-125", title: "Mechanics", ue: "UL1MEPY1", mutualized: "yes",
    addedAt: "", addedBy: "", crnCount: 3, portalCrnCount: 3, termCount: 1, lastTerm: "262710",
    portalParentCrn: "22135", ...over,
  }) as unknown as lists.ActiveCourse;

describe("what a CRN is allowed to change about itself", () => {
  const openDialog = (row: lists.ActiveCrn) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CrnDialog row={row} course={courseRow()} siblings={[row]} onClose={() => {}} onSaved={() => {}} />
      </QueryClientProvider>,
    );
  };

  it("shows the course's UE and says where it is changed, rather than offering to change it here", async () => {
    // Every CRN of PHYS-125 has the same UE. A field on this CRN would say the next one
    // could differ, which is not a thing that can happen.
    openDialog(crnRow({ crn: "23419", ue: "UL1MEPY1", mutualized: "yes" }));

    expect(await screen.findByText("UL1MEPY1")).toBeTruthy();
    expect(screen.getByText(/Change it on the course/)).toBeTruthy();
    expect(screen.queryByLabelText(/^UE of/)).toBeNull();
  });

  it("writes only the parent, which is the CRN's own fact", async () => {
    const course = vi.spyOn(lists, "updateActiveCourse");
    const parent = vi.spyOn(lists, "setParentCrn").mockResolvedValue(undefined as never);
    openDialog(crnRow({ crn: "23419", parentCrn: "" }));

    fireEvent.click(await screen.findByRole("button", { name: /Use 22135/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(parent).toHaveBeenCalledWith("23419", "22135"));
    expect(course).not.toHaveBeenCalled();
  });
});

/*
 * The same warning as on Active teachers. A coordinator notices a deleted class on
 * whichever page they happen to be on, and the answer has to count on both — an approval
 * that only settled the page it was given on is a warning that comes back from the dead.
 */
describe("classes the registrar has changed", () => {
  const GONE: lists.ChangedClasses = {
    crn: "23638",
    courseCode: "PHYS-125",
    title: "Mechanics",
    teacherName: "Sara Khaled",
    scheduleState: "published",
    removed: [{ meetsOn: "2026-09-14", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
    added: [],
    kept: [{ meetsOn: "2026-09-07", startsAt: "10:30", endsAt: "12:30", room: "4.128" }],
    noticedAt: "2026-09-22T10:41:18+00:00",
    key: "registrar-classes-changed:262710:23638:abc123",
  };

  it("warns here too, and approving it here is the same approval", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue(EMPTY);
    vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([GONE]);
    const approve = vi.spyOn(dismissals, "setDismissal").mockResolvedValue(undefined as never);

    show();

    expect(await screen.findByText(/has changed the classes in/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show what changed/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Approve/ }));

    // The key names the missing classes, not the page it was answered on.
    await waitFor(() => expect(approve).toHaveBeenCalledWith(GONE.key, true));
  });

  it("stays quiet once somebody has approved it, wherever they did that", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue(EMPTY);
    vi.spyOn(lists, "fetchSweptTerms").mockResolvedValue(["262710"]);
    vi.spyOn(lists, "fetchChangedClasses").mockResolvedValue([GONE]);
    vi.spyOn(dismissals, "fetchDismissals").mockResolvedValue([
      { key: GONE.key, byEmail: "christiank@aralects.com", byName: "Christian", at: "2026-09-22T11:00:00+00:00" },
    ]);

    show();

    expect(await screen.findByText(/Nothing registered yet/)).toBeTruthy();
    expect(screen.queryByText(/has changed the classes in/)).toBeNull();
  });
});
