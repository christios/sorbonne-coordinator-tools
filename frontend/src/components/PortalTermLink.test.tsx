import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UnlinkedTermWarning } from "@/components/PortalTermLink";
import * as lists from "@/services/portalLists";

function renderWarning(termId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UnlinkedTermWarning termId={termId} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("the portal term on a course card", () => {
  it("says nothing once the semester is linked", async () => {
    const links = vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-1": "262710" });

    const { container } = renderWarning("term-1");

    await vi.waitFor(() => expect(links).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    // And nowhere to type one: the semester's link is not a course's to change.
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("points to Semesters when the semester has no portal term", async () => {
    vi.spyOn(lists, "fetchTermLinks").mockResolvedValue({ "term-2": "262710" });

    renderWarning("term-1");

    const link = await screen.findByRole("link", { name: /not linked to a portal term/ });
    expect(link.getAttribute("href")).toBe("#/database/semesters");
  });
});
