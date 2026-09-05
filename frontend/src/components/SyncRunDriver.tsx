import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getRun, isRunning, resumeRun } from "@/services/syncRun";
import { freshen, useSyncTargets } from "@/services/syncTargets";

/**
 * Nothing to look at: the thing that makes a portal sync outlive the page.
 *
 * A run is written down as it goes, but somebody has to pick it up again after a reload,
 * and the button that started it may not be on screen — a reload can land in another app
 * entirely. So this sits above the whole application, sees an unfinished run, and carries
 * on with it. It refuses runs another tab is still driving, and its own, which are
 * already going.
 */
export function SyncRunDriver() {
  const client = useQueryClient();
  const { targets, ready } = useSyncTargets();
  const resumed = useRef("");

  useEffect(() => {
    const held = getRun();
    if (!ready || !isRunning(held) || resumed.current === held.id) return;
    resumed.current = held.id;
    void resumeRun(targets, () => freshen(client));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return null;
}
