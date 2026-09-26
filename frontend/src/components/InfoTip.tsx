import { Info } from "lucide-react";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

/**
 * A small ⓘ that explains itself on hover or focus — for what used to be a line of grey
 * under a heading.
 *
 * A page read every day does not need telling every day what its parts are for; the
 * sentence is wanted the first time and in doubt, and costs a line of the page every
 * other time. This keeps it one hover away, beside the thing it explains.
 */
export function InfoTip({ children, label = "What this is" }: { children: ReactNode; label?: string }) {
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
            className="z-[130] max-w-xs rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-xs font-normal normal-case leading-5 tracking-normal text-[#475467] shadow-lg"
          >
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
