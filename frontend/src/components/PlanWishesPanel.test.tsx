import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlanWishesPanel } from "@/components/PlanWishesPanel";
import type { Breach, WishCheck } from "@/services/teacherWishes";

const tuesday = (week: number): Breach => ({
  about: "teacher",
  teacherId: "t-valerie",
  teacherName: "Valerie Le Guyon",
  key: "cant:14-18:2",
  level: "must",
  wish: "Can't teach Tue 14:00–18:00",
  how: "PHYS-118 CM 1, Tue 15:00",
  week,
  classes: [],
});

const CHECK = {
  breaches: [1, 2, 3, 5].map(tuesday),
  flags: new Map(),
  tallies: [
    { teacherId: "t-valerie", teacherName: "Valerie Le Guyon", status: "submitted", musts: 1, mustsKept: 0, woulds: 1, wouldsKept: 1 },
    { teacherId: "t-jad", teacherName: "Jad Tarsissi", status: "draft", musts: 0, mustsKept: 0, woulds: 1, wouldsKept: 1 },
  ],
  unanswered: ["Bilal Maaz"],
} as unknown as WishCheck;

describe("the wishes the plan breaks", () => {
  it("says the weeks a wish is broken in as runs, and who has not answered", () => {
    render(<PlanWishesPanel check={CHECK} collection={null} week={2} view="all" onView={() => {}} onFocus={() => {}} />);
    expect(screen.getByText("Weeks 1–3, 5 · 0 classes")).toBeTruthy();
    expect(screen.getByText("1 teacher hasn't answered yet.")).toBeTruthy();
  });

  it("shows a teacher's week when their line is pressed", () => {
    const onFocus = vi.fn();
    render(<PlanWishesPanel check={CHECK} collection={null} week={2} view="teachers" onView={() => {}} onFocus={onFocus} />);
    expect(screen.getByText("0 of 1 Musts · 1 of 1 wishes")).toBeTruthy();
    fireEvent.click(screen.getByText("Jad Tarsissi"));
    expect(onFocus).toHaveBeenCalledWith("t-jad");
  });
});
