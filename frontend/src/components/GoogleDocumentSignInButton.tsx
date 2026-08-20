import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: { accounts: {
      id: { initialize: (configuration: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (parent: HTMLElement, options: Record<string, string | number>) => void; };
      oauth2: { initTokenClient: (configuration: { client_id: string; scope: string; callback: (response: { access_token?: string; error?: string }) => void; error_callback?: () => void }) => { requestAccessToken: (options?: { prompt?: string }) => void } };
    } };
  }
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_DOCUMENTS_CLIENT_ID as string | undefined;
const GOOGLE_IDENTITY_SCRIPT_ID = "google-identity-services";
const GOOGLE_DOCUMENT_SYNC_SCOPES = "openid email https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets.readonly";

function loadGoogleIdentity(): Promise<void> {
  if (window.google) return Promise.resolve();
  const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
  if (existing) return new Promise((resolve, reject) => { existing.addEventListener("load", () => resolve(), { once: true }); existing.addEventListener("error", () => reject(new Error("Google sign-in could not be loaded.")), { once: true }); });
  return new Promise((resolve, reject) => {
    const script = document.createElement("script"); script.id = GOOGLE_IDENTITY_SCRIPT_ID; script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("Google sign-in could not be loaded.")); document.head.append(script);
  });
}

export function GoogleDocumentSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!CLIENT_ID || !mount.current) return;
    const render = () => {
      if (!window.google || !mount.current) return;
      window.google.accounts.id.initialize({ client_id: CLIENT_ID, callback: ({ credential }) => onCredential(credential) });
      mount.current.replaceChildren();
      window.google.accounts.id.renderButton(mount.current, { theme: "outline", size: "large", text: "signin_with", shape: "rectangular" });
    };
    const existing = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);
    if (existing) { render(); return; }
    const script = document.createElement("script"); script.id = GOOGLE_IDENTITY_SCRIPT_ID; script.src = "https://accounts.google.com/gsi/client"; script.async = true; script.onload = render; script.onerror = () => setError("Google sign-in could not be loaded."); document.head.append(script);
  }, [onCredential]);

  if (!CLIENT_ID) return <p className="text-sm text-[#667085]">Document sign-in is not configured for this deployment.</p>;
  return <><div ref={mount} aria-label="Sign in with Google" />{error ? <p role="alert" className="mt-2 text-sm text-[#8f1f25]">{error}</p> : null}</>;
}

export function GoogleDocumentSyncButton({ disabled = false, onAccessToken }: { disabled?: boolean; onAccessToken: (accessToken: string) => void }) {
  const [error, setError] = useState("");

  async function requestDriveAccess() {
    if (!CLIENT_ID) return;
    setError("");
    try {
      await loadGoogleIdentity();
      if (!window.google) throw new Error("Google sign-in could not be loaded.");
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: GOOGLE_DOCUMENT_SYNC_SCOPES,
        callback: ({ access_token, error: responseError }) => {
          if (access_token) onAccessToken(access_token);
          else setError(responseError ? "Google Drive permission was not granted." : "Google Drive permission could not be confirmed.");
        },
        error_callback: () => setError("Google Drive permission was not granted."),
      });
      client.requestAccessToken();
    } catch {
      setError("Google Drive permission could not be loaded.");
    }
  }

  if (!CLIENT_ID) return <p className="text-sm text-[#667085]">Document sync is not configured for this deployment.</p>;
  return <div><button type="button" disabled={disabled} onClick={() => { void requestDriveAccess(); }} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{disabled ? "Syncing…" : "Sync form responses"}</button>{error ? <p role="alert" className="mt-2 text-sm text-[#8f1f25]">{error}</p> : null}</div>;
}
