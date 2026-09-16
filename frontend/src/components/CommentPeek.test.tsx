import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentPeek } from "@/components/CommentPeek";
import * as comments from "@/services/studentComments";

const THREAD: comments.StudentComment[] = [
  {
    id: "c1",
    studentId: "A001",
    body: "Spoke to admissions; the transfer credit is agreed.",
    authorEmail: "chris@sorbonne.ae",
    authorName: "Chris",
    createdAt: "2026-09-14T09:12:00Z",
  },
  {
    id: "c2",
    studentId: "A001",
    body: "Moving to TD 3 after the placement test.",
    authorEmail: "lina@sorbonne.ae",
    authorName: "Lina",
    createdAt: "2026-09-15T14:40:00Z",
  },
];

let opened = 0;

beforeEach(() => {
  opened = 0;
  vi.useFakeTimers();
  vi.spyOn(comments, "fetchComments").mockResolvedValue(THREAD);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function show(count = 2) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CommentPeek studentId="A001" label="Amira Haddad" count={count} onOpen={() => (opened += 1)} className="icon" />
    </QueryClientProvider>,
  );
  return screen.getByRole("button", { name: "2 comments on Amira Haddad" });
}

/*
 * React makes onPointerEnter/onPointerLeave out of pointerover/pointerout at the root, so
 * those are the events to send: a bare `pointerenter` does not bubble and is never seen.
 */
const arrive = (element: HTMLElement) => fireEvent.pointerOver(element);
const leave = (element: HTMLElement) => fireEvent.pointerOut(element);

/*
 * The panel opens on a timer, so the clock is moved inside `act`: the state change happens
 * in the timer's callback rather than in an event handler, and React has to be given the
 * chance to draw it before anything is looked for.
 */
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

/** Hover, wait out the settle, and let the read resolve. */
async function hover(button: HTMLElement) {
  arrive(button);
  // The settle, then the read the opening starts — two separate waits, not one long one.
  await tick(300);
  await tick(0);
}

describe("the thread under the pointer", () => {
  it("shows every line, with who wrote it", async () => {
    const button = show();

    await hover(button);

    const panel = screen.getByRole("group", { name: "Comments on Amira Haddad" });
    expect(panel.textContent).toContain("the transfer credit is agreed");
    expect(panel.textContent).toContain("Moving to TD 3");
    expect(panel.textContent).toContain("Chris");
    expect(panel.textContent).toContain("Lina");
  });

  it("asks for nothing while the pointer is only passing over", async () => {
    // Sweeping down a table of three thousand rows must not be three thousand reads.
    const button = show();

    arrive(button);
    await tick(100);
    leave(button);
    await tick(500);

    expect(comments.fetchComments).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("goes away when the pointer does", async () => {
    const button = show();
    await hover(button);

    leave(button);
    await tick(200);

    expect(screen.queryByRole("group")).toBeNull();
  });

  it("stays while the pointer is inside it, so a long thread can be read", async () => {
    const button = show();
    await hover(button);
    const panel = screen.getByRole("group", { name: "Comments on Amira Haddad" });

    leave(button);
    arrive(panel);
    await tick(500);

    expect(screen.getByRole("group", { name: "Comments on Amira Haddad" })).toBeTruthy();
  });

  it("says nothing at all about a student nobody has written about", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <CommentPeek studentId="A002" label="Omar Aziz" count={0} onOpen={() => {}} className="icon" />
      </QueryClientProvider>,
    );

    await hover(screen.getByRole("button", { name: "Comment on Omar Aziz" }));

    expect(comments.fetchComments).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("opens the real thread on a click, and takes the panel away with it", async () => {
    const button = show();
    await hover(button);

    fireEvent.click(button);
    await tick(0);

    expect(opened).toBe(1);
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("opens at once for a keyboard, which does not sweep", async () => {
    const button = show();

    fireEvent.focus(button);
    await tick(0);

    expect(screen.getByRole("group", { name: "Comments on Amira Haddad" })).toBeTruthy();
  });
});
