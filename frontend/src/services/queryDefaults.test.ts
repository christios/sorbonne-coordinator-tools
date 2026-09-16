import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QUERY_DEFAULTS } from "@/services/queryDefaults";

/** One list on screen, under the application's own settings. Subscribing is what puts it there. */
async function onScreen(ask: () => Promise<string>) {
  const client = new QueryClient({ defaultOptions: QUERY_DEFAULTS });
  const observer = new QueryObserver(client, { queryKey: ["a-list"], queryFn: ask });
  const stop = observer.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(0);
  return { client, observer, stop };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("how long what is on screen is trusted", () => {
  it("does not ask again for a list it already holds", async () => {
    // The half-minute window this replaced re-fetched a list on every visit to a screen,
    // which is what made stepping between screens blink.
    const ask = vi.fn(async () => "rows");
    const { client, stop } = await onScreen(ask);
    expect(ask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await client.fetchQuery({ queryKey: ["a-list"], queryFn: ask });

    expect(ask).toHaveBeenCalledTimes(1);
    stop();
  });

  it("asks again while somebody is looking at it, so another coordinator's change lands", async () => {
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);
    expect(ask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1_000);

    expect(ask).toHaveBeenCalledTimes(2);
    stop();
  });

  it("keeps asking for as long as it is watched", async () => {
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);

    await vi.advanceTimersByTimeAsync(6 * 60_000 + 1_000);

    expect(ask.mock.calls.length).toBeGreaterThanOrEqual(4);
    stop();
  });

  it("stops asking once nothing is on screen to keep up to date", async () => {
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);
    stop();

    await vi.advanceTimersByTimeAsync(6 * 60_000);

    expect(ask).toHaveBeenCalledTimes(1);
  });
});
