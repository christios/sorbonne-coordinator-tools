import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * How a part of a form is used, in three short steps side by side: an icon, what to do, a
 * hint — and, beside them, a box for the one thing apart. The preferences week opened with it
 * first; the course schedule step uses the same (18 Nov 2026).
 */
export function HowTo({ steps, children }: { steps: { icon: LucideIcon; title: ReactNode; hint: ReactNode }[]; children?: ReactNode }) {
  return (
    <div className="mt-3 flex flex-wrap items-stretch gap-2">
      {/* The steps take the row on a phone, the box beside them going under. */}
      <ol className="grid min-w-0 flex-1 basis-full gap-2 sm:basis-0 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, hint }, index) => (
          <li key={index} className="flex items-start gap-2.5 rounded-lg border border-[#e3e8ef] bg-white px-3 py-2">
            <span className="relative mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef4fa] text-[#1f4e79]">
              <Icon size={14} aria-hidden="true" />
              <span className="absolute -right-1 -top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#1f4e79] text-[9px] font-semibold text-white">
                {index + 1}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-[#171717]">{title}</span>
              <span className="block text-[11px] leading-4 text-[#667085]">{hint}</span>
            </span>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
}
