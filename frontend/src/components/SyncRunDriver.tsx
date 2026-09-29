import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getRun, isRunning, resumeRun, subscribe, type SyncRun } from "@/services/syncRun";
import { freshen, useSyncTargets } from "@/services/syncTargets";

/**
 * Nothing to look at: the thing that makes a portal sync outlive the page.
 *
 * A run is written down as it goes, but somebody has to pick it up again after a reload,
 * and the button that started it may not be on screen — a reload can land in another app
 * entirely. So this sits above the whole application, sees an unfinished run, and carries
 * on with it.
 *
 * It waits in line rather than asking once. A run another tab is driving is left to that
 * tab, and this page takes it over the moment that tab goes. It used to try once, on
 * load, and a refusal then — a reload inside the ninety seconds the old page was still
 * trusted — left the run stuck until somebody reloaded again. It follows runs started
 * elsewhere after it loaded, for the same reason.
 */
export function SyncRunDriver() {
  const client = useQueryClient();
  const { targets, ready } = useSyncTargets();
  // The newest list of what there is to sync, whenever the run is finally taken over.
  const latest = useRef(targets);
  latest.current = targets;
  const following = useRef("");

  useEffect(() => {
    if (!ready) return;
    const follow = (run: SyncRun | null) => {
      if (!isRunning(run) || following.current === run.id) return;
      following.current = run.id;
      void resumeRun(latest.current, () => freshen(client));
    };
    follow(getRun());
    return subscribe(follow);
  }, [ready, client]);

  return null;
}
