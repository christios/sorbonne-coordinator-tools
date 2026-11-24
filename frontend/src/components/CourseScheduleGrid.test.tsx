import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { CourseScheduleGrid, type ScheduleDraft } from "@/components/CourseScheduleGrid";
import type { TeachingWeek } from "@/services/coursePlans";

const PLAN = {
  courseCode: "MATH-372",
  components: { CM: { hours: 6, length: 1.5 }, TD: { hours: null, length: null }, TP: { hours: null, length: null } },
};
// Week 2 holds a holiday; the week of 8 Feb is a week off between Weeks 2 and 3.
const WEEKS: TeachingWeek[] = [
  { week: 1, monday: "2027-01-25", holidays: [] },
  { week: 2, monday: "2027-02-01", holidays: [{ date: "2027-02-03", label: "Founders' Day" }] },
  { week: 3, monday: "2027-02-15", holidays: [] },
];

function Grid({ start }: { start: ScheduleDraft }) {
  const [value, setValue] = useState(start);
  return <CourseScheduleGrid plan={PLAN} weeks={WEEKS} value={value} onChange={setValue} />;
}

describe("the week-by-week grid, around holidays and weeks off (24 Nov 2026)", () => {
  it("shows a week off as an empty dashed column, with nothing to fill in", () => {
    render(<Grid start={{ weeks: {}, lengths: {} }} />);
    expect(screen.getByRole("columnheader", { name: /Off\s*8 Feb/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Week of 8 Feb: no classes" })).toBeTruthy();
    expect(screen.getAllByRole("textbox").map((box) => box.getAttribute("aria-label"))).toEqual([
      "CM sessions in week 1",
      "CM sessions in week 2",
      "CM sessions in week 3",
    ]);
  });

  it("says a holiday once a session is put in its week, and no longer once it is taken out", () => {
    render(<Grid start={{ weeks: { CM: { "1": 1 } }, lengths: {} }} />);
    expect(document.querySelector("[data-holidays]")).toBeNull();

    fireEvent.change(screen.getByRole("textbox", { name: "CM sessions in week 2" }), { target: { value: "1" } });
    expect(document.querySelector("[data-holidays]")?.textContent).toBe(
      "Week 2 has a holiday (Wed 3 Feb, Founders' Day): no class that day.",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "CM sessions in week 2" }), { target: { value: "" } });
    expect(document.querySelector("[data-holidays]")).toBeNull();
  });
});
