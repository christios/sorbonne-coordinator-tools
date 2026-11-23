import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("what a box says", () => {
  const at = (crn: string, start: string, end: string): PlacedSession => ({
    crn, date: "2026-09-07", start, end, room: "4.128", clashes: false,
  });

  it("is everything, in the same order, on every week and at every size", () => {
    for (const compact of [false, true]) {
      const { unmount } = render(
        <WeekCalendar
          weekStart={new Date(2026, 8, 7)}
          sessions={[at("23638", "10:30", "11:30")]}
          courses={new Map([["23638", COURSE]])}
          today="2026-09-07"
          compact={compact}
        />,
      );
      const facts = document.querySelector("[data-facts]");
      expect(facts?.textContent).toBe("PHYS-125 · TD 310:30–11:304.128Sara KhaledCRN 23638");
      unmount();
    }
  });
});

describe("a record's week (23 Nov 2026)", () => {
  const small = (sessions: PlacedSession[]) =>
    render(
      <WeekCalendar
        weekStart={new Date(2026, 8, 7)}
        sessions={sessions}
        courses={new Map([["23638", COURSE]])}
        today="2026-09-07"
        compact
      />,
    );
  const phone = (matches: boolean) =>
    vi.stubGlobal("matchMedia", (query: string) => ({ matches, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  afterEach(() => vi.unstubAllGlobals());

  it("shows the whole week on a computer, however narrow its box", () => {
    phone(false);
    small([classAt()]);
    expect(screen.queryByRole("group", { name: "Day of the week" })).toBeNull();
    expect(screen.getByText("Mon")).toBeTruthy();
    expect(screen.getByText("Fri")).toBeTruthy();
  });

  it("shows one day at a time on a phone", () => {
    phone(true);
    small([classAt()]);
    expect(screen.getByRole("group", { name: "Day of the week" })).toBeTruthy();
  });

  it("is always as tall, a short day or a long one, so it never scrolls", () => {
    phone(false);
    const heights = [
      [classAt()],
      [classAt(), { ...classAt(), date: "2026-09-08", start: "08:00", end: "19:30" }],
    ].map((sessions) => {
      const { container, unmount } = small(sessions);
      const column = container.querySelector("div.relative[style*='height']") as HTMLElement;
      const height = column.style.height;
      unmount();
      return height;
    });
    expect(heights).toEqual(["270px", "270px"]);
  });
});
