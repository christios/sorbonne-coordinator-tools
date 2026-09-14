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
      {/* minmax(0,…) rather than a bare column: an auto track grows to whatever a field asks
          for, so a field sized wider than a phone stretched the card instead of being
          reined in by it. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
    </section>
  );
}
