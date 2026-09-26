import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PAGE_STATE_TTL, readPageState, usePageState, writePageState } from "@/components/usePageState";

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

function Search({ name = "list" }: { name?: string }) {
  const [query, setQuery] = usePageState(`test:${name}`, "");
  return <input aria-label="Search" value={query} onChange={(event) => setQuery(event.target.value)} />;
}

describe("a page's state, kept for ten minutes", () => {
  it("comes back to what it was when you return within ten minutes", () => {
    const first = render(<Search />);
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "MATH" } });
    first.unmount();

    render(<Search />);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("MATH");
  });

  it("starts fresh once ten minutes have gone by since it was last used", () => {
    const now = Date.now();
    writePageState("test:list", "MATH", now - PAGE_STATE_TTL - 1);

    expect(readPageState("test:list", now)).toBeUndefined();
    render(<Search />);
    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });

  it("counts the ten minutes from leaving the page, not from the last change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    writePageState("test:list", "MATH");
    const page = render(<Search />);

    // Nine minutes on the page, then away.
    vi.setSystemTime(new Date("2026-09-26T10:09:00Z"));
    page.unmount();
    // Eight minutes away: seventeen since the change, eight since the last use.
    vi.setSystemTime(new Date("2026-09-26T10:17:00Z"));

    expect(readPageState("test:list")).toBe("MATH");
  });

  it("keeps each list's own state apart", () => {
    writePageState("test:courses", "PHYS");
    render(<Search name="teachers" />);

    expect((screen.getByLabelText("Search") as HTMLInputElement).value).toBe("");
  });
});
