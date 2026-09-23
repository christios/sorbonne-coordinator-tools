import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyProdButton } from "@/components/CopyProdButton";

/** The answer Vite gives a POST it has no route for: 404, and not one byte of body. */
const notFoundByVite = () => new Response("", { status: 404 });

const answer = (report: Record<string, unknown>) =>
  new Response(JSON.stringify(report), { status: 200, headers: { "Content-Type": "application/json" } });

function press() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CopyProdButton />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Copy prod/ }));
  fireEvent.click(screen.getByRole("button", { name: /Copy production/ }));
}

afterEach(() => vi.restoreAllMocks());

describe("copying production down to this machine", () => {
  it("asks the API, not the dev server that is serving the page", async () => {
    /*
     * The two sit on different ports in development. A path on its own went to Vite,
     * which has no such route and answers 404 with an empty body — so the button reported
     * "Unexpected end of JSON input", which is about the parser and says nothing about
     * the address that was actually wrong.
     */
    const fetching = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer({ tables: { students: 2, warning_dismissals: 29 }, rows: 31 }));

    press();

    expect(await screen.findByRole("status")).toBeTruthy();
    const asked = String(fetching.mock.calls[0][0]);
    expect(asked.startsWith("http://")).toBe(true);
    expect(asked.endsWith("/api/v1/dev/copy-from-production")).toBe(true);
  });

  it("says what the API answered when it answers nothing", async () => {
    // Whatever goes wrong next, the message should name the status rather than the parser.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(notFoundByVite());

    press();

    expect((await screen.findByRole("alert")).textContent).toContain("404");
  });

  it("says how much arrived, in tables and rows, because it is every table", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(answer({ tables: { students: 2993, warning_dismissals: 29 }, rows: 3022 }));

    press();

    expect((await screen.findByRole("status")).textContent).toBe("2 tables, 3,022 rows — exactly as production holds them.");
  });
});
