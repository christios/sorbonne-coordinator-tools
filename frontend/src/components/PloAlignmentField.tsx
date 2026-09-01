import { ReactNode } from "react";

import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { X } from "lucide-react";

export function PloAlignmentField({
  label,
  pickerLabel,
  value,
  onChange,
  options,
  history,
  emptyText = "No PLOs aligned yet.",
  addText = "Add aligned PLO",
}: {
  label: string;
  pickerLabel: string;
  emptyText?: string;
  addText?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  history?: ReactNode;
}) {
  const selectedValues = Array.from(
    new Set(
      value
        .split("\n")
        .filter(Boolean)
        .map(
          (selectedValue) =>
            findMatchingPloOption(selectedValue, options)?.value ??
            selectedValue,
        ),
    ),
  );
  const selected = selectedValues.map(
    (selectedValue) =>
      options.find((option) => option.value === selectedValue) ?? {
        value: selectedValue,
        label: selectedValue,
      },
  );
  const availableOptions = options.filter(
    (option) => !selectedValues.includes(option.value),
  );

  const add = (selectedValue: string) =>
    onChange([...selectedValues, selectedValue].join("\n"));
  const remove = (selectedValue: string) =>
    onChange(
      selectedValues.filter((value) => value !== selectedValue).join("\n"),
    );

  return (
    <div role="group" aria-label={label} className="relative grid gap-2">
      <div className="min-h-5 pr-8 text-sm font-medium text-[#344054]">
        {label}
      </div>
      {history}
      {selected.length ? (
        <ul aria-label={`Selected ${label}`} className="grid gap-2">
          {selected.map((option) => (
            <li
              key={option.value}
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-[#d9dee7] bg-[#f8fafc] px-3 py-2 text-sm text-[#344054]"
            >
              <span className="min-w-0 truncate">{option.label}</span>
              <button
                type="button"
                onClick={() => remove(option.value)}
                className="shrink-0 rounded p-1 text-[#667085] hover:bg-[#e8edf3] hover:text-[#a6292f]"
                aria-label={`Remove ${option.label} from ${label}`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-[#d0d5dd] px-3 py-2 text-sm text-[#667085]">
          {emptyText}
        </p>
      )}
      <SelectMenu
        label={pickerLabel}
        value=""
        onChange={add}
        placeholder={addText}
        options={availableOptions}
        disabled={availableOptions.length === 0}
      />
    </div>
  );
}


function findMatchingPloOption(value: string, options: SelectOption[]) {
  const exact = options.find((option) => option.value === value);
  if (exact) return exact;

  const identity = getPloIdentity(value);
  return identity
    ? options.find((option) => getPloIdentity(option.value) === identity)
    : undefined;
}


function getPloIdentity(value: string) {
  const match = value.match(/^PLO\s*(\d+)\b/i);
  return match ? `PLO ${match[1]}` : undefined;
}

