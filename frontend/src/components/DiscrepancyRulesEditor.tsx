import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { STATUS_FIELD, STATUS_OPTIONS, labelOf, type RuleKind } from "@/services/discrepancies";
import {
  BELONGS_FIELDS,
  DIFFERS_FIELDS,
  type Draft,
  type RulesScope,
  STATUS_KINDS,
  rulesDescription,
  schemaNote,
  useRuleDrafts,
} from "@/services/ruleDrafts";
import { fetchSchema, type PortalField } from "@/services/scenRosters";

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
const KINDS: { value: RuleKind; label: string; hint: string }[] = [
  { value: "changed", label: "changes at all", hint: "since the student was placed in the cohort" },
  { value: "changed_to", label: "changes to…", hint: "since placement, to one of the values you pick" },
  { value: "is", label: "is currently…", hint: "right now, whatever it was before" },
  { value: "is_not", label: "is currently not…", hint: "right now, anything but the values you pick — a code nobody has seen counts" },
  { value: "differs", label: "differs from the cohort's", hint: "major against the cohort's majors, term against its terms, year level against its year level" },
  { value: "belongs", label: "belongs to the cohort, but is not in it", hint: "a student outside the cohort whose major, term and year level are what the cohort expects — listed above the cohort's table" },
];

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

export type { RulesScope } from "@/services/ruleDrafts";

export function DiscrepancyRulesEditor({ open, scope, onClose }: { open: boolean; scope: RulesScope; onClose: () => void }) {
  const client = useQueryClient();
  const rules = useRuleDrafts(scope, open);
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: open });
  const save = useMutation({
    mutationFn: rules.save,
    onSuccess: (saved) => {
      client.setQueryData(["discrepancy-rules"], saved);
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      title={scope.kind === "shared" ? "Rules for every cohort" : `Rules for ${scope.cohort.name}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[#98a2b3]">
            {save.error ? (
              <span role="alert" className="text-[#a6292f]">
                {(save.error as Error).message}
              </span>
            ) : (
              schemaNote(schema.data?.source)
            )}
          </span>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!rules.complete || save.isPending}
              onClick={() => save.mutate()}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : "Save rules"}
            </button>
          </div>
        </div>
      }
    >
      <RulesList
        scope={scope}
        drafts={rules.drafts}
        setDrafts={rules.setDrafts}
        cohortId={rules.cohortId}
        open={open}
        about={rulesDescription(scope)}
      />
    </Modal>
  );
}

/**
 * The rules themselves, as a list to edit — in the shared rules' dialog, or in a tab of a
 * cohort's settings. Nothing here saves: whoever holds the list does.
 */
export function RulesList({
  scope,
  drafts,
  setDrafts,
  cohortId,
  open,
  about,
}: {
  scope: RulesScope;
  drafts: Draft[];
  setDrafts: Dispatch<SetStateAction<Draft[]>>;
  cohortId: string;
  open: boolean;
  /**
   * What these rules apply to, for a caller with nowhere else to say it. The shared rules'
   * dialog passes it; a cohort's settings say it in their own dialog and do not.
   */
  about?: string;
}) {
  const schema = useQuery({ queryKey: ["portal-schema"], queryFn: fetchSchema, enabled: open });
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

  return (
    <>
      {/*
        * The checks used to sit here, above the rules, with a cohort able to answer them
        * for itself. They are the department's now, in Settings, and an administrator's to
        * change: switching one off hides a warning from everybody. Said on the ⓘ beside the
        * heading, because this is where people will come looking for them — and a boxed line
        * above every rule list was a lot of page for a signpost.
        */}
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold text-[#344054]">Rules</h3>
        <InfoTip label="What the rules are">
          What counts as a discrepancy in a student&apos;s record; they save with the button below.
          {about ? ` ${about}` : ""} The department&apos;s checks — which warnings run, and how big a thing has to be
          before one appears — are in Settings, under Checks.
        </InfoTip>
      </div>

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
          const badMoved = draft.kind === "belongs" && !BELONGS_FIELDS.includes(draft.field);
          const badStatus = draft.field === STATUS_FIELD && !STATUS_KINDS.includes(draft.kind);
          const condition = KINDS.find((kind) => kind.value === draft.kind);
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
                    onChange={(kind) =>
                      update(index, {
                        kind: kind as RuleKind,
                        values: [],
                        // Only a major can move into a cohort's, so the field follows the kind.
                        field: kind === "belongs" && !BELONGS_FIELDS.includes(draft.field) ? "MAJOR_CODE" : draft.field,
                      })
                    }
                    options={kinds.map(({ value, label }) => ({ value, label }))}
                    variant="tinted"
                  />
                </div>
                {/* What the chosen condition measures, beside it rather than on a line of its own. */}
                {condition ? (
                  <InfoTip label={`What “${condition.label}” means in rule ${index + 1}`}>{condition.hint}</InfoTip>
                ) : null}
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
                  Belonging is judged from the major: put this rule on the major.
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
    </>
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
          showSelection={false}
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
