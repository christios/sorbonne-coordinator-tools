import { afterEach, describe, expect, it, vi } from "vitest";

import { describeSweep, sweepFacilityTimetable } from "@/services/facilitySync";
import * as lists from "@/services/portalLists";
import * as rosters from "@/services/scenRosters";

const REPORT = { asked: 3, answered: 2, silent: 1, failed: 0, complete: true };

const pull = (over: Partial<rosters.TimetablePull> = {}): rosters.TimetablePull => ({
  termCode: "262710",
  asked: ["22151", "23652", "24001"],
  sections: [],
  silent: ["24001"],
  failed: [],
  complete: true,
  malformed: 0,
  warning: null,
  fetchedAt: 0,
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("one sweep of the registrar's timetable", () => {
  it("asks about our sections and the ones our students take elsewhere", async () => {
    // The collisions nobody has ever been able to see are between our teaching and the
    // language hour or the option taken in another department. Ours alone cannot find one.
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151", "23652"], registered: ["24001"] });
    const asked = vi.spyOn(rosters, "pullTimetable").mockResolvedValue(pull());
    vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    const sweep = await sweepFacilityTimetable("262710");

    expect(asked).toHaveBeenCalledWith("262710", ["22151", "23652", "24001"], undefined);
    expect(sweep.theirs).toBe(1);
  });

  it("can be told to keep to our own", async () => {
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151"], registered: ["24001"] });
    const asked = vi.spyOn(rosters, "pullTimetable").mockResolvedValue(pull());
    vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    await sweepFacilityTimetable("262710", { theirsToo: false });

    expect(asked).toHaveBeenCalledWith("262710", ["22151"], undefined);
  });

  it("writes down exactly what the extension said it asked, not what we sent", async () => {
    /*
     * The store refuses a sweep that cannot account for its own list. Sending our list
     * alongside the extension's answers would be two lists that are meant to be one — and
     * the day they differ, the refusal is the only thing that would notice.
     */
    // The sweep stopped after one of the two, so it asked about one. Writing down the
    // list we SENT would claim it asked about both — and the second, never asked about,
    // would be accounted for as neither answered nor silent nor failed. The store refuses
    // exactly that, and the refusal is the only thing that would ever notice.
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151", "23652"], registered: [] });
    vi.spyOn(rosters, "pullTimetable").mockResolvedValue(
      pull({ asked: ["22151"], silent: ["22151"], complete: false }),
    );
    const wrote = vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    await sweepFacilityTimetable("262710");

    expect(wrote).toHaveBeenCalledWith(
      expect.objectContaining({ asked: ["22151"], silent: ["22151"], complete: false }),
    );
  });

  it("writes nothing at all when there is nothing to ask about", async () => {
    // A complete sweep that asked about nothing still counts as a pull, and a pull that
    // asked about nothing would say every section in the term went silent.
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: [], registered: [] });
    const asked = vi.spyOn(rosters, "pullTimetable");
    const wrote = vi.spyOn(lists, "recordFacilityPull");

    const sweep = await sweepFacilityTimetable("262710");

    expect(asked).not.toHaveBeenCalled();
    expect(wrote).not.toHaveBeenCalled();
    expect(sweep.complete).toBe(false);
    expect(describeSweep(sweep)).toMatch(/nothing to ask the registrar about/);
  });

  it("asks about a section once however many lists name it", async () => {
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151"], registered: ["22151", "24001"] });
    const asked = vi.spyOn(rosters, "pullTimetable").mockResolvedValue(pull());
    vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    await sweepFacilityTimetable("262710");

    expect(asked).toHaveBeenCalledWith("262710", ["22151", "24001"], undefined);
  });
});

describe("what a finished sweep is worth saying", () => {
  it("calls silence what it is, rather than a failure", () => {
    const said = describeSweep({ ...REPORT, malformed: 0, warning: null, theirs: 0 });

    expect(said).toContain("2 of 3 sections timetabled");
    expect(said).toContain("1 with nothing booked");
    expect(said).not.toContain("would not answer");
  });

  it("says when the sweep did not finish, because nothing may be retired by it", () => {
    const said = describeSweep({ ...REPORT, complete: false, malformed: 0, warning: null, theirs: 0 });

    expect(said).toContain("did not finish");
  });

  it("says how many times could not be read, because a lost one is invisible later", () => {
    const said = describeSweep({ ...REPORT, malformed: 4, warning: "malformed_times", theirs: 0 });

    expect(said).toContain("4 rows whose times could not be read");
  });
});

describe("saying which of the answers are ours", () => {
  const section = (crn: string, room = "5.111") => ({
    crn, courseCode: "MATH-001", title: "", teacherName: "",

    meetings: [{ meetsOn: "2026-09-01", startsAt: "08:30", endsAt: "10:00", room }],
  });

  it("marks our own sections and not the other departments'", async () => {
    /*
     * The extension has no idea which CRNs the department teaches, and teaching it would
     * put a second copy of that boundary somewhere nobody reviews. The page asked for both
     * lists, so the page says which is which on the way back — and it is not decoration:
     * the store keeps a head count only for a section that is ours, because another
     * department's enrolment is a fact about them.
     */
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151"], registered: ["24001"] });
    vi.spyOn(rosters, "pullTimetable").mockResolvedValue(
      pull({ asked: ["22151", "24001"], sections: [section("22151"), section("24001")] as never }),
    );
    const wrote = vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    await sweepFacilityTimetable("262710");

    const sent = wrote.mock.calls[0][0].sections as { crn: string; ours: boolean; rooms: string[] }[];
    expect(sent.map((s) => [s.crn, s.ours])).toEqual([["22151", true], ["24001", false]]);
  });

  it("gathers each section's rooms from the meetings that name them", async () => {
    vi.spyOn(lists, "fetchTimetableTargets").mockResolvedValue({ ours: ["22151"], registered: [] });
    vi.spyOn(rosters, "pullTimetable").mockResolvedValue(
      pull({
        asked: ["22151"],
        sections: [{ ...section("22151"), meetings: [
          { meetsOn: "2026-09-01", startsAt: "08:30", endsAt: "10:00", room: "5.111" },
          { meetsOn: "2026-09-08", startsAt: "08:30", endsAt: "10:00", room: "5.112" },
          { meetsOn: "2026-09-15", startsAt: "08:30", endsAt: "10:00", room: "" },
        ] }] as never,
      }),
    );
    const wrote = vi.spyOn(lists, "recordFacilityPull").mockResolvedValue(REPORT);

    await sweepFacilityTimetable("262710");

    const [sent] = wrote.mock.calls[0][0].sections as { rooms: string[] }[];
    // Each once, and a meeting with no room booked contributes nothing rather than "".
    expect(sent.rooms).toEqual(["5.111", "5.112"]);
  });
});
