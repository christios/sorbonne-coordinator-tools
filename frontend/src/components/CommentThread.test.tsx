import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CommentThread } from "@/components/CommentThread";
import { StaffContext } from "@/components/useStaffUser";
import * as comments from "@/services/studentComments";

const ME = { email: "me@sorbonne.ae", name: "Me", isAdmin: false };
const THREAD: comments.StudentComment[] = [
  { id: "c1", studentId: "A001", body: "Spoke to the registrar.", authorEmail: "colleague@sorbonne.ae", authorName: "Colleague", createdAt: "2026-09-10T08:30:00+00:00" },
  { id: "c2", studentId: "A001", body: "Transfer lands next week.", authorEmail: "ME@sorbonne.ae", authorName: "Me", createdAt: "2026-09-11T09:15:00+00:00" },
];

function show(user = ME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StaffContext.Provider value={user}>
        <CommentThread studentId="A001" label="Amira Haddad" />
      </StaffContext.Provider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(comments, "fetchComments").mockResolvedValue(THREAD);
});
afterEach(() => vi.restoreAllMocks());

describe("a student's thread", () => {
  it("reads down: who said what, and when", async () => {
    show();
    const lines = await screen.findAllByRole("listitem");

    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain("Colleague");
    expect(lines[0].textContent).toContain("Spoke to the registrar.");
    expect(lines[0].querySelector("time")?.getAttribute("datetime")).toBe("2026-09-10T08:30:00+00:00");
    expect(lines[1].textContent).toContain("Me");
  });

  it("offers to edit and delete only one's own lines, whatever the case of the address", async () => {
    show();
    await screen.findAllByRole("listitem");

    expect(screen.getAllByRole("button", { name: "Edit this comment" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete this comment" })).toHaveLength(1);
  });

  it("rewrites one's own line in place", async () => {
    const edited = vi.spyOn(comments, "editComment").mockResolvedValue({ ...THREAD[1], body: "Transfer lands on Monday." });
    show();
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("button", { name: "Edit this comment" }));
    fireEvent.change(screen.getByLabelText("Edit the comment"), { target: { value: " Transfer lands on Monday. " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(edited).toHaveBeenCalledWith("c2", "Transfer lands on Monday."));
    await waitFor(() => expect(screen.queryByLabelText("Edit the comment")).toBeNull());
  });

  it("deletes one's own line only once it is confirmed", async () => {
    const deleted = vi.spyOn(comments, "deleteComment").mockResolvedValue(undefined);
    show();
    await screen.findAllByRole("listitem");

    fireEvent.click(screen.getByRole("button", { name: "Delete this comment" }));
    expect(deleted).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete comment" }));

    await waitFor(() => expect(deleted).toHaveBeenCalledWith("c2"));
  });

  it("posts what was typed and clears the box", async () => {
    const posted = vi.spyOn(comments, "postComment").mockResolvedValue({ ...THREAD[1], id: "c3", body: "Done." });
    show();
    await screen.findAllByRole("listitem");

    const box = screen.getByLabelText("Add a comment on Amira Haddad") as HTMLTextAreaElement;
    expect((screen.getByRole("button", { name: "Post" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  Done.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(posted).toHaveBeenCalledWith("A001", "Done."));
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("says so when there is nothing yet", async () => {
    vi.spyOn(comments, "fetchComments").mockResolvedValue([]);
    show();

    expect(await screen.findByText("Nothing said yet.")).toBeTruthy();
  });
});
