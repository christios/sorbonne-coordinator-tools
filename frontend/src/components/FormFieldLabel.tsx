import { type ReactNode } from "react";
import { FieldInfoLabel } from "@/components/FieldInfo";

type FormFieldLabelProps = {
  children: ReactNode;
  required?: boolean;
  className?: string;
  fieldKey?: string;
};

/** Shared label treatment for required coordinator-tool form controls. */
export function FormFieldLabel({
  children,
  required = false,
  className = "",
  fieldKey,
}: FormFieldLabelProps) {
  return (
    <span className={className}>
      <FieldInfoLabel fieldKey={fieldKey}>{children}</FieldInfoLabel>
      {required ? (
        <span aria-hidden="true" className="ml-1 text-[#a6292f]">
          *
        </span>
      ) : null}
    </span>
  );
}
