import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInGate } from "@/components/SignInGate";
import * as auth from "@/services/auth";
import * as rosters from "@/services/rosterStore";
import { SIGNED_OUT } from "@/services/http";

/** Stand in for Google Identity Services and hand back the callback it registers. */
function stubGoogle() {
  let callback: ((response: { credential: string }) => void) | null = null;
  vi.stubGlobal("google", {
    accounts: {
      id: {
        initialize: (options: { callback: (response: { credential: string }) => void }) => {
          callback = options.callback;
        },
        renderButton: () => undefined,
      },
    },
  });
  return {
    signInWith(credential: string) {
      if (!callback) throw new Error("Google sign-in was never initialised");
      callback({ credential });
    },
  };
}

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SignInGate>
        <p>Coordinator tools</p>
      </SignInGate>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "client-id" });
  vi.spyOn(auth, "fetchCurrentUser").mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SignInGate", () => {
  it("keeps the application hidden until somebody is signed in", async () => {
    renderGate();

    expect(await screen.findByText("Sign in to continue")).toBeTruthy();
    expect(screen.queryByText("Coordinator tools")).toBeNull();
    expect(screen.getByTestId("google-sign-in")).toBeTruthy();
  });

  it("reserves the Google button's height so its personalised swap moves nothing", async () => {
    renderGate();

    // Google renders a plain button first and a taller wrapper with it; without a fixed
    // height the swap to "Sign in as …" shifts the page a frame after it appears.
    expect((await screen.findByTestId("google-sign-in")).className).toContain("h-10");
  });

  it("shows the application to a coordinator with a live session", async () => {
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValue({
      email: "coordinator@sorbonne.ae",
      name: "Coordinator",
      isAdmin: false,
    });

    renderGate();

    expect(await screen.findByText("Coordinator tools")).toBeTruthy();
    expect(screen.queryByText("Sign in to continue")).toBeNull();
  });

  it("explains an unconfigured deployment instead of showing a dead button", async () => {
    vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: false, clientId: null });

    renderGate();

    expect(await screen.findByText("Sign-in is not configured")).toBeTruthy();
    expect(screen.getByText(/GOOGLE_AUTH_CLIENT_ID/)).toBeTruthy();
    expect(screen.queryByTestId("google-sign-in")).toBeNull();
  });

  it("says so when the server cannot be reached", async () => {
    vi.spyOn(auth, "fetchSignInConfig").mockRejectedValue(new Error("offline"));

    renderGate();

    expect(await screen.findByText("The application is not reachable")).toBeTruthy();
  });

  it("reports a Google account the server refuses, and stays closed", async () => {
    const rejection = "That account is not on the staff list for this application.";
    vi.spyOn(auth, "signIn").mockRejectedValue(new Error(rejection));
    const credential = stubGoogle();
    renderGate();
    await screen.findByTestId("google-sign-in");

    await act(async () => credential.signInWith("a-google-id-token"));

    expect((await screen.findByRole("alert")).textContent).toContain(rejection);
    expect(screen.queryByText("Coordinator tools")).toBeNull();
  });

  it("opens the application once the server accepts the Google credential", async () => {
    vi.spyOn(auth, "signIn").mockResolvedValue({ email: "coordinator@sorbonne.ae", name: "Coordinator", isAdmin: false });
    const credential = stubGoogle();
    renderGate();
    await screen.findByTestId("google-sign-in");

    await act(async () => credential.signInWith("a-google-id-token"));

    expect(await screen.findByText("Coordinator tools")).toBeTruthy();
    expect(auth.signIn).toHaveBeenCalledWith("a-google-id-token");
  });
});

/*
 * A session ends in more ways than by pressing Sign out: it expires, it is ended in
 * another tab, the deployment comes back with a new secret. The page used to carry on
 * showing the last session's figures until a save was refused — numbers that look live
 * and are not, which is worse than none.
 */
describe("a session that ends while the page is open", () => {
  const LIVE: auth.StaffUser = { email: "c@sorbonne.ae", name: "Christian", isAdmin: false };

  it("takes the application down to the front door, and says why", async () => {
    // Signed in, then the server stops knowing them — which is what a 401 means.
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValueOnce(LIVE).mockResolvedValue(null);
    vi.spyOn(rosters, "forgetRosters").mockResolvedValue();
    renderGate();
    expect(await screen.findByText("Coordinator tools")).toBeTruthy();

    await act(async () => {
      window.dispatchEvent(new Event(SIGNED_OUT));
    });

    expect(screen.queryByText("Coordinator tools")).toBeNull();
    expect(screen.getByText("Your session has ended")).toBeTruthy();
  });

  it("lets somebody the server still knows carry straight on", async () => {
    /*
     * One refused request is not proof. A save racing a cookie being renewed would
     * otherwise throw a coordinator out in the middle of their work, and the cost of
     * checking is one request.
     */
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValue(LIVE);
    vi.spyOn(rosters, "forgetRosters").mockResolvedValue();
    renderGate();
    await screen.findByText("Coordinator tools");

    await act(async () => {
      window.dispatchEvent(new Event(SIGNED_OUT));
    });

    expect(await screen.findByText("Coordinator tools")).toBeTruthy();
  });

  it("takes the rosters with it, because student names do not outlive the session", async () => {
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValueOnce(LIVE).mockResolvedValue(null);
    const forget = vi.spyOn(rosters, "forgetRosters").mockResolvedValue();
    renderGate();
    await screen.findByText("Coordinator tools");

    await act(async () => {
      window.dispatchEvent(new Event(SIGNED_OUT));
    });

    expect(forget).toHaveBeenCalled();
  });

  it("says nothing new to somebody who was never signed in", async () => {
    const forget = vi.spyOn(rosters, "forgetRosters").mockResolvedValue();
    renderGate();
    expect(await screen.findByText("Sign in to continue")).toBeTruthy();

    // The session check itself answers 401 when nobody is signed in. That is the ordinary
    // way in, not a session ending, and it must not rewrite the door's sign.
    await act(async () => {
      window.dispatchEvent(new Event(SIGNED_OUT));
    });

    expect(screen.getByText("Sign in to continue")).toBeTruthy();
    expect(forget).not.toHaveBeenCalled();
  });
});
