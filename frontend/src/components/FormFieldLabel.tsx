import { type ReactNode } from "react";
import { FieldInfoLabel } from "@/components/FieldInfo";

type FormFieldLabelProps = {
  children: ReactNode;
  required?: boolean;
  className?: string;
  fieldKey?: string;
  /** Guidance shown behind the info button until an administrator writes their own. */
  hint?: string;
  /** Where the value comes from — "from Students and Timetables" — beside the label. */
  source?: string;
};

/** Shared label treatment for required coordinator-tool form controls. */
export function FormFieldLabel({
  children,
  required = false,
  className = "",
  fieldKey,
  hint,
  source,
}: FormFieldLabelProps) {
  return (
    <span className={className}>
      <FieldInfoLabel fieldKey={fieldKey} hint={hint} name={String(children)}>
        {children}
        {source ? (
          <span className="ml-1 font-normal text-[#667085]">{source}</span>
        ) : null}
      </FieldInfoLabel>
      {required ? (
        <span aria-hidden="true" className="ml-1 text-[#a6292f]">
          *
        </span>
      ) : null}
    </span>
  );
}
