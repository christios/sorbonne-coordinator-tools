import type { SyncTarget } from "@/services/portalSync";

/**
 * What a list goes by in a run and in the checklist: its kind and filter, and — for courses
 * and registrations — the portal term it is pulled for, since one filter is a list per
 * semester.
 */
export const targetKey = (target: Pick<SyncTarget, "kind" | "id" | "termCode">): string =>
  `${target.kind}:${target.id}${target.termCode ? `@${target.termCode}` : ""}`;
