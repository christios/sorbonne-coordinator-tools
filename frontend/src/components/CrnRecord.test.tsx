import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CrnRecord } from "@/components/CrnRecord";
import * as copying from "@/services/copyCells";
import * as lists from "@/services/portalLists";
import * as roster from "@/services/rosterStore";
import * as changes from "@/services/sessionChanges";
import * as database from "@/services/studentDatabase";

const ROW = {
  id: "crn-1", termCode: "262710", crn: "23638", courseCode: "PHYS-125", parentCrn: "",
  courseTitle: "Mechanics", ue: "", mutualized: "unknown", portalTitle: "Mechanics Physics 1 G.3-TD",
  teacherName: "Sara Khaled", registered: 3, portalStatus: "in_portal", sequence: "", partOfTerm: "",
  credits: "", contactHours: "", parentTitle: "",
} as unknown as lists.ActiveCrn;

const IN_IT: lists.CrnStudent[] = [
  { studentId: "A001", cohortId: "c1", cohortName: "L1-S1", group: "TD 3" },
  { studentId: "A002", cohortId: "c1", cohortName: "L1-S1", group: "TD 3" },
  { studentId: "A003", cohortId: "c1", cohortName: "L1-S1", group: "TD 3" },
];

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CrnRecord open row={ROW} siblings={[]} onClose={() => {}} onSaved={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveTeachers").mockResolvedValue([]);
  vi.spyOn(lists, "fetchCrnStudents").mockResolvedValue(IN_IT);
  vi.spyOn(lists, "fetchFacilitySections").mockResolvedValue({ termCode: "262710", sections: [], pulledAt: "" });
  vi.spyOn(changes, "fetchSessionChanges").mockResolvedValue([]);
  vi.spyOn(database, "fetchCourseCards").mockResolvedValue([]);
  vi.spyOn(roster, "namesHeld").mockResolvedValue({ A001: "One Student", A002: "Two Student", A003: "Three Student" });
});

describe("the e-mails of a section", () => {
  it("copies them, separated the way a mail client reads them", async () => {
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({
      A001: "one@sorbonne.ae",
      A002: "two@sorbonne.ae",
      A003: "three@sorbonne.ae",
    });
    const copied = vi.spyOn(copying, "copyToClipboard").mockResolvedValue(true);
    open();

    fireEvent.click(await screen.findByRole("button", { name: /Copy the 3 e-mail addresses/ }));

    await waitFor(() =>
      expect(copied).toHaveBeenCalledWith("one@sorbonne.ae; two@sorbonne.ae; three@sorbonne.ae"),
    );
  });

  it("says who a copy would leave out rather than leaving them out quietly", async () => {
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({ A001: "one@sorbonne.ae" });
    open();

    expect(await screen.findByText(/2 of 3 have no e-mail in this browser/)).toBeTruthy();
  });

  it("offers no copy at all when this browser holds no addresses", async () => {
    vi.spyOn(roster, "fieldHeld").mockResolvedValue({});
    open();

    expect(await screen.findByText(/holds no e-mail for anybody in this section/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Copy the/ })).toBeNull();
  });
});
