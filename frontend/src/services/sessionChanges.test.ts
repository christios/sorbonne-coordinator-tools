import { describe, expect, it } from "vitest";

import { adjustmentsFor, describeChange, hoursOf, slotKey, type SessionChange } from "@/services/sessionChanges";
import { sameTeacher } from "@/services/teacherLoad";

const note = (over: Partial<SessionChange>): SessionChange => ({
  id: "n", termCode: "262710", crn: "23436", meetsOn: "2026-09-14", startsAt: "08:15", endsAt: "10:15",
  kind: "cancelled", coverTeacherId: "", coverTeacherName: "", note: "", authorEmail: "", authorName: "",
  createdAt: "", updatedAt: "", ...over,
});

describe("a note on one class", () => {
  it("is keyed to the slot, whatever the seconds the sweep wrote", () => {
    expect(slotKey({ termCode: "262710", crn: "23436", meetsOn: "2026-09-14", startsAt: "08:15:00" })).toBe(
      slotKey(note({})),
    );
  });

  it("is worth the length of the class", () => {
    expect(hoursOf(note({}))).toBe(2);
    expect(hoursOf(note({ endsAt: "" }))).toBe(0);
  });

  it("says what happened in a few words", () => {
    expect(describeChange(note({}))).toBe("Cancelled");
    expect(describeChange(note({ kind: "covered", coverTeacherName: "Sudarshan Shinde" }))).toBe("Covered by Sudarshan Shinde");
  });
});

describe("what the notes do to a teacher's hours", () => {
  const notes = [
    note({ id: "a" }),
    note({ id: "b", meetsOn: "2026-09-21", kind: "covered", coverTeacherName: "Sudarshan Shinde" }),
    note({ id: "c", crn: "99999", startsAt: "13:00", endsAt: "14:30", kind: "covered", coverTeacherName: "YOUNES Grace" }),
    note({ id: "d", crn: "88888", kind: "cancelled" }),
  ];

  it("counts cancelled and covered on the planned teacher's own classes, and cover they gave elsewhere", () => {
    const grace = adjustmentsFor(notes, { id: "", name: "Grace Younes" }, new Set(["23436"]), sameTeacher);
    // Cover for others is matched by name in any order and case.
    expect(grace).toEqual({ cancelled: 2, coveredByOthers: 2, coveredForOthers: 1.5, notes: 3 });
  });

  it("gives the cover to the one who stood in, by our id when the note has one", () => {
    const byId = [note({ id: "e", crn: "77777", kind: "covered", coverTeacherId: "t9", coverTeacherName: "Somebody Else" })];
    expect(adjustmentsFor(byId, { id: "t9", name: "S. Else" }, new Set(), sameTeacher).coveredForOthers).toBe(2);
  });

  it("does not count a teacher covering their own class as cover", () => {
    const own = [note({ id: "f", kind: "covered", coverTeacherName: "Grace Younes" })];
    expect(adjustmentsFor(own, { id: "", name: "Grace Younes" }, new Set(["23436"]), sameTeacher)).toEqual({
      cancelled: 0, coveredByOthers: 0, coveredForOthers: 0, notes: 0,
    });
  });
});
