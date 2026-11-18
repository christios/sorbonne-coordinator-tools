import { Loader2 } from "lucide-react";
import { useState } from "react";

import { signInWithMicrosoft } from "@/services/microsoftSignIn";

/** Microsoft's four squares, as its sign-in button carries them. */
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/**
 * "Sign in with Microsoft", for a personal Microsoft account (Outlook, Hotmail, Live): the
 * popup opens, and the ID token it gives is handed on, as Google's button hands its own.
 */
export function MicrosoftButton({
  clientId,
  onCredential,
  onError,
}: {
  clientId: string;
  onCredential: (token: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onError("");
        signInWithMicrosoft(clientId)
          .then(onCredential)
          .catch((exc: Error) => onError(exc.message))
          .finally(() => setBusy(false));
      }}
      className="mx-auto flex h-10 w-full max-w-[14rem] items-center justify-center gap-3 rounded border border-[#8c8c8c] bg-white px-3 text-[15px] font-semibold text-[#5e5e5e] hover:bg-[#f7f7f7] disabled:opacity-60"
    >
      {busy ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <MicrosoftLogo />}
      Sign in with Microsoft
    </button>
  );
}
