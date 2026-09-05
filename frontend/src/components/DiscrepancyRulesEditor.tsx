import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { STATUS_FIELD, STATUS_OPTIONS, labelOf, type RuleKind } from "@/services/discrepancies";
import { fetchSchema, type PortalField } from "@/services/scenRosters";
import { type Cohort, fetchDiscrepancyRules, saveDiscrepancyRules } from "@/services/studentDatabase";

/**
 * What counts as a discrepancy, in the coordinators' own terms.
 *
 * A rule is a sentence: "warn when student status changes to WD or IS", "warn when major
 * differs from the cohort's". The fields and values are the portal's own, read from the
 * schema the extension learned, so a rule can only name things the portal can actually
 * say — and a coordinator picking a value sees the portal's label for it. One field is
 * this application's: whether the last sync still found the student in the portal.
 *
 * Saved as one list, shared by everybody: cohorts are shared, so the rules that judge
 * them should be too.
 */
type Draft = { id: string; field: string; kind: RuleKind; values: string[]; cohortId: string };

const KINDS: { value: RuleKind; label: string; hint: string }[] = [
  { value: "changed", label: "changes at all", hint: "since the student was placed in the cohort" },
  { value: "changed_to", label: "changes to…", hint: "since placement, to one of the values you pick" },
  { value: "is", label: "is currently…", hint: "right now, whatever it was before" },
  { value: "is_not", label: "is currently not…", hint: "right now, anything but the values you pick — a code nobody has seen counts" },
  { value: "differs", label: "differs from the cohort's", hint: "major against the cohort's majors, term against its terms, year level against its year level" },
  { value: "moved_in", label: "moved into the cohort's majors", hint: "a student not in the cohort whose major changed to one the cohort expects — listed above the cohort's table" },
];
/** Only a major can move into a cohort's. */
const MOVED_IN_FIELDS = ["MAJOR_CODE", "MAJOR_CODE_DESC"];

/** What a cohort carries, so what a `differs` rule can compare against. */
const DIFFERS_FIELDS = ["MAJOR_CODE", "MAJOR_CODE_DESC", "TERM_CODE", "YEARLEVEL_CODE"];
/** The status is a fact of now, not of the pull history: it has no "changed". */
const STATUS_KINDS: RuleKind[] = ["is", "is_not"];

/** The fields the portal offers, with a few that always matter first, and the status. */
function fieldChoices(fields: PortalField[]): { value: string; label: string }[] {
  const known = new Map(fields.map((field) => [field.key.toUpperCase(), field.label || field.key]));
  for (const key of ["STST_CODE", "ESTS_CODE", "MAJOR_CODE", "MAJOR_CODE_DESC", "YEARLEVEL_CODE", "DEPT_CODE", "TERM_CODE"]) {
    if (!known.has(key)) known.set(key, labelOf(key));
  }
  const portal = [...known.entries()]
    .map(([value, label]) => ({ value, label: `${label} (${value})` }))
    .sort((left, right) => left.label.localeCompare(right.label));
  return [{ value: STATUS_FIELD, label: "Status — in the portal or not (ours)" }, ...portal];
}

/** Which rules the dialog edits: the shared ones, or one cohort's own. */
export type RulesScope = { kind: "shared" } | { kind: "cohort"; cohort: Cohort };

