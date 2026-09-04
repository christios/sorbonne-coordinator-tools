import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { labelOf, type RuleKind } from "@/services/discrepancies";
import { fetchSchema, type PortalField } from "@/services/scenRosters";
import { fetchDiscrepancyRules, saveDiscrepancyRules } from "@/services/studentDatabase";

/**
 * What counts as a discrepancy, in the coordinators' own terms.
 *
 * A rule is a sentence: "warn when student status changes to WD or IS", "warn when major
 * differs from the cohort's program". The fields and values are the portal's own, read
 * from the schema the extension learned, so a rule can only name things the portal can
 * actually say — and a coordinator picking a value sees the portal's label for it.
 *
 * Saved as one list, shared by everybody: cohorts are shared, so the rules that judge
 * them should be too.
 */
type Draft = { id: string; field: string; kind: RuleKind; values: string[] };

const KINDS: { value: RuleKind; label: string; hint: string }[] = [
  { value: "changed", label: "changes at all", hint: "since the student was placed in the cohort" },
  { value: "changed_to", label: "changes to…", hint: "since placement, to one of the values you tick" },
  { value: "is", label: "is currently…", hint: "right now, whatever it was before" },
  { value: "is_not", label: "is currently not…", hint: "right now, anything but the values you tick — a code nobody has seen counts" },
  { value: "differs", label: "differs from the cohort's", hint: "major against program, or year level against year level" },
];

const DIFFERS_FIELDS = ["MAJOR_CODE_DESC", "YEARLEVEL_CODE"];

/** The fields the portal offers, with a few that always matter first. */
function fieldChoices(fields: PortalField[]): { value: string; label: string }[] {
  const known = new Map(fields.map((field) => [field.key.toUpperCase(), field.label || field.key]));
  for (const key of ["STST_CODE", "ESTS_CODE", "MAJOR_CODE_DESC", "YEARLEVEL_CODE"]) {
    if (!known.has(key)) known.set(key, labelOf(key));
  }
  return [...known.entries()]
    .map(([value, label]) => ({ value, label: `${label} (${value})` }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function DiscrepancyRulesEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const rules = useQuery({ queryKey: ["discrepancy-rules"], queryFn: fetchDiscrepancyRules, enabled: open });
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: open });
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Start from what is saved, each time the dialog opens.
  useEffect(() => {
    if (open && rules.data) setDrafts(rules.data.map((rule) => ({ ...rule })));
  }, [open, rules.data]);

  const save = useMutation({
    mutationFn: () => saveDiscrepancyRules(drafts),
    onSuccess: (saved) => {
      client.setQueryData(["discrepancy-rules"], saved);
      onClose();
    },
  });

  const fields = fieldChoices(schema.data?.fields ?? []);
  const valuesFor = (field: string) =>
    schema.data?.fields.find((candidate) => candidate.key.toUpperCase() === field)?.options ?? [];

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
      (draft.kind !== "differs" || DIFFERS_FIELDS.includes(draft.field)),
  );

  return (
    <Modal
      open={open}
      title="What counts as a discrepancy"
      description="One set of rules for every cohort, shared with every coordinator. Change rules are measured from the moment a student was placed in their cohort."
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
          No rules yet, so nothing is a discrepancy. Add one below — a good first pair is
          “student status changes to WD or IS” and “major differs from the cohort's”.
        </p>
      ) : null}

      <ol className="space-y-3">
        {drafts.map((draft, index) => {
          const options = valuesFor(draft.field);
          const needsValues = draft.kind === "changed_to" || draft.kind === "is" || draft.kind === "is_not";
          const badDiffers = draft.kind === "differs" && !DIFFERS_FIELDS.includes(draft.field);
          return (
            <li key={draft.id || `new-${index}`} className="rounded-md border border-[#d9dee7] bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm text-[#344054]">
                <span className="font-semibold">Warn when</span>
                <div className="w-64 min-w-[14rem]">
                  <SelectMenu
                    label={`Field for rule ${index + 1}`}
                    value={draft.field}
                    onChange={(field) => update(index, { field, values: [] })}
                    placeholder="a field"
                    options={fields}
                  />
                </div>
                {/* The condition, set apart from the field: one says what, the other says how. */}
                <div className="w-60 min-w-[13rem]">
                  <SelectMenu
                    label={`Condition for rule ${index + 1}`}
                    value={draft.kind}
                    onChange={(kind) => update(index, { kind: kind as RuleKind, values: [] })}
                    options={KINDS.map(({ value, label }) => ({ value, label }))}
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
                  A cohort only carries a program and a year level, so only major and year level can differ from it.
                </p>
              ) : null}

              {needsValues ? (
                options.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {options.map((option) => (
                      <li key={option.value} className="flex items-center gap-1.5 text-sm text-[#344054]">
                        <input
                          type="checkbox"
                          id={`rule-${index}-${option.value}`}
                          checked={draft.values.includes(option.value)}
                          onChange={() =>
                            update(index, {
                              values: draft.values.includes(option.value)
                                ? draft.values.filter((value) => value !== option.value)
                                : [...draft.values, option.value],
                            })
                          }
                        />
                        <label htmlFor={`rule-${index}-${option.value}`}>
                          {option.label}
                          {option.label !== option.value ? (
                            <span className="text-[#98a2b3]"> ({option.value})</span>
                          ) : null}
                        </label>
                      </li>
                    ))}
                  </ul>
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
          setDrafts((current) => [...current, { id: "", field: "STST_CODE", kind: "changed_to", values: [] }])
        }
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
      >
        <Plus size={14} aria-hidden="true" /> Add a rule
      </button>
    </Modal>
  );
}
