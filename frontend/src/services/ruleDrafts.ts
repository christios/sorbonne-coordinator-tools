/**
 * The rules one scope is editing: the shared ones, or one cohort's own.
 *
 * Kept apart from the editor that draws them because two places edit them now: the
 * shared rules in a dialog of their own, and a cohort's own rules as a tab of the
 * cohort's settings, where they save with everything else the cohort says.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { STATUS_FIELD, type RuleKind } from "@/services/discrepancies";
import { type Cohort, type DiscrepancyRule, fetchDiscrepancyRules, saveDiscrepancyRules } from "@/services/studentDatabase";

export type Draft = { id: string; field: string; kind: RuleKind; values: string[]; cohortId: string };

/** Which rules are being edited: the shared ones, or one cohort's own. */
export type RulesScope = { kind: "shared" } | { kind: "cohort"; cohort: Cohort };

/** Belonging is judged from the major first, so the rule sits on it. */
export const BELONGS_FIELDS = ["MAJOR_CODE", "MAJOR_CODE_DESC"];
/** What a cohort carries, so what a `differs` rule can compare against. */
export const DIFFERS_FIELDS = ["MAJOR_CODE", "MAJOR_CODE_DESC", "TERM_CODE", "YEARLEVEL_CODE"];
/** The status is a fact of now, not of the pull history: it has no "changed". */
export const STATUS_KINDS: RuleKind[] = ["is", "is_not"];

/** Whether every draft says a whole sentence the checks can judge. */
export function rulesComplete(drafts: Draft[]): boolean {
  return drafts.every(
    (draft) =>
      draft.field &&
      (draft.kind === "changed" || draft.kind === "differs" || draft.kind === "belongs" || draft.values.length > 0) &&
      (draft.kind !== "differs" || DIFFERS_FIELDS.includes(draft.field)) &&
      (draft.kind !== "belongs" || BELONGS_FIELDS.includes(draft.field)) &&
      (draft.field !== STATUS_FIELD || STATUS_KINDS.includes(draft.kind)),
  );
}

const said = (rule: Draft | DiscrepancyRule) => ({
  id: rule.id,
  field: rule.field,
  kind: rule.kind,
  values: [...rule.values],
  cohortId: rule.cohortId ?? "",
});

export function useRuleDrafts(scope: RulesScope, open: boolean) {
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules, enabled: open });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const cohortId = scope.kind === "cohort" ? scope.cohort.id : "";
  const inScope = (rule: { cohortId?: string }) => (rule.cohortId ?? "") === cohortId;
  const saved = (rules.data ?? []).filter(inScope);

  // Start from what is saved for this scope, each time the editor opens.
  useEffect(() => {
    if (open && rules.data) setDrafts(rules.data.filter(inScope).map((rule) => ({ ...rule, cohortId })));
  }, [open, rules.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    drafts,
    setDrafts,
    cohortId,
    /** How many rules this scope has saved, before any edit. */
    savedCount: saved.length,
    complete: rulesComplete(drafts),
    /** Whether anything differs from what is saved — a cohort's settings save rules only then. */
    changed: JSON.stringify(drafts.map(said)) !== JSON.stringify(saved.map(said)),
    // The server keeps one list, so the rules outside this scope go back untouched.
    save: () => saveDiscrepancyRules([...(rules.data ?? []).filter((rule) => !inScope(rule)), ...drafts]),
  };
}

/** What the rules of a scope apply to, said above them. */
export function rulesDescription(scope: RulesScope): string {
  return scope.kind === "shared"
    ? "Shared with every coordinator and applied to every cohort, and to the students in none. Change rules are measured from the moment a student was placed in their cohort."
    : `Applied to ${scope.cohort.name} on top of the shared rules. Change rules are measured from the moment a student was placed in the cohort.`;
}

/** Where a rule's values come from, said beside the button that saves them. */
export function schemaNote(source: string | undefined): string {
  return source === "portal"
    ? "Values are the portal's own, as the extension last read them."
    : "Sign in to the portal once so the extension can read its values; until then these are the built-in ones.";
}
