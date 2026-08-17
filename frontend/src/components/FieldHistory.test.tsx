import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FieldHistoryControl, FieldHistoryProvider } from "@/components/FieldHistory";

function renderWithQueryClient(children: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("FieldHistoryControl", () => {
  it("does not render a history action when the surrounding form has not enabled history", () => {
    renderWithQueryClient(<FieldHistoryControl field={{ path: "profile.email", label: "Email" }} onOpenSidebar={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "View edit history for Email" })).toBeNull();
  });

  it("keeps history disabled when a provider is explicitly switched off", () => {
    renderWithQueryClient(
      <FieldHistoryProvider enabled={false} source={{ resourceType: "example", resourceId: "record-1", revision: 3, loadHistory: vi.fn() }}>
        <FieldHistoryControl field={{ path: "profile.email", label: "Email" }} onOpenSidebar={vi.fn()} />
      </FieldHistoryProvider>,
    );

    expect(screen.queryByRole("button", { name: "View edit history for Email" })).toBeNull();
  });

  it("loads history through the supplied provider", async () => {
    const loadHistory = vi.fn().mockResolvedValue([]);
    renderWithQueryClient(
      <FieldHistoryProvider enabled source={{ resourceType: "example", resourceId: "record-1", revision: 3, loadHistory }}>
        <FieldHistoryControl field={{ path: "details.name", label: "Name" }} onOpenSidebar={vi.fn()} />
      </FieldHistoryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "View edit history for Name" }));

    await waitFor(() => expect(loadHistory).toHaveBeenCalledWith("details.name"));
  });

  it("can align a history action with a field label", () => {
    renderWithQueryClient(
      <FieldHistoryProvider enabled source={{ resourceType: "example", resourceId: "record-1", revision: 3, loadHistory: vi.fn() }}>
        <FieldHistoryControl field={{ path: "details.name", label: "Name" }} onOpenSidebar={vi.fn()} placement="label" />
      </FieldHistoryProvider>,
    );

    expect(screen.getByRole("button", { name: "View edit history for Name" }).parentElement?.className)
      .toContain("right-0 top-0");
  });
});
