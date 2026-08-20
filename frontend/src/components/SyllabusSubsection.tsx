import { ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
  className?: string;
};

/** A focused, titled canvas for a logical group within a syllabus section. */
export function SyllabusSubsection({ title, children, className = "" }: Props) {
  return (
    <section className={`min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5 ${className}`}>
      <h3 className="text-lg font-semibold text-[#171717]">{title}</h3>
      <div className="mt-4 grid gap-4">{children}</div>
    </section>
  );
}
