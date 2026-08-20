import { type ReactNode } from "react";

type FormFieldLabelProps = {
  children: ReactNode;
  required?: boolean;
  className?: string;
};

/** Shared label treatment for required coordinator-tool form controls. */
export function FormFieldLabel({ children, required = false, className = "" }: FormFieldLabelProps) {
  return <span className={className}>{children}{required ? <span aria-hidden="true" className="ml-1 text-[#a6292f]">*</span> : null}</span>;
}
