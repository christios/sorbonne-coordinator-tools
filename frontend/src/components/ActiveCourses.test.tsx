import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActiveCourses } from "@/components/ActiveCourses";
import * as lists from "@/services/portalLists";

const EMPTY: lists.RegisterCheck = {
  gone: [],
  arrived: [],
  unregistered: [],
  teacherDiffers: [],
  teacherUnnamed: [],
};

const drift = (over: Partial<lists.TeacherDrift>): lists.TeacherDrift => ({
  crn: "23638", courseCode: "PHYS-125", groupLabel: "1",
  ours: "Sara Khaled", theirs: "Diaa Mereib", planning: "named", ...over,
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ActiveCourses />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(lists, "fetchActiveCrns").mockResolvedValue([]);
  vi.spyOn(lists, "fetchActiveCourses").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

/*
 * A plain string compare over the registrar's teacher column reports twenty-six
 * disagreements on the real data, and five of the eleven distinct pairs behind them are
 * nothing but where the space falls in a surname. The rule that knows better is the
 * server's — this page only has to show what it decided, and show BOTH sides so the
 * decision can be made.
 */
describe("who the registrar says teaches a section", () => {
  it("says nothing at all when the two sides agree", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue(EMPTY);

    show();

    expect(await screen.findByText(/Nothing registered yet/)).toBeTruthy();
    expect(screen.queryByText(/staffs differently/)).toBeNull();
  });

  it("counts the sections staffed differently, and shows both names", async () => {
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      teacherDiffers: [drift({}), drift({ crn: "23652", courseCode: "MATH-011", ours: "Wafaa Ahmed", theirs: "Wafa Ahmed" })],
    });

    show();

    expect(await screen.findByText(/2 sections the registrar staffs differently/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Show them/ }));

    // Both sides, because "ours differs from theirs" cannot be acted on without them.
    expect(screen.getByText(/23638 PHYS-125 1 — we say Sara Khaled, the registrar says Diaa Mereib/)).toBeTruthy();
    expect(screen.getByText(/23652 MATH-011 1 — we say Wafaa Ahmed, the registrar says Wafa Ahmed/)).toBeTruthy();
  });

  it("keeps a section the registrar staffs and we have not on its own list", async () => {
    // A line to copy across, not a conversation to have. Counting it with the
    // disagreements would send somebody to argue about a name nobody has written yet.
    vi.spyOn(lists, "fetchRegisterCheck").mockResolvedValue({
      ...EMPTY,
      teacherUnnamed: [drift({ crn: "24071", courseCode: "PHYS-118", ours: "", theirs: "Valerie LE GUYON", planning: "unplanned" })],
    });

    show();

    expect(await screen.findByText(/1 the registrar staffs and we have not/)).toBeTruthy();
    expect(screen.queryByText(/staffs differently/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show them/ }));
    expect(screen.getByText(/24071 PHYS-118 1 — Valerie LE GUYON/)).toBeTruthy();
  });
});
