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

    await vi.advanceTimersByTimeAsync(15 * 60_000 + 1_000);

    expect(ask).toHaveBeenCalledTimes(2);
    stop();
  });

  it("leaves a quarter of an hour between, which is the whole reason it is affordable", async () => {
    /*
     * At two minutes a tab left open all day re-read every list on screen a few hundred
     * times for nobody, which ran the month's data allowance out and took the application
     * off its database. Nothing here goes stale fast enough to need that.
     */
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);

    await vi.advanceTimersByTimeAsync(14 * 60_000);

    expect(ask).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps asking for as long as it is watched", async () => {
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);

    await vi.advanceTimersByTimeAsync(4 * 15 * 60_000 + 1_000);

    expect(ask.mock.calls.length).toBeGreaterThanOrEqual(4);
    stop();
  });

  it("stops asking once nothing is on screen to keep up to date", async () => {
    const ask = vi.fn(async () => "rows");
    const { stop } = await onScreen(ask);
    stop();

    await vi.advanceTimersByTimeAsync(4 * 15 * 60_000);

    expect(ask).toHaveBeenCalledTimes(1);
  });
});
