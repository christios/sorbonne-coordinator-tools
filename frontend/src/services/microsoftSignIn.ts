/**
 * Signing in with a personal Microsoft account (Outlook, Hotmail, Live), for an invited teacher
 * who does not use Google (18 Nov 2026).
 *
 * Microsoft's own library opens its sign-in in a popup and returns an ID token, which the
 * page sends to the server as it sends Google's; the server checks it. The library is loaded
 * only when the button is pressed, so nobody else's page carries it.
 */

/** Where the popup comes back to: a small page of its own (microsoft-signin.html). */
export const microsoftReturnPage = () => `${window.location.origin}/microsoft-signin.html`;

/** Sign in at Microsoft in a popup; the ID token, or an Error in words. */
export async function signInWithMicrosoft(clientId: string): Promise<string> {
  const { PublicClientApplication, BrowserAuthError } = await import("@azure/msal-browser");
  const app = new PublicClientApplication({
    auth: {
      clientId,
      // Personal accounts only: a work or school account is not offered.
      authority: "https://login.microsoftonline.com/consumers",
      redirectUri: microsoftReturnPage(),
    },
    cache: { cacheLocation: "sessionStorage" },
  });
  await app.initialize();
  try {
    const result = await app.loginPopup({ scopes: ["openid", "profile", "email"], prompt: "select_account" });
    return result.idToken;
  } catch (exc) {
    if (exc instanceof BrowserAuthError && exc.errorCode === "user_cancelled") throw new Error("The Microsoft sign-in was closed before it finished.");
    if (exc instanceof BrowserAuthError && exc.errorCode === "popup_window_error")
      throw new Error("The browser blocked Microsoft's sign-in window. Allow pop-ups for this page and try again.");
    throw new Error("The Microsoft sign-in could not be completed. Try again in a moment.");
  }
}
