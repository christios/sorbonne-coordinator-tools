import { AlertTriangle, ArrowRight, Info } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

/**
 * A small ⓘ that explains itself on hover or focus — for what used to be a line of grey
 * under a heading.
 *
 * A page read every day does not need telling every day what its parts are for; the
 * sentence is wanted the first time and in doubt, and costs a line of the page every
 * other time. This keeps it one hover away, beside the thing it explains.
 *
 * With a `title`, the bubble is a small card read top to bottom: a heading, what to do
 * (`TipDo`), what it changes (`TipPoint`s), and one real case (`TipExample`).
 */
export function InfoTip({ children, label = "What this is", title }: { children: ReactNode; label?: string; title?: string }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex shrink-0 items-center rounded-full p-0.5 align-middle text-[#b4bcc8] hover:text-[#667085] focus-visible:text-[#667085]"
          >
            <Info size={13} aria-hidden="true" />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={12}
            className={`z-[130] ${title ? "w-[22rem] max-w-[calc(100vw-1.5rem)] px-3.5 py-3" : "max-w-xs px-3 py-2"} rounded-md border border-[#d9dee7] bg-white text-xs font-normal normal-case leading-5 tracking-normal text-[#475467] shadow-lg`}
          >
            {title ? (
              <span className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#171717]">
                <Info size={14} className="shrink-0 text-[#1f4e79]" aria-hidden="true" />
                {title}
              </span>
            ) : null}
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

/** What to do — the line the reader came for, first and highlighted. */
export function TipDo({ children }: { children: ReactNode }) {
  return (
    <span className="mb-2 flex items-start gap-1.5 rounded-md bg-[#eef4fa] px-2 py-1.5 font-semibold text-[#1f4e79]">
      <ArrowRight size={13} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** A small heading inside the bubble, over a group of points. */
export function TipHeading({ children }: { children: ReactNode }) {
  return <span className="mb-1 mt-2.5 block text-[10px] font-semibold uppercase tracking-wide text-[#8a94a4]">{children}</span>;
}

const DOTS = {
  plain: "bg-[#98a2b3]",
  good: "bg-[#2e7d55]",
  caution: "bg-[#d99b1c]",
  serious: "bg-[#a6292f]",
} as const;

/**
 * One point: a bullet, or a step number. The bullet takes the page's colours when it stands
 * for one — the sets list's green, amber and red dots are explained by dots of their own.
 */
export function TipPoint({ children, tone = "plain", step }: { children: ReactNode; tone?: keyof typeof DOTS; step?: number }) {
  return (
    <span className="mt-1 flex items-start gap-2">
      {step ? (
        <span
          className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#1f4e79] text-[10px] font-semibold leading-none text-white"
          aria-hidden="true"
        >
          {step}
        </span>
      ) : (
        <span className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[tone]}`} aria-hidden="true" />
      )}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

/** A name as the page shows it — a set, a group, a course, a major — so it is recognised at a glance. */
export function TipPill({ children }: { children: ReactNode }) {
  return (
    <span className="mx-px inline-flex whitespace-nowrap rounded-full bg-[#e8edf3] px-1.5 text-[11px] font-semibold leading-[18px] text-[#1f4e79]">
      {children}
    </span>
  );
}

/** One real case, from the department's own schema. */
export function TipExample({ children }: { children: ReactNode }) {
  return (
    <span className="mt-2.5 block rounded-md border border-dashed border-[#cfd8e3] bg-[#fbfcfe] px-2 py-1.5">
      <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#2e7d55]">Example</span>
      {children}
    </span>
  );
}

/** What goes wrong if it is left undone. */
export function TipWarn({ children }: { children: ReactNode }) {
  return (
    <span className="mt-2 flex items-start gap-1.5 font-medium text-[#a6292f]">
      <AlertTriangle size={12} className="mt-[3px] shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}
