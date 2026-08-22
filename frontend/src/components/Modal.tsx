import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
}: {
  open: boolean;
  title: string;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[110] grid place-items-center bg-[#101828]/35 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-[#d9dee7] bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="border-b border-[#e4e8ef] px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-[#171717]">
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-[#667085]">{description}</p> : null}
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
