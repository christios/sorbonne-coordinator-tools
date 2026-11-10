import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PlanWishesPanel } from "@/components/PlanWishesPanel";
import type { Breach, WishCheck } from "@/services/teacherWishes";

const tuesday = (week: number): Breach => ({
  about: "teacher",
  teacherId: "t-valerie",
  teacherName: "Valerie Le Guyon",
  key: "cant:14-18:2",
  level: "must",
  wish: "Can't teach Tue 14:00–18:00",
  comment: "",
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

beforeEach(() => window.localStorage.clear());

describe("the wishes the plan breaks", () => {
  it("says the weeks a wish is broken in as runs, and who has not answered", () => {
    render(<PlanWishesPanel check={CHECK} collection={null} week={2} view="all" onFocus={() => {}} />);
    expect(screen.getByText("Weeks 1–3, 5 · 0 classes")).toBeTruthy();
    expect(screen.getByText("1 teacher hasn't answered yet.")).toBeTruthy();
  });

  it("shows a teacher's week when their line is pressed", () => {
    const onFocus = vi.fn();
    render(<PlanWishesPanel check={CHECK} collection={null} week={2} view="teachers" onFocus={onFocus} />);
    expect(screen.getByText("0 of 1 Musts · 1 of 1 wishes")).toBeTruthy();
    fireEvent.click(screen.getByText("Jad Tarsissi"));
    expect(onFocus).toHaveBeenCalledWith("t-jad");
  });

  it("is searched and filtered as the classes to place are, and shows why a wish matters", () => {
    const jad: Breach = {
      ...tuesday(2),
      teacherId: "t-jad",
      teacherName: "Jad Tarsissi",
      key: "maxInRow",
      level: "would",
      wish: "At most 2 hours in a row",
      comment: "Voice",
      how: "3 h in a row on Wed",
    };
    const check = { ...CHECK, breaches: [...CHECK.breaches, jad] } as WishCheck;
    render(<PlanWishesPanel check={check} collection={null} week={2} view="week" onFocus={() => {}} />);
    const list = () => within(screen.getByRole("list", { name: "Broken wishes" }));
    expect(list().getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("“Voice”")).toBeTruthy();

    // The filters are behind one button; one that would leave nothing is not offered.
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    expect(screen.queryByRole("menuitemcheckbox", { name: /Everybody/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /With a comment/ }));
    expect(list().getAllByRole("listitem")).toHaveLength(1);
    expect(list().getByText(/Jad Tarsissi/)).toBeTruthy();

    // Chosen, it is a pill under the search, let go with its ✕.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Stop filtering: With a comment" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search wishes" }), { target: { value: "phys-118" } });
    expect(list().getAllByRole("listitem")).toHaveLength(1);
    expect(list().getByText(/Valerie Le Guyon/)).toBeTruthy();
  });

  it("keeps Must to hand beside the search", () => {
    render(<PlanWishesPanel check={CHECK} collection={null} week={2} view="week" onFocus={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Must/, pressed: false }));
    expect(screen.getByRole("button", { name: /^Must/, pressed: true })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Broken wishes" })).getAllByRole("listitem")).toHaveLength(1);
  });
});
