/**
 * Where Microsoft's sign-in popup comes back to: a page of its own, so the popup does not load
 * the whole application. It hands Microsoft's answer to the page that opened it, which closes
 * the popup and sends the ID token to the server (see services/microsoftSignIn).
 */
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

void broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "That sign-in could not be completed. Close this window and try again.";
});
