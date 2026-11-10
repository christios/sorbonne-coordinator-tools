import { useCallback, useState } from "react";

type Ticks = Set<string>;
type Update = Ticks | ((current: Ticks) => Ticks);

const NONE: Ticks = new Set();

/**
 * The rows ticked on a page, held for one semester (or view, or cohort) and no other.
 *
 * On Active CRNs, ticking Semester 1's CRNs, switching to Semester 2 and pressing
 * Remove removed the Semester 1 CRNs nobody could see any more; on Cohorts, "Move to
 * cohort" acted on students the semester on screen did not hold. A tick is a pointer at
 * something on screen, so it belongs to what was on screen when it was made: once
 * `scope` changes the page reads no ticks at all, in the same render, with no effect to
 * wait for. Switching back does not bring the old ticks back either.
 *
 * `scope` is empty while the page does not know its semester yet. Learning it is not a
 * switch: the rows on screen were already that semester's, so what was ticked stays.
 */
export function useTicks(scope: string): [Ticks, (next: Update) => void] {
  const [held, setHeld] = useState<{ scope: string; ids: Ticks }>({ scope, ids: NONE });
  const kept = (before: { scope: string; ids: Ticks }) => (before.scope === scope || !before.scope ? before.ids : NONE);
  // Dropped during render, React's way of adjusting state to a changed prop: going back
  // to the first semester must not bring its old ticks back with it.
  if (held.scope !== scope) setHeld({ scope, ids: kept(held) });
  const ids = kept(held);
  const set = useCallback(
    (next: Update) =>
      setHeld((before) => {
        const current = before.scope === scope || !before.scope ? before.ids : NONE;
        return { scope, ids: typeof next === "function" ? next(current) : next };
      }),
    [scope],
  );
  return [ids, set];
}
