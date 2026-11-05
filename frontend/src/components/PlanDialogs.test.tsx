import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanClassDialog, ScopeDialog, WeekPicker } from "@/components/PlanDialogs";
import type { Plan } from "@/services/semesterPlans";

describe("the question a change to a repeating class asks", () => {
  const ask = (week: number, onChoose = vi.fn()) =>
    render(
      <ScopeDialog
        open
        verb="change"
        when="Tuesday 19 Jan"
        week={week}
        firstWeek={1}
        count={14}
        movedApart={2}
        busy={false}
        onChoose={onChoose}
        onClose={() => {}}
      />,
    );

  it("offers this and the following only after the series' first week", () => {
    const { unmount } = ask(1);
    expect(screen.queryByRole("radio", { name: /following/ })).toBeNull();
    unmount();
    ask(3);
    expect(screen.getByRole("radio", { name: /following/ })).toBeTruthy();
  });

  it("says that the whole series puts the classes changed on their own back in line", () => {
    ask(3);
    expect(screen.getByRole("radio", { name: /All classes/ }).textContent).toContain("2 changed on their own will follow");
  });

  it("answers this class unless told otherwise", () => {
    const onChoose = vi.fn();
    ask(3, onChoose);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenCalledWith("one");
    fireEvent.click(screen.getByRole("radio", { name: /following/ }));
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChoose).toHaveBeenLastCalledWith("following");
  });
});

describe("the weeks a class meets in", () => {
  it("takes the odd weeks in one press, and a week on or off in another", () => {
    const onChange = vi.fn();
    render(<WeekPicker count={6} value={[1, 2]} onChange={onChange} dateOf={() => "11 Jan"} />);
    fireEvent.click(screen.getByRole("button", { name: "Odd weeks" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 3, 5]);
    fireEvent.click(screen.getByRole("button", { name: "4" }));
    expect(onChange).toHaveBeenLastCalledWith([1, 2, 4]);
  });
});

describe("placing a class", () => {
  it("shows the chosen class's teacher from Groups & CRNs, to be changed there", async () => {
    const plan = {
      termCode: "262720",
      semesterId: "plan:262720",
      name: "S2",
      weekOne: "2027-01-11",
      weeks: 14,
      without: [],
      holidays: [],
      updatedAt: "",
      updatedBy: "",
      series: [],
      classes: [],
      skipped: [],
      sections: [
        {
          id: "s1", crn: "22229", parentCrn: "", courseCode: "MATH-002", title: "Elements of Calculus GA- CM", ue: "",
          component: "CM", programmes: ["FYS"], groupLabel: "GA", teacherName: "Bilal Maaz", hours: 60, hoursSaid: "60CM",
          duration: "1.5", places: [], gone: false, comments: "", position: 0, updatedAt: "", updatedBy: "",
        },
        {
          id: "s2", crn: "22230", parentCrn: "", courseCode: "MATH-002", title: "Elements of Calculus GB- CM", ue: "",
          component: "CM", programmes: ["FYS"], groupLabel: "GB", teacherName: "", hours: 60, hoursSaid: "60CM",
          duration: "", places: [], gone: true, comments: "", position: 1, updatedAt: "", updatedBy: "",
        },
      ],
    } satisfies Plan;
    const onSave = vi.fn();
    render(
      <PlanClassDialog
        open
        plan={plan}
        rooms={[]}
        initial={{ sectionId: "", weekday: 1, startsAt: "08:30", endsAt: "10:00", room: "", teacherName: "", weeks: [1, 2], note: "" }}
        busy={false}
        error=""
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Class" }));
    // A class no longer on Groups & CRNs is not offered.
    expect(screen.queryByText(/GB- CM/)).toBeNull();
    fireEvent.click(await screen.findByText("MATH-002 · Elements of Calculus GA- CM · GA"));
    expect(screen.getByText("Bilal Maaz")).toBeTruthy();
    expect(screen.getByText(/Set on Groups & CRNs/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Bilal Maaz")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Place it" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sectionId: "s1" }));
  });
});
