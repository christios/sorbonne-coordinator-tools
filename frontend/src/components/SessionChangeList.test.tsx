import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionChangeList } from "@/components/SessionChangeList";
import type { SessionChange } from "@/services/sessionChanges";

const covered: SessionChange = {
  id: "ch-1",
  termCode: "262710",
  crn: "24059",
  meetsOn: "2026-09-10",
  startsAt: "08:15",
  endsAt: "10:15",
  kind: "covered",
  coverTeacherId: "t-kucheriya",
  coverTeacherName: "Gaurav Kucheriya",
  note: "",
  authorEmail: "patricia@example.ae",
  authorName: "Patricia Chahwane",
  createdAt: "2026-09-15T08:00:00Z",
  updatedAt: "2026-09-15T08:00:00Z",
};

describe("what a recorded change lets you do about it", () => {
  it("opens the class it is about, so a wrong name is mended where it is read", () => {
    /*
     * The calendar shows one week. A cover put on the wrong class is noticed weeks later,
     * from this list — which knows the date exactly — so the way back cannot be "find that
     * week again".
     */
    const open = vi.fn();
    render(<SessionChangeList changes={[covered]} onOpen={open} empty="nothing" />);

    fireEvent.click(screen.getByRole("button", { name: /Change what was said about/ }));

    expect(open).toHaveBeenCalledWith(covered);
  });

  it("stays a plain record where the caller has no one calendar to open", () => {
    // The teacher's record lists changes across every CRN they touch; there is no single
    // class behind the list, so nothing there pretends to be pressable.
    render(<SessionChangeList changes={[covered]} empty="nothing" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Covered by Gaurav Kucheriya/)).toBeTruthy();
  });

  it("says who said it and when, either way", () => {
    render(<SessionChangeList changes={[covered]} empty="nothing" />);

    expect(screen.getByText(/Patricia Chahwane/)).toBeTruthy();
  });

  it("says nothing happened rather than showing an empty list", () => {
    render(<SessionChangeList changes={[]} empty="Nothing noted." />);

    expect(screen.getByText("Nothing noted.")).toBeTruthy();
  });
});
