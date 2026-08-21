import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SignInGate } from "@/components/SignInGate";
import * as auth from "@/services/auth";

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

  it("shows the application to a coordinator with a live session", async () => {
    vi.spyOn(auth, "fetchCurrentUser").mockResolvedValue({
      email: "coordinator@sorbonne.ae",
      name: "Coordinator",
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
    vi.spyOn(auth, "signIn").mockResolvedValue({ email: "coordinator@sorbonne.ae", name: "Coordinator" });
    const credential = stubGoogle();
    renderGate();
    await screen.findByTestId("google-sign-in");

    await act(async () => credential.signInWith("a-google-id-token"));

    expect(await screen.findByText("Coordinator tools")).toBeTruthy();
    expect(auth.signIn).toHaveBeenCalledWith("a-google-id-token");
  });
});
