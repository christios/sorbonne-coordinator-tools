import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** The client id is read when the module loads, so stub it before importing. */
async function importButton(clientId: string) {
  vi.stubEnv("VITE_GOOGLE_DOCUMENTS_CLIENT_ID", clientId);
  vi.resetModules();
  return (await import("@/components/GoogleDocumentSignInButton")).GoogleDocumentSignInButton;
}

describe("GoogleDocumentSignInButton", () => {
  it("reserves the button's height so Google's personalised swap moves nothing", async () => {
    const GoogleDocumentSignInButton = await importButton("client-id.apps.googleusercontent.com");

    render(<GoogleDocumentSignInButton onCredential={() => undefined} />);

    // Until Google swaps in the "Sign in as …" button its wrapper is twice as tall, which
    // used to shove the documents card — and everything under it — up a frame later.
    expect(screen.getByLabelText("Sign in with Google").className).toContain("h-10");
  });

  it("says so when the deployment has no client id", async () => {
    const GoogleDocumentSignInButton = await importButton("");

    render(<GoogleDocumentSignInButton onCredential={() => undefined} />);

    expect(screen.getByText("Document sign-in is not configured for this deployment.")).toBeTruthy();
  });
});
