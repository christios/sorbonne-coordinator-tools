/**
 * How far apart a sync asks the registrar's timetable about two sections — one number for
 * the whole department, set from the Portal sync pop-up.
 *
 * Kept on our server rather than in this browser because the portal is one system: a
 * coordinator who slows the sync after the registrar complains has slowed everybody's,
 * including the sync a colleague runs first thing in the morning.
 *
 * The page that drives a sync is the one that keeps the pace, so the number is put into
 * effect wherever a run can be driven — at the start of a run, whenever it is read again,
 * and the moment it is changed in any tab of this browser. A change made in somebody
 * else's browser in the middle of a sweep is picked up by the next run.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiFetch } from "@/services/http";
import { portalPace } from "@/services/scenRosters";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const BASE = `${API_BASE_URL}/api/v1/portal-pace`;

/** The same bounds the server keeps: never faster than the pace agreed on 29 September 2026. */
export const FASTEST = 1;
export const SLOWEST = 60;
export const DEFAULT_SECONDS = 4;

/** Heard by the other tabs of this browser, one of which may be the one driving the run. */
const CHANGED = "scen-sync-pace";

export type SyncPace = {
  secondsApart: number;
  /** Blank while it is still the default. */
  updatedAt: string;
  updatedBy: string;
  updatedByName: string;
};

async function answer(response: Response): Promise<SyncPace> {
  if (!response.ok) {
    let detail = "That could not be saved. Try again in a moment.";
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail;
    } catch {
      // the default sentence stands
    }
    throw new Error(detail);
  }
  return (await response.json()) as SyncPace;
}

/** Put a pace into effect in this tab: every portal request after this one waits for it. */
export function keepPace(seconds: number): void {
  const bounded = Math.min(SLOWEST, Math.max(FASTEST, Math.round(seconds) || DEFAULT_SECONDS));
  portalPace.apart = bounded * 1000;
}

export async function fetchSyncPace(): Promise<SyncPace> {
  const pace = await answer(await apiFetch(BASE));
  keepPace(pace.secondsApart);
  return pace;
}

/** A change on its way to the server, so a run started meanwhile waits for it. */
let saving: Promise<unknown> = Promise.resolve();

export function setSyncPace(seconds: number): Promise<SyncPace> {
  const work = (async () => {
    const pace = await answer(
      await apiFetch(BASE, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondsApart: seconds }),
      }),
    );
    keepPace(pace.secondsApart);
    try {
      window.localStorage.setItem(CHANGED, String(pace.secondsApart));
    } catch {
      // The other tabs pick it up when they next read it.
    }
    return pace;
  })();
  saving = work.catch(() => undefined);
  return work;
}

/**
 * Wait for a change still being saved. Typing a number and pressing Sync at once is one
 * gesture — the field is left, which saves it, and the button is pressed — and the run
 * that starts must not read the old pace back over the new one.
 */
export function paceSaved(): Promise<unknown> {
  return saving;
}

/**
 * The department's pace, read and kept in effect in this tab.
 *
 * A failed read leaves the pace where it was — the default, or the last one read — which
 * is never faster than the agreed floor.
 */
export function useSyncPace() {
  const pace = useQuery({ queryKey: ["sync-pace"], queryFn: fetchSyncPace, retry: false });
  const seconds = pace.data?.secondsApart;
  useEffect(() => {
    if (seconds) keepPace(seconds);
  }, [seconds]);
  const { refetch } = pace;
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CHANGED || !event.newValue) return;
      keepPace(Number(event.newValue));
      void refetch();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refetch]);
  return pace;
}
