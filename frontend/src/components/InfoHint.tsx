import { Popover } from "radix-ui";
import { Info } from "lucide-react";
import { useState } from "react";

/**
 * The explanation a button used to carry as a paragraph beside it.
 *
 * A toolbar of plain buttons reads in a glance; the same toolbar with a paragraph under
 * each one does not, and the paragraphs are only wanted the first few times. Folding them
 * behind the button that needs them keeps both: the page stays a page, and the text is one
 * press away rather than gone.
 *
 * The content is rendered only while open, so a hint may quote whatever is on screen —
 * how many blocks there are, how many names this browser is holding — without that
 * costing anything when nobody is asking.
 */
export function InfoHint({
  label,
  title,
  children,
}: {
  /** Names the button for a screen reader: "What the workbook must contain". */
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          className={`rounded-md border border-[#b7bec8] bg-white p-2 hover:bg-[#f8fafc] hover:text-[#344054] ${
            open ? "text-[#1f4e79]" : "text-[#667085]"
          }`}
        >
          <Info size={16} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {open ? (
          <Popover.Content
            role="dialog"
            aria-label={title}
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={12}
            className="z-[100] w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-[#d9dee7] bg-white p-4 shadow-lg outline-none"
          >
            <p className="text-sm font-semibold text-[#171717]">{title}</p>
            <div className="mt-2 space-y-2 text-sm leading-6 text-[#667085]">{children}</div>
          </Popover.Content>
        ) : null}
      </Popover.Portal>
    </Popover.Root>
  );
}
