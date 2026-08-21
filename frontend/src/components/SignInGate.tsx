import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { StaffContext } from "@/components/useStaffUser";
import { StaffUser, fetchCurrentUser, fetchSignInConfig, signIn } from "@/services/auth";

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

/**
 * Nothing in this application renders until someone has signed in with an
 * approved Google account. The server enforces the same rule on every request —
 * this is the front door, not the lock.
 */
export function SignInGate({ children }: { children: ReactNode }) {
  const config = useQuery({ queryKey: ["sign-in-config"], queryFn: fetchSignInConfig, retry: false });
  const session = useQuery({ queryKey: ["staff-user"], queryFn: fetchCurrentUser, retry: false });
  const [user, setUser] = useState<StaffUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data) setUser(session.data);
  }, [session.data]);

  const accept = useCallback(async (credential: string) => {
    setError(null);
    try {
      setUser(await signIn(credential));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That sign-in could not be completed.");
    }
  }, []);

  if (user) {
    return <StaffContext.Provider value={user}>{children}</StaffContext.Provider>;
  }

  if (config.isLoading || session.isLoading) {
    return (
      <Screen>
        <p className="flex items-center justify-center gap-2 text-sm text-[#667085]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking your session…
        </p>
      </Screen>
    );
  }

  if (config.error) {
    return (
      <Screen title="The application is not reachable">
        <p className="text-sm leading-6 text-[#667085]">
          The server did not answer. Try again in a moment, or check that the API is running.
        </p>
      </Screen>
    );
  }

  if (!config.data?.configured || !config.data.clientId) {
    return (
      <Screen title="Sign-in is not configured">
        <p className="text-sm leading-6 text-[#667085]">
          This deployment has no Google sign-in settings, so the application is closed. Set{" "}
          <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">GOOGLE_AUTH_CLIENT_ID</code>,{" "}
          <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">COORDINATOR_ACCESS_EMAILS</code> and{" "}
          <code className="rounded bg-[#f2f4f7] px-1 py-0.5 text-[13px]">SESSION_SECRET</code>, then redeploy.
        </p>
      </Screen>
    );
  }

  return (
    <Screen title="Sign in to continue">
      <p className="text-sm leading-6 text-[#667085]">
        Academic Coordinator Tools is for SCEN staff. Sign in with your Sorbonne Google account.
      </p>
      <GoogleButton clientId={config.data.clientId} onCredential={accept} />
      {error ? (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-3 py-2 text-sm text-[#a6292f]">
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </Screen>
  );
}

function GoogleButton({
  clientId,
  onCredential,
}: {
  clientId: string;
  onCredential: (credential: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [scriptFailed, setScriptFailed] = useState(false);
  const callback = useRef(onCredential);
  callback.current = onCredential;

  useEffect(() => {
    let cancelled = false;

    function render() {
      if (cancelled || !target.current || !window.google) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => callback.current(response.credential),
      });
      window.google.accounts.id.renderButton(target.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
        shape: "rectangular",
        width: 280,
      });
    }

    if (window.google) {
      render();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`);
    const script = existing ?? document.createElement("script");
    script.src = GOOGLE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", render);
    script.addEventListener("error", () => setScriptFailed(true));
    if (!existing) document.head.appendChild(script);

    return () => {
      cancelled = true;
      script.removeEventListener("load", render);
    };
  }, [clientId]);

  if (scriptFailed) {
    return (
      <p role="alert" className="mt-6 text-sm text-[#a6292f]">
        Google sign-in could not be loaded. Check your connection and reload the page.
      </p>
    );
  }
  return <div ref={target} className="mt-6 flex justify-center" data-testid="google-sign-in" />;
}

function Screen({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f7f8fa] px-4">
      <section className="w-full max-w-md rounded-xl border border-[#d9dee7] bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-normal text-[#a6292f] uppercase">
          Sorbonne University Abu Dhabi
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#171717]">
          Academic Coordinator Tools
        </h1>
        {title ? <h2 className="mt-6 text-base font-semibold text-[#171717]">{title}</h2> : null}
        <div className="mt-2">{children}</div>
      </section>
    </main>
  );
}