export function DiscrepancyRulesEditor({ open, scope, onClose }: { open: boolean; scope: RulesScope; onClose: () => void }) {
  const client = useQueryClient();
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules, enabled: open });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: open });
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const cohortId = scope.kind === "cohort" ? scope.cohort.id : "";
  const inScope = (rule: { cohortId?: string }) => (rule.cohortId ?? "") === cohortId;

  // Start from what is saved for this scope, each time the dialog opens.
  useEffect(() => {
    if (open && rules.data) setDrafts(rules.data.filter(inScope).map((rule) => ({ ...rule, cohortId })));
  }, [open, rules.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // The server keeps one list, so the rules outside this scope go back untouched.
  const save = useMutation({
    mutationFn: () => saveDiscrepancyRules([...(rules.data ?? []).filter((rule) => !inScope(rule)), ...drafts]),
    onSuccess: (saved) => {
      client.setQueryData(["discrepancy-rules"], saved);
      onClose();
    },
  });

  const fields = fieldChoices(schema.data?.fields ?? []);
  const valuesFor = (field: string) =>
    field === STATUS_FIELD
      ? STATUS_OPTIONS
      : (schema.data?.fields.find((candidate) => candidate.key.toUpperCase() === field)?.options ?? []);

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((draft, at) => (at === index ? { ...draft, ...patch } : draft)));
  const move = (index: number, by: -1 | 1) =>
    setDrafts((current) => {
      const next = [...current];
      const to = index + by;
      if (to < 0 || to >= next.length) return current;
      next.splice(to, 0, ...next.splice(index, 1));
      return next;
    });

  const complete = drafts.every(
    (draft) =>
      draft.field &&
      (draft.kind === "changed" || draft.kind === "differs" || draft.values.length > 0) &&
      (draft.kind !== "differs" || DIFFERS_FIELDS.includes(draft.field)) &&
      (draft.kind !== "moved_in" || MOVED_IN_FIELDS.includes(draft.field)) &&
      (draft.field !== STATUS_FIELD || STATUS_KINDS.includes(draft.kind)),
  );

  return (
    <Modal
      open={open}
      title={scope.kind === "shared" ? "Rules for every cohort" : `Rules for ${scope.cohort.name}`}
      description={
        scope.kind === "shared"
          ? "Shared with every coordinator and applied to every cohort, and to the students in none. Change rules are measured from the moment a student was placed in their cohort."
          : `Applied to ${scope.cohort.name} on top of the shared rules. Change rules are measured from the moment a student was placed in the cohort.`
      }
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[#98a2b3]">
            {save.error ? (
              <span role="alert" className="text-[#a6292f]">
                {(save.error as Error).message}
              </span>
            ) : schema.data?.source === "portal" ? (
              "Values are the portal's own, as the extension last read them."
            ) : (
              "Sign in to the portal once so the extension can read its values; until then these are the built-in ones."
            )}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!complete || save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : "Save rules"}
            </button>
          </div>
        </div>
      }
    >
      {drafts.length === 0 ? (
        <p className="rounded-md border border-dashed border-[#cbd5e1] px-4 py-6 text-center text-sm text-[#667085]">
          {scope.kind === "shared"
            ? "No shared rules yet, so nothing is a discrepancy anywhere. Add one below — a good first set is “student status changes to WD or IS”, “major differs from the cohort's” and “status is not in portal”."
            : `No rules of ${scope.cohort.name}'s own. The shared rules still apply to it; add one below for something only this cohort cares about.`}
        </p>
      ) : null}

      <ol className="space-y-3">
        {drafts.map((draft, index) => {
          const options = valuesFor(draft.field);
          const kinds = draft.field === STATUS_FIELD ? KINDS.filter((kind) => STATUS_KINDS.includes(kind.value)) : KINDS;
          const needsValues = draft.kind === "changed_to" || draft.kind === "is" || draft.kind === "is_not";
          const badDiffers = draft.kind === "differs" && !DIFFERS_FIELDS.includes(draft.field);
          const badMoved = draft.kind === "moved_in" && !MOVED_IN_FIELDS.includes(draft.field);
          const badStatus = draft.field === STATUS_FIELD && !STATUS_KINDS.includes(draft.kind);
          return (
            <li key={draft.id || `new-${index}`} className="rounded-md border border-[#d9dee7] bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[#344054]">
                <span className="font-semibold">Warn when</span>
                <div className="w-64 min-w-[14rem]">
                  <SelectMenu
                    label={`Field for rule ${index + 1}`}
                    value={draft.field}
                    onChange={(field) =>
                      update(index, {
                        field,
                        values: [],
                        kind: field === STATUS_FIELD && !STATUS_KINDS.includes(draft.kind) ? "is" : draft.kind,
                      })
                    }
                    placeholder="a field"
                    searchable={fields.length > 12}
                    options={fields}
                  />
                </div>
                {/* The condition, set apart from the field: one says what, the other says how. */}
                <div className="w-60 min-w-[13rem]">
                  <SelectMenu
                    label={`Condition for rule ${index + 1}`}
                    value={draft.kind}
                    onChange={(kind) => update(index, { kind: kind as RuleKind, values: [] })}
                    options={kinds.map(({ value, label }) => ({ value, label }))}
                    variant="tinted"
                  />
                </div>
                <span className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`Move rule ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] disabled:opacity-30"
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move rule ${index + 1} down`}
                    disabled={index === drafts.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] disabled:opacity-30"
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() => setDrafts((current) => current.filter((_, at) => at !== index))}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </span>
              </div>
              <p className="mt-1 text-xs text-[#98a2b3]">{KINDS.find((kind) => kind.value === draft.kind)?.hint}</p>

              {badDiffers ? (
                <p role="alert" className="mt-2 text-sm text-[#a6292f]">
                  A cohort carries its majors, its terms and a year level, so only those can differ from it.
                </p>
              ) : null}
              {badStatus ? (
                <p role="alert" className="mt-2 text-sm text-[#a6292f]">
                  The status is a fact of now: say what it is, or is not.
                </p>
              ) : null}
              {badMoved ? (
                <p role="alert" className="mt-2 text-sm text-[#a6292f]">
                  Only a major can move into a cohort&apos;s: put this rule on the major.
                </p>
              ) : null}

              {needsValues ? (
                options.length ? (
                  <ValuePicker
                    label={`Values for rule ${index + 1}`}
                    options={options}
                    chosen={draft.values}
                    onChange={(values) => update(index, { values })}
                  />
                ) : (
                  <label className="mt-2 block text-sm text-[#344054]">
                    Values, comma separated
                    <input
                      aria-label={`Values for rule ${index + 1}`}
                      value={draft.values.join(", ")}
                      onChange={(event) =>
                        update(index, {
                          values: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="The portal has not told us this field's values — type them"
                      className="mt-1 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
                    />
                  </label>
                )
              ) : null}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() =>
          setDrafts((current) => [...current, { id: "", field: "STST_CODE", kind: "changed_to", values: [], cohortId }])
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <Plus size={14} aria-hidden="true" /> Add a rule
      </button>
    </Modal>
  );
}

/**
 * The values a rule names: chosen from a dropdown, and only the chosen ones shown, as
 * pills that can be taken off. A code table has dozens of entries; a rule names two.
 */
function ValuePicker({
  label,
  options,
  chosen,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div className="w-64 min-w-[14rem]">
        <SelectMenu
          label={label}
          value={chosen.join("\n")}
          multiple
          itemNoun="value"
          placeholder={chosen.length ? "Add another…" : "Choose values…"}
          searchable={options.length > 8}
          onChange={(next) => onChange(next.split("\n").filter(Boolean))}
          options={options.map((option) => ({
            value: option.value,
            label: option.label === option.value ? option.value : `${option.label} (${option.value})`,
            searchText: option.value,
          }))}
        />
      </div>
      {chosen.map((value) => (
        <span key={value} className="inline-flex items-center gap-1 rounded-full bg-[#1f4e79] py-1 pl-2.5 pr-1.5 text-xs font-semibold text-white">
          {labelOf(value)}
          {labelOf(value) !== value ? <span className="font-normal text-white/70">{value}</span> : null}
          <button
            type="button"
            aria-label={`Remove ${labelOf(value)}`}
            onClick={() => onChange(chosen.filter((held) => held !== value))}
            className="rounded-full p-0.5 hover:bg-white/20"
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}
    </div>
  );
}
