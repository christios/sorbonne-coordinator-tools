import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /**
   * A word the coordinator must type before the button works.
   *
   * For the removals nothing brings back — a group somebody is sitting in, a set a
   * semester is built on. A dialog that only needs a click is dismissed by the same
   * reflex that opened it; typing "TD 3" cannot be done by reflex.
   */
  confirmPhrase?: string;
  /**
   * The work this dialog asked for is still running.
   *
   * Optional, so every existing caller is unchanged. Worth passing wherever confirming
   * means more than one round-trip: without it the button stays live and inviting for
   * the whole run, which reads as a dead button and invites a second press that starts
   * the run again.
   */
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

/** Shared, accessible confirmation surface for destructive in-app actions. */
export function ConfirmDialog({ open, title, description, confirmLabel, confirmPhrase, busy, onConfirm, onClose }: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [typed, setTyped] = useState("");
  const ready = !confirmPhrase || typed.trim().toLowerCase() === confirmPhrase.trim().toLowerCase();

  // A dialog that opens on a different thing must not remember the last thing's word.
  useEffect(() => {
    if (open) setTyped("");
  }, [open, confirmPhrase]);

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
        {confirmPhrase ? (
          <label className="mt-4 block text-sm font-semibold text-[#344054]">
            Type <span className="rounded bg-[#f2f4f7] px-1.5 py-0.5 font-mono text-[13px] text-[#a6292f]">{confirmPhrase}</span> to confirm
            <input
              aria-label={`Type ${confirmPhrase} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoFocus
              className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
            />
          </label>
        ) : null}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">Cancel</button>
          <button type="button" disabled={!ready || busy} onClick={onConfirm} className="rounded-md bg-[#a6292f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#8f1f25] disabled:bg-[#d6a5a8]">{busy ? "Working…" : confirmLabel}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
