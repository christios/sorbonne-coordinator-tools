import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WeekCalendar } from "@/components/WeekCalendar";
import type { CalendarCourse, PlacedSession, SessionNote } from "@/services/weekSchedule";

const COURSE: CalendarCourse = {
  crn: "23638",
  code: "PHYS-125",
  title: "Mechanics",
  label: "PHYS-125",
  group: "TD 3",
  staff: "Sara Khaled",
  tone: "solid",
  color: "#1f4e79",
  openable: false,
};

function classAt(change?: SessionNote): PlacedSession {
  return { crn: "23638", date: "2026-09-07", start: "10:30", end: "12:30", room: "4.128", clashes: false, change };
}

function week(session: PlacedSession) {
  return render(
    <WeekCalendar
      weekStart={new Date(2026, 8, 7)}
      sessions={[session]}
      courses={new Map([["23638", COURSE]])}
      today="2026-09-07"
    />,
  );
}

/** The box itself, which is what carries the paint. */
function box(): HTMLElement {
  const found = document.querySelector("[title*='CRN 23638']");
  if (!(found instanceof HTMLElement)) throw new Error("no class box drawn");
  return found;
}

describe("a class somebody stood in for", () => {
  it("is painted differently from the classes around it, not merely labelled", () => {
    week(classAt({ kind: "covered", coverTeacherName: "Dr Kaur", note: "" }));

    expect(box().style.backgroundImage).toContain("repeating-linear-gradient");
  });

  it("says which side of the cover this week is", () => {
    week(classAt({ kind: "covered", coverTeacherName: "Dr Kaur", note: "" }));
    expect(screen.getByText("Covered")).toBeTruthy();

    week(classAt({ kind: "covered", coverTeacherName: "Dr Maaz", note: "", standingIn: true }));
    expect(screen.getByText("Standing in")).toBeTruthy();
  });

  it("keeps the course's own colour, so the class is still the class", () => {
    week(classAt({ kind: "covered", coverTeacherName: "Dr Kaur", note: "" }));

    expect(box().style.backgroundColor).toBe("rgb(31, 78, 121)");
  });
});

describe("an ordinary class", () => {
  it("carries no stripes and no badge", () => {
    week(classAt());

    expect(box().style.backgroundImage).toBe("");
    expect(screen.queryByText("Covered")).toBeNull();
  });
});

describe("a cancelled class", () => {
  it("keeps saying cancelled rather than being drawn as a cover", () => {
    week(classAt({ kind: "cancelled", coverTeacherName: "", note: "" }));

    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(box().style.backgroundImage).toBe("");
  });
});
