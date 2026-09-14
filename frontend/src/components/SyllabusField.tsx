import { ReactNode } from "react";

import { FormFieldLabel } from "@/components/FormFieldLabel";
import { fieldSizeClass, type FieldSize } from "@/components/fieldSize";

type Props = {
  label: string;
  children: ReactNode;
  /** The history path, which is also the key an administrator's own guidance is filed under. */
  fieldKey?: string;
  /** Guidance shown behind the info button instead of a paragraph on the page. */
  hint?: string;
  /** Where the value comes from — "from Students and Timetables" — in grey beside the label. */
  source?: string;
  /** How much room the value needs. A ceiling, not a fixed width. */
  size?: FieldSize;
  className?: string;
};

/**
 * One label treatment for a control that is not a plain box — a dropdown, a list of chips.
 *
 * Deliberately not a `<label>`: a dropdown is a button, and wrapping it would mean one click
 * on the label both opened the menu and opened the field's information.
 */
export function SyllabusField({ label, children, fieldKey, hint, source, size = "full", className = "" }: Props) {
  return (
    <div className={`grid content-start gap-1 text-sm font-medium text-[#344054] ${fieldSizeClass[size]} ${className}`}>
      <FormFieldLabel fieldKey={fieldKey} hint={hint} source={source}>
        {label}
      </FormFieldLabel>
      <div className="w-full">{children}</div>
    </div>
  );
}
