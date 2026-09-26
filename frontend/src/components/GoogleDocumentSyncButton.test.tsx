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
  return (await import("@/components/GoogleDocumentSyncButton")).GoogleDocumentSyncButton;
}

describe("GoogleDocumentSyncButton", () => {
  it("is one button, with no sign-in in front of it: the application's own sign-in is enough", async () => {
    const GoogleDocumentSyncButton = await importButton("client-id.apps.googleusercontent.com");

    render(<GoogleDocumentSyncButton onAccessToken={() => undefined} />);

    expect(screen.getByRole("button", { name: "Sync form responses" })).toBeTruthy();
    expect(screen.queryByLabelText("Sign in with Google")).toBeNull();
  });

  it("says so when the deployment has no client id", async () => {
    const GoogleDocumentSyncButton = await importButton("");

    render(<GoogleDocumentSyncButton onAccessToken={() => undefined} />);

    expect(screen.getByText("Document sync is not configured for this deployment.")).toBeTruthy();
  });
});
