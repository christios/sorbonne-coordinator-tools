import type { DefaultOptions } from "@tanstack/react-query";

/**
 * How long what a coordinator has already seen is treated as still true, and when it is
 * asked for again.
 *
 * Three settings that only make sense together:
 *
 * - **Half an hour of cache.** Stepping between screens redraws from what this browser
 *   already holds rather than asking the server and blinking while it answers. It was half
 *   a minute, which is shorter than anybody spends on one screen, so going back to a list
 *   opened moments ago re-fetched all of it — and the biggest of these take the server a
 *   second or more to build. What makes the long window safe is that nothing here goes
 *   stale on its own: a list changes because somebody changed it, and every one of those
 *   actions already says which lists it affected, a portal sync included.
 *
 * - **Coming back to the tab re-asks**, stale or not. What no action can say is that a
 *   DIFFERENT coordinator changed something, since there is no channel to hear it on. The
 *   moment you return to the application is the moment that change is most likely to be
 *   waiting.
 *
 * - **What is on screen is asked again every two minutes** while you are looking at it.
 *   Otherwise a coordinator who never leaves the tab could work all morning against
 *   somebody else's old picture, which is the one hole the long window opens. It costs
 *   nothing you can see: a refresh in the background replaces the data under a screen that
 *   is already drawn, so nothing blanks and nothing blinks — unlike the re-fetch on
 *   arriving at a screen, which is what made the old half-minute window feel the way it
 *   did. React Query holds the timer while the tab is in the background, where nobody is
 *   looking, and the line above catches it up on return.
 */
export const QUERY_DEFAULTS: DefaultOptions = {
  queries: {
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: "always",
    refetchInterval: 2 * 60_000,
  },
};
