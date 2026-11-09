import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTimetableTerms } from "@/services/timetables";

const PLAN = { termCode: "262720", semesterId: "plan:262720", name: "Semester 2 2026-27", weekOne: "", weeks: 0, sections: 120, series: 0 };
const HUB = { id: "edd66bb4", name: "Semester 1 2026-27", slug: "s1", timezone: "Asia/Dubai", isPublished: false };

function answering(hub: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).includes("/timetables/terms") ? hub : new Response(JSON.stringify({ plans: [PLAN] }), { status: 200 }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("the semesters of the app", () => {
  it("are the Student Hub's, then every semester plan", async () => {
    answering(new Response(JSON.stringify({ terms: [HUB] }), { status: 200 }));
    const terms = await fetchTimetableTerms();
    expect(terms.map((term) => [term.id, term.name, term.plannedFor])).toEqual([
      ["edd66bb4", "Semester 1 2026-27", undefined],
      ["plan:262720", "Semester 2 2026-27", "262720"],
    ]);
  });

  it("still include the plans when the Student Hub does not answer", async () => {
    answering(new Response(JSON.stringify({ detail: "The Student Hub is not configured." }), { status: 503 }));
    const terms = await fetchTimetableTerms();
    expect(terms.map((term) => term.id)).toEqual(["plan:262720"]);
  });
});

describe("a Student Hub semester with no portal term", () => {
  it("is left out, as one moved into Coordinator Tools leaves its old self behind", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/timetables/terms")) return new Response(JSON.stringify({ terms: [HUB] }), { status: 200 });
      if (url.includes("/term-links")) return new Response(JSON.stringify({ links: { "plan:262720": "262720" } }), { status: 200 });
      return new Response(JSON.stringify({ plans: [PLAN] }), { status: 200 });
    });
    const terms = await fetchTimetableTerms();
    expect(terms.map((term) => term.id)).toEqual(["plan:262720"]);
  });
});

describe("the order of the semesters", () => {
  it("is the portal's, whichever kind each one is", async () => {
    const LATER = { ...PLAN, termCode: "262730", semesterId: "plan:262730", name: "Summer 2026-27" };
    const EARLIER = { ...PLAN, termCode: "262710", semesterId: "plan:262710", name: "Semester 1 2026-27" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/timetables/terms")) return new Response(JSON.stringify({ terms: [] }), { status: 200 });
      if (url.includes("/term-links")) return new Response(JSON.stringify({ links: {} }), { status: 200 });
      return new Response(JSON.stringify({ plans: [LATER, PLAN, EARLIER] }), { status: 200 });
    });
    const terms = await fetchTimetableTerms();
    expect(terms.map((term) => term.plannedFor)).toEqual(["262710", "262720", "262730"]);
  });
});
