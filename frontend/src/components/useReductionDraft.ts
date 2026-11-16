import { useMemo, useState } from "react";

import { type ReductionInput, type ReductionItem, hoursOf } from "@/services/hourReductions";

/** What a kind holds while it is being changed. */
export type ReductionDraft = Record<string, { amount: number; detail: string; validated: boolean }>;

/**
 * A year's reductions as they are being changed, and their totals as they stand.
 *
 * The totals are worked out here as the server works them out, so a figure typed shows what it
 * comes to before anything is saved.
 */
export function useReductionDraft(items: ReductionItem[], service: number) {
  const [draft, setDraft] = useState<ReductionDraft>(() =>
    Object.fromEntries(
      items.map((item) => [item.kind, { amount: item.amount, detail: item.detail, validated: item.state === "validated" }]),
    ),
  );
  const total = useMemo(
    () => items.reduce((sum, item) => sum + hoursOf(item, draft[item.kind]?.amount ?? 0, draft[item.kind]?.detail ?? ""), 0),
    [items, draft],
  );
  const set = (kind: string, value: Partial<ReductionDraft[string]>) =>
    setDraft((current) => ({ ...current, [kind]: { ...current[kind], ...value } }));
  /** What changed, for the server: only the kinds `may` allows. */
  const changes = (may: (item: ReductionItem) => boolean, withValidation = false): Record<string, ReductionInput> =>
    Object.fromEntries(
      items
        .filter((item) => may(item))
        .map((item) => {
          const value = draft[item.kind];
          return [
            item.kind,
            { amount: value.amount, detail: value.detail, ...(withValidation ? { validated: value.validated } : {}) },
          ];
        }),
    );
  return { draft, set, total, owed: Math.max(0, service - total), changes };
}
