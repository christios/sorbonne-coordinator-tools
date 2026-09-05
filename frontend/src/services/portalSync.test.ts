import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as lists from "@/services/portalLists";
import { syncTarget } from "@/services/portalSync";
import * as rosters from "@/services/scenRosters";

const REGISTRATIONS = { kind: "registrations" as const, id: "f1", name: "SCEN", filter: { DEPT_CODE: ["SCEN"] } };

beforeEach(() => {
  vi.spyOn(lists, "syncRegistrations").mockResolvedValue({ seen: 1, added: 1, missing: 0, syncedAt: "now", rows: 2 });
});
afterEach(() => vi.restoreAllMocks());

describe("one sync, wherever it was asked for", () => {
  it("asks the extension for that grid and sends ids and CRNs only", async () => {
    const pull = vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      kind: "registrations", term: { code: "262710", label: "S1" }, presetId: "", name: "SCEN", count: 2,
      expect: null, warning: null, fetchedAt: 1,
      rows: [
        { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", COURSE_CRN: "22151", COURSE_CODE: "MATH-001" },
        { SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad", COURSE_CRN: "23652", COURSE_CODE: "MATH-011" },
      ],
    });

    const outcome = await syncTarget(REGISTRATIONS);

    expect(pull.mock.calls[0][1]).toMatchObject({ kind: "registrations", name: "SCEN" });
    // The names came back to this browser; what left it is a student id against a CRN.
    expect(lists.syncRegistrations).toHaveBeenCalledWith("f1", "262710", [
      { studentId: "A001", crn: "22151", courseCode: "MATH-001" },
      { studentId: "A001", crn: "23652", courseCode: "MATH-011" },
    ]);
    expect(outcome.report.seen).toBe(1);
  });

  it("refuses a pull an older extension answered with students", async () => {
    vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      kind: "students", presetId: "", name: "SCEN", count: 1, expect: null, warning: null, fetchedAt: 1,
      rows: [{ SPRIDEN_ID: "A001", FULL_NAME: "Amira Haddad" }],
    });

    await expect(syncTarget(REGISTRATIONS)).rejects.toThrow(/older than this page/);
    expect(lists.syncRegistrations).not.toHaveBeenCalled();
  });

  it("will not file registrations the portal did not name a term for", async () => {
    vi.spyOn(rosters, "pullFilter").mockResolvedValue({
      kind: "registrations", term: null, presetId: "", name: "SCEN", count: 1, expect: null, warning: null,
      fetchedAt: 1, rows: [{ SPRIDEN_ID: "A001", COURSE_CRN: "22151", COURSE_CODE: "MATH-001" }],
    });

    await expect(syncTarget(REGISTRATIONS)).rejects.toThrow(/did not say which term/);
  });

  it("carries the extension's own refusal up as it is", async () => {
    vi.spyOn(rosters, "pullFilter").mockRejectedValue(new rosters.PortalError("auth"));

    await expect(syncTarget(REGISTRATIONS)).rejects.toThrow(/portal session has expired/);
  });
});
