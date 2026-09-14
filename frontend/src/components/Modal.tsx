import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** The dialogs open right now, bottom to top. */
const OPEN: string[] = [];

/**
 * A working surface in a dialog, for editing something that needs room.
 *
 * ConfirmDialog is its sibling: that one asks a yes-or-no question about an action about
 * to happen, this one holds a form until it is saved or abandoned.
 */
export function Modal({
  open,
  title,
  description,
  footer,
  onClose,
  children,
  size = "default",
  header,
}: {
  open: boolean;
  title: string;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** "wide" for a screen that lays things side by side, like a student's record. */
  size?: "default" | "wide";
  /** Something to sit under the title — pills, a summary line. */
  header?: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    OPEN.push(titleId);
    // Only the dialog on top answers Escape. A record opens a CRN's record over itself,
    // and one press used to close both — the reader landed back on the table.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && OPEN[OPEN.length - 1] === titleId) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      OPEN.splice(OPEN.indexOf(titleId), 1);
    };
  }, [onClose, open, titleId]);

  if (!open) return null;
  return createPortal(
    <div
      // Below SelectMenu's popovers (z-100) so a dropdown inside the dialog is not buried
      // by it, and below ConfirmDialog (z-110) so a confirmation still lands on top.
      className="fixed inset-0 z-[90] grid place-items-center bg-[#101828]/35 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`flex max-h-[85vh] w-full flex-col rounded-lg border border-[#d9dee7] bg-white shadow-xl ${
          size === "wide" ? "max-w-5xl" : "max-w-3xl"
        }`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[#e4e8ef] px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#171717]">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-[#667085]">{description}</p> : null}
          {header}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-[#e4e8ef] px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}
