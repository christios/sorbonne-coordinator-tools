import { X } from "lucide-react";
import { useState } from "react";

import type { Filter } from "@/services/filterSummary";
import type { PortalField } from "@/services/scenRosters";

/**
 * Compose a registrar search from the fields the portal offers.
 *
 * Every row is generated from the extension's schema, so a field the portal gains appears
 * here without a code change. Each field is a dropdown: pick a value and it joins the
 * chosen ones underneath, which is the only shape that copes with the long code tables —
 * the portal's nationality list alone runs to 139 entries.
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
        The extension has not said what the portal can be filtered by, so there is nothing to build
        a search from yet.
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
    <div className="divide-y divide-[#eef1f5]">
      {fields.map((field) => (
        <FilterRow
          key={field.key}
          field={field}
          trusted={trusted || field.verified === true}
          chosen={filter[field.key] ?? []}
          onChange={(values) => set(field.key, values)}
        />
      ))}
    </div>
  );
}

function FilterRow({
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
  const label = field.label || field.key;
  const known = new Map(field.options.map((option) => [option.value, option.label]));
  const available = field.options.filter((option) => !chosen.includes(option.value));

  const add = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !chosen.includes(trimmed)) onChange([...chosen, trimmed]);
  };

  return (
    <div className="grid gap-2 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <div className="pt-1">
        <span className="block text-sm font-semibold text-[#344054]">{label}</span>
        <span className="block text-xs tabular-nums text-[#98a2b3]">{field.key}</span>
      </div>

      <div>
        {field.options.length ? (
          <select
            aria-label={label}
            value=""
            onChange={(event) => add(event.target.value)}
            className="w-full max-w-sm rounded-md border border-[#cbd5e1] px-3 py-2 text-sm"
          >
            <option value="">{available.length ? `Add ${label.toLowerCase()}…` : "All added"}</option>
            {available.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label && option.label !== option.value
                  ? `${option.value} — ${option.label}`
                  : option.value}
              </option>
            ))}
          </select>
        ) : (
          <TypeCode label={label} placeholder="Type a code, then Enter" onAdd={add} />
        )}

        {chosen.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chosen.map((value) => (
              <span
                key={value}
                className="inline-flex items-center gap-1 rounded-full bg-[#e8edf3] px-2.5 py-1 text-xs font-semibold text-[#1f4e79]"
                title={known.get(value) || value}
              >
                {value}
                <button
                  type="button"
                  aria-label={`Remove ${value} from ${label}`}
                  onClick={() => onChange(chosen.filter((kept) => kept !== value))}
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        {field.options.length && !trusted ? (
          // The list was written by hand and never confirmed, so it may be missing the code
          // you need — which is exactly what went wrong with the enrolment statuses.
          <TypeCode
            label={`Another ${label.toLowerCase()} code`}
            placeholder="or type a code the list is missing"
            dashed
            onAdd={add}
          />
        ) : null}
      </div>
    </div>
  );
}

function TypeCode({
  label,
  placeholder,
  dashed = false,
  onAdd,
}: {
  label: string;
  placeholder: string;
  dashed?: boolean;
  onAdd: (value: string) => void;
}) {
  const [typed, setTyped] = useState("");

  return (
    <input
      aria-label={label}
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        onAdd(typed);
        setTyped("");
      }}
      placeholder={placeholder}
      className={`w-full max-w-sm rounded-md border px-3 text-sm ${
        dashed ? "mt-2 border-dashed border-[#cbd5e1] py-1.5 text-xs" : "border-[#cbd5e1] py-2"
      }`}
    />
  );
}
