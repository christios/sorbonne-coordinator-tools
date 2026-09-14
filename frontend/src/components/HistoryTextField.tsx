import {
  type ChangeEventHandler,
  type HTMLAttributes,
  type HTMLInputTypeAttribute,
} from "react";

import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import {
  FieldHistoryControl,
  type HistoryField,
} from "@/components/FieldHistory";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";

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
  /** How much room the value needs. A ceiling, not a fixed width. */
  size?: FieldSize;
  /**
   * A one-line value that wraps onto a second line rather than scrolling out of sight.
   *
   * Sizing a box to its content means some values will not fit it, and a value you cannot
   * see is worse than a box of an awkward height. Enter still does nothing here: the box
   * wrapping is it fitting the text, not the text becoming a paragraph.
   */
  grow?: boolean;
  /**
   * Take the whole height of the cell rather than the height of what is written.
   *
   * For a box standing beside a taller one, where two ragged edges look like a mistake.
   * It grows no further on its own, so the text scrolls inside it once the cell is full.
   */
  fill?: boolean;
  /** Guidance shown behind the info button instead of a paragraph on the page. */
  hint?: string;
  /** Where the value comes from, shown in grey beside the label. */
  source?: string;
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
  size = "full",
  grow = false,
  fill = false,
  hint,
  source,
}: Props) {
  const handleChange: ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  > = (event) => onChange(event.target.value);
  const stateClass = invalid
    ? "border-[#a6292f] focus:border-[#a6292f] focus:ring-[#fde2e2]"
    : "border-[#b7bec8] focus:border-[#1f4e79] focus:ring-[#d7e5f3]";
  const textInputClass = `peer block h-10 w-full min-w-0 rounded-md border px-3 py-2 pr-10 font-normal ${stateClass} focus:outline-none focus:ring-2 ${inputClassName}`;
  const textareaClass = `block w-full min-w-0 resize-y rounded-md border px-3 py-2 pr-10 font-normal leading-6 ${stateClass} focus:outline-none focus:ring-2 ${inputClassName}`;
  const growClass = `block w-full min-w-0 resize-none rounded-md border px-3 py-2 pr-10 font-normal leading-6 ${stateClass} focus:outline-none focus:ring-2 ${inputClassName}`;
  // A number never needs a second line, so it keeps the plain box and its stepper arrows.
  const wraps = grow && !multiline && type === "text";

  return (
    <label
      className={`grid gap-1 text-sm font-medium text-[#344054] ${fill ? "h-full grid-rows-[auto_minmax(0,1fr)]" : "content-start"} ${fieldSizeClass[size]} ${className}`}
    >
      <FormFieldLabel className="sm:whitespace-nowrap" fieldKey={history?.field.path} hint={hint} source={source}>
        {label}
      </FormFieldLabel>
      <div
        className={`relative w-full leading-none ${fill ? "h-full" : ""} ${multiline || wraps ? "" : "h-10"}`}
      >
        {wraps ? (
          <AutoResizeTextarea
            value={value}
            onChange={handleChange}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            minRows={1}
            aria-invalid={invalid || undefined}
            className={growClass}
          />
        ) : multiline ? (
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
            // A number field changes value when the wheel passes over it, which is how
            // contact hours and ECTS moved without anyone meaning to change them.
            onWheel={type === "number" ? (event) => event.currentTarget.blur() : undefined}
            className={textInputClass}
          />
        )}
        {history && !multiline && !wraps ? (
          // An overflowing value scrolls through the input's right padding and collides
          // with the history icon. Blur it out there instead, and step aside on focus so
          // the caret stays sharp while typing at the end of a long value.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-px right-px z-[5] w-11 rounded-r-md bg-gradient-to-l from-white via-white/70 to-transparent backdrop-blur-[3px] transition-opacity duration-150 peer-focus:opacity-0"
          />
        ) : null}
        {history ? (
          <FieldHistoryControl
            field={history.field}
            onOpenSidebar={history.onOpenHistory}
            placement={multiline || wraps ? "top" : "center"}
          />
        ) : null}
      </div>
    </label>
  );
}
