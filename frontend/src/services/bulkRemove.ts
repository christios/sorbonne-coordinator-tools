import { alreadyGone } from "@/services/portalLists";

/** A removal that did not finish, carrying the ids still to deal with. */
export class RemovalFailed extends Error {
  readonly failed: string[];

  constructor(message: string, failed: string[]) {
    super(message);
    this.name = "RemovalFailed";
    this.failed = failed;
  }
}

/**
 * Remove each of them, and report what actually happened.
 *
 * Two rules, both learned from the same wedge on the Active Teachers list. A row that
 * is already gone — removed in another tab, or by the half of an earlier run that did
 * land — is the outcome we asked for, not a failure; counting it as one made the retry
 * certain to fail on the very first id, because the selection was never pruned. And one
 * genuine failure must not abandon the rest, or the list is left in a state nobody chose.
 *
 * On any genuine failure this throws `RemovalFailed`, whose `failed` ids are what the
 * caller should leave selected so that pressing Remove again means something.
 */
export async function removeEach(ids: string[], remove: (id: string) => Promise<unknown>): Promise<number> {
  const failed: string[] = [];
  let removed = 0;
  let last: unknown = null;

  for (const id of ids) {
    try {
      await remove(id);
      removed += 1;
    } catch (error) {
      if (alreadyGone(error)) removed += 1;
      else {
        failed.push(id);
        last = error;
      }
    }
  }

  if (failed.length) {
    const reason = last instanceof Error ? last.message : "That could not be completed.";
    throw new RemovalFailed(`${removed} of ${ids.length} removed. ${reason}`, failed);
  }
  return removed;
}

/** What to leave selected after a removal settles: nothing, or only what genuinely failed. */
export function stillSelected(error: unknown): Set<string> {
  return new Set(error instanceof RemovalFailed ? error.failed : []);
}
