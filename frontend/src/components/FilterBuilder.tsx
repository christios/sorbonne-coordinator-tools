import { Check, Plus, X } from "lucide-react";
import { useState } from "react";

import type { Filter } from "@/services/filterSummary";
import type { PortalField } from "@/services/scenRosters";

/**
 * Compose a registrar search from the fields the portal offers.
 *
 * Every control here is generated from the extension's schema, so the day the extension
 * reads a new field from the portal it appears in this panel without a code change. A
 * field with a fixed list of codes becomes a set of toggles; one without becomes a text
 * box, because that is what the portal does with it.
 */
export function FilterBuilder({
  fields,
  filter,
  trusted = false,
  onChange,
}: {
  fields: PortalField[];
  filter: Filter;
  /** True when the schema came from the portal, so its values are the whole list. */
  trusted?: boolean;
  onChange: (filter: Filter) => void;
}) {
  if (fields.length === 0) {
    return (
      <p className="text-sm text-[#667085]">
        The extension has not told us what the portal can be filtered by, so there is nothing to
        build a search from yet.
      </p>
    );
  }

  const set = (key: string, values: string[]) => {
    const next = { ...filter };
    if (values.length) next[key] = values;
    else delete next[key];
    onChange(next);
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <fieldset key={field.key} className="rounded-md border border-[#e4e8ef] px-3 py-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-[#667085]">
            {field.label || field.key}
          </legend>
          {field.options.length ? (
            <Choices
              field={field}
              trusted={trusted || field.verified === true}
              chosen={filter[field.key] ?? []}
              onChange={(values) => set(field.key, values)}
            />
          ) : (
            <FreeText values={filter[field.key] ?? []} onChange={(values) => set(field.key, values)} />
          )}
        </fieldset>
      ))}
    </div>
  );
}

function Choices({
  field,
  trusted,
  chosen,
  onChange,
}: {
  field: PortalField;
  trusted: boolean;
  chosen: string[];
  onChange: (values: string[]) => void;
}) {
  const extra = chosen.filter((value) => !field.options.some((option) => option.value === value));

  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {field.options.map((option) => {
        const on = chosen.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            aria-label={`${field.label || field.key}: ${option.label || option.value}`}
            onClick={() =>
              onChange(on ? chosen.filter((value) => value !== option.value) : [...chosen, option.value])
            }
            title={option.label}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              on
                ? "bg-[#1f4e79] text-white"
                : "border border-[#d9dee7] bg-white text-[#344054] hover:bg-[#f2f7fb]"
            }`}
          >
            {on ? <Check size={11} aria-hidden="true" /> : null}
            {option.value}
          </button>
        );
      })}

      {extra.map((value) => (
        <span
          key={value}
          className="inline-flex items-center gap-1 rounded-full bg-[#1f4e79] px-2.5 py-1 text-xs font-semibold text-white"
        >
          {value}
          <button
            type="button"
            aria-label={`Remove ${value}`}
            onClick={() => onChange(chosen.filter((kept) => kept !== value))}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </span>
      ))}

      {trusted ? null : (
        // These values were written by hand and never confirmed, so the list is a
        // suggestion: the code you need may simply not be on it.
        <AddValue
          label={`Another ${field.label || field.key} code`}
          onAdd={(value) => (chosen.includes(value) ? undefined : onChange([...chosen, value]))}
        />
      )}
    </div>
  );
}

/** Type a code the offered list does not have. */
function AddValue({ label, onAdd }: { label: string; onAdd: (value: string) => void }) {
  const [draft, setDraft] = useState("");

  return (
    <span className="inline-flex items-center gap-1">
      <input
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (draft.trim()) onAdd(draft.trim());
          setDraft("");
        }}
        placeholder="other…"
        className="w-20 rounded-full border border-dashed border-[#b7bec8] px-2 py-1 text-xs"
      />
    </span>
  );
}

/** A field the portal takes free text for — a surname, an id fragment. */
function FreeText({ values, onChange }: { values: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim();
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
    setDraft("");
  };

  return (
    <div className="py-1">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1 rounded-full bg-[#1f4e79] px-2.5 py-1 text-xs font-semibold text-white"
          >
            {value}
            <button
              type="button"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((kept) => kept !== value))}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            add();
          }}
          placeholder="Add a value"
          className="w-full rounded-md border border-[#cbd5e1] px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Add value"
          className="rounded-md border border-[#b7bec8] px-2 text-[#1f4e79] disabled:opacity-40"
        >
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
