import type { QueryClient } from "@tanstack/react-query";

/**
 * Everything that stops being true when a student's groups or cohort change.
 *
 * One list, in one place, because it was three lists in three places and each of them was
 * missing something different. The one that mattered was the register: moving somebody
 * between groups changes the sections they are expected to be registered in, so the
 * registration warnings on their row are wrong the instant the move lands — and the check
 * is cached per cohort, so they stayed wrong until the page was reloaded. A coordinator
 * fixing a placement watched the warning it was supposed to clear sit there unchanged.
 *
 * `catalogue` and `publication` were already here; `registration-check` and `assignments`
 * are what a placement change had quietly stopped reaching.
 */
export function afterPlacement(client: QueryClient): void {
  for (const key of [
    "students",
    "cohorts",
    // Who is in which group, and how full each is.
    "catalogue",
    "assignments",
    // Readiness, the clash panel, and the count of who is in no group.
    "publication",
    // The register's verdict: which sections we now expect these students to be in.
    "registration-check",
  ]) {
    client.invalidateQueries({ queryKey: [key] });
  }
}
