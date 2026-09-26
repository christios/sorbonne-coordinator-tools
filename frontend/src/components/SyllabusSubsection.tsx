import { ReactNode } from "react";

import { InfoTip } from "@/components/InfoTip";

type Props = {
  title: string;
  children: ReactNode;
  className?: string;
  /** What the group is for, behind an ⓘ beside the title rather than a line under it. */
  info?: ReactNode;
  /** The ⓘ's name for a screen reader; "About" and the title when not given. */
  infoLabel?: string;
};

/** A focused, titled canvas for a logical group within a syllabus section. */
export function SyllabusSubsection({ title, children, className = "", info, infoLabel }: Props) {
  return (
    <section className={`min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5 ${className}`}>
      <h3 className="flex items-center gap-1.5 text-lg font-semibold text-[#171717]">
        {title}
        {info ? <InfoTip label={infoLabel ?? `About ${title}`}>{info}</InfoTip> : null}
      </h3>
      {/* minmax(0,…) rather than a bare column: an auto track grows to whatever a field asks
          for, so a field sized wider than a phone stretched the card instead of being
          reined in by it. */}
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4">{children}</div>
    </section>
  );
}
