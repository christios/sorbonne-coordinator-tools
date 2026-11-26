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

describe("the enlarged week in a record's dialog (26 Nov 2026)", () => {
  // Four groups of one course at the same hour, as SCEN-102's Monday afternoon.
  const groups = ["1", "2", "3", "4"].map((n) => ({ ...COURSE, crn: `2400${n}`, label: `RDNS ${n}`, group: `RDNS ${n}` }));
  const sessions: PlacedSession[] = groups.map((group) => ({
    crn: group.crn, date: "2026-09-07", start: "13:15", end: "14:45", room: "4.135", clashes: false,
  }));
  const inDialog = (fitDialog: boolean) =>
    render(
      <section role="dialog" style={{ maxHeight: "300px" }}>
        <div className="overflow-y-auto">
          <WeekCalendar
            weekStart={new Date(2026, 8, 7)}
            sessions={sessions}
            courses={new Map(groups.map((group) => [group.crn, group]))}
            today="2026-09-07"
            fitDialog={fitDialog}
          />
        </div>
      </section>,
    );
  const grid = () => document.querySelector<HTMLElement>("[style*='grid-template-columns']")!;

  it("keeps its days inside the dialog's width, and its boxes to the lines that fit in its height", () => {
    inDialog(true);
    expect(grid().style.minWidth).toBe("");
    const facts = [...document.querySelectorAll<HTMLElement>("[data-facts]")];
    expect(facts).toHaveLength(4);
    // Squeezed: each box says the whole lines it has room for; its hover says everything.
    expect(facts.every((each) => each.style.maxHeight !== "" && each.style.overflow === "hidden")).toBe(true);
    expect(document.querySelector("[title*='CRN 24001']")?.getAttribute("title")).toMatch(/13:15–14:45 · 4\.135/);
  });

  it("is as wide as its groups side by side need anywhere else", () => {
    inDialog(false);
    expect(grid().style.minWidth).not.toBe("");
    expect([...document.querySelectorAll<HTMLElement>("[data-facts]")].every((each) => each.style.maxHeight === "")).toBe(true);
  });
});
