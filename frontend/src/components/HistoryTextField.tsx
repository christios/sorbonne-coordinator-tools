import { type ChangeEventHandler, type HTMLAttributes, type HTMLInputTypeAttribute } from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { FieldHistoryControl, type HistoryField } from "@/components/FieldHistory";

type HistoryConfig = {
  field: HistoryField;
  onOpenHistory: (field: HistoryField) => void;
};

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  history?: HistoryConfig;
  multiline?: boolean;
  minRows?: number;
  type?: HTMLInputTypeAttribute;
  min?: number;
  max?: number;
  step?: number;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  invalid?: boolean;
  className?: string;
  inputClassName?: string;
};

export function HistoryTextField({
  label,
  value,
  onChange,
  history,
  multiline = false,
  minRows = 3,
  type = "text",
  min,
  max,
  step,
  inputMode,
  invalid = false,
  className = "",
  inputClassName = "",
}: Props) {
  const handleChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement> = (event) =>
    onChange(event.target.value);
  const stateClass = invalid
    ? "border-[#a6292f] focus:border-[#a6292f] focus:ring-[#fde2e2]"
    : "border-[#b7bec8] focus:border-[#1f4e79] focus:ring-[#d7e5f3]";
  const textInputClass = `block h-10 w-full rounded-md border px-3 py-2 pr-10 font-normal ${stateClass} focus:outline-none focus:ring-2 ${inputClassName}`;
  const textareaClass = `block w-full resize-y rounded-md border px-3 py-2 pr-10 font-normal leading-6 ${stateClass} focus:outline-none focus:ring-2 ${inputClassName}`;

  return (
    <label className={`grid content-start gap-1 text-sm font-medium text-[#344054] ${className}`}>
      {label}
      <div className={`relative leading-none ${multiline ? "" : "h-10"}`}>
        {multiline ? (
          <AutoResizeTextarea
            value={value}
            onChange={handleChange}
            minRows={minRows}
            className={textareaClass}
          />
        ) : (
          <input
            type={type}
            value={value}
            min={min}
            max={max}
            step={step}
            inputMode={inputMode}
            aria-invalid={invalid || undefined}
            onChange={handleChange}
            className={textInputClass}
          />
        )}
        {history ? (
          <FieldHistoryControl
            field={history.field}
            onOpenSidebar={history.onOpenHistory}
            placement={multiline ? "top" : "center"}
          />
        ) : null}
      </div>
    </label>
  );
}
