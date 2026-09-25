import { describe, expect, it, vi } from "vitest";

import { scheduleInputFor, type ScheduleReads } from "@/services/crnScheduleInput";
import type { ActiveCrn } from "@/services/portalLists";
import type { SessionChange } from "@/services/sessionChanges";

const row = (crn: string, courseCode: string, termCode = "262710") =>
  ({ id: `r-${crn}`, crn, courseCode, termCode, courseTitle: `${courseCode} title`, portalTitle: "", teacherName: "From the register" }) as ActiveCrn;

const meeting = { meetsOn: "2026-09-17", startsAt: "08:15", endsAt: "10:15", room: "5.111" };

function reads(over: Partial<ScheduleReads> = {}): ScheduleReads {
  return {
    sections: vi.fn(async (termCode: string, crns: string[]) => ({
      termCode,
      pulledAt: "2026-09-24T07:32:11+00:00",
      sections: crns.map((crn) => ({ crn, courseCode: "", title: "", teacherName: crn === "24059" ? "Amina Menaa" : "", state: "published" as const, meetings: [meeting] })),
    })),
    notes: vi.fn(async () => [{ crn: "24059", meetsOn: "2026-09-17", startsAt: "08:15", kind: "covered", coverTeacherName: "Grace Younes", note: "" } as SessionChange]),
    links: async () => ({ "term-1": "262710" }),
    weeks: async () => ({ "term-1": "2026-08-31" }),
    semesterNames: async () => ({ "term-1": "Semester 1 2026-27" }),
    ...over,
  };
}

describe("what a joint schedule is drawn from", () => {
  it("gathers the ticked CRNs' meetings and notes, in course order, for their semester", async () => {
    const read = reads();

    const input = await scheduleInputFor([row("24059", "MATH-100"), row("23436", "MATH-351"), row("23300", "MATH-009")], read);

    expect(input.sections.map((section) => section.crn)).toEqual(["23300", "24059", "23436"]);
    expect([input.semester, input.weekOne, input.sweptAt]).toEqual(["Semester 1 2026-27", "2026-08-31", "2026-09-24T07:32:11+00:00"]);
    // One read of the portal for the semester, for exactly the ticked CRNs.
    expect(read.sections).toHaveBeenCalledTimes(1);
    const tutorial = input.sections.find((section) => section.crn === "24059")!;
    expect(tutorial.teacher).toBe("Amina Menaa");
    expect(tutorial.notes.map((note) => note.coverTeacherName)).toEqual(["Grace Younes"]);
    // The register's teacher stands in where the portal names nobody.
    expect(input.sections.find((section) => section.crn === "23436")!.teacher).toBe("From the register");
  });

  it("names no semester and numbers no week when the CRNs span two", async () => {
    const input = await scheduleInputFor([row("24059", "MATH-100"), row("33436", "MATH-352", "262720")], reads());

    expect([input.semester, input.weekOne]).toEqual(["", undefined]);
  });

  it("still exports when the semester's name cannot be read", async () => {
    const input = await scheduleInputFor([row("24059", "MATH-100")], reads({ semesterNames: async () => Promise.reject(new Error("Hub down")) }));

    expect(input.semester).toBe("Term 262710");
  });
});
