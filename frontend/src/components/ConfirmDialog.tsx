import { useEffect, useId } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

/** Shared, accessible confirmation surface for destructive in-app actions. */
export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

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
    <div className="fixed inset-0 z-[110] grid place-items-center bg-[#101828]/35 p-4" onMouseDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} className="w-full max-w-md rounded-lg border border-[#d9dee7] bg-white p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id={titleId} className="text-lg font-semibold text-[#171717]">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-[#667085]">{description}</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">Cancel</button>
          <button type="button" onClick={onConfirm} className="rounded-md bg-[#a6292f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#8f1f25]">{confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
