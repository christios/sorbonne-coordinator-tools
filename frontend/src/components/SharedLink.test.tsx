import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { InvitedWishesPage } from "@/components/InvitedWishesPage";
import { SharedLinkDialog } from "@/components/SharedLink";
import * as auth from "@/services/auth";
import * as microsoft from "@/services/microsoftSignIn";
import * as wishes from "@/services/teacherWishes";
import * as invite from "@/services/wishInvite";

const COLLECTION: wishes.WishCollection = {
  termCode: "262720", deadline: "2026-11-20", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};
const SHARED: invite.Invitation = {
  shared: true,
  semesterName: "Semester 2 2026-27",
  teacherName: "",
  email: "",
  deadline: "2026-11-20",
  message: "",
  signedIn: false,
};

const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(auth, "fetchSignInConfig").mockResolvedValue({ configured: true, clientId: "google", microsoftClientId: "microsoft-app" });
});

describe("the semester's shared link, on the teacher's side", () => {
  it("names nobody, and asks for the account whose address the coordinator has", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue(SHARED);
    const form = vi.spyOn(invite, "fetchInviteeForm");
    wrap(<InvitedWishesPage code="shared-code" />);
    expect(await screen.findByText("Hello,")).toBeTruthy();
    expect(screen.getByText(/Sign in with the account whose address you gave the coordinator/)).toBeTruthy();
    expect(screen.getByTestId("google-sign-in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(form).not.toHaveBeenCalled();
  });

  it("says plainly when the address is not on the list, and opens nothing", async () => {
    vi.spyOn(invite, "fetchInvitation").mockResolvedValue(SHARED);
    vi.spyOn(microsoft, "signInWithMicrosoft").mockResolvedValue("microsoft-id-token");
    const refused =
      "someone@outlook.com is not on the list for Semester 2 2026-27. Sign in with the address you gave the coordinator, or write to them to add this one.";
    const signIn = vi.spyOn(invite, "signInInvitee").mockRejectedValue(new invite.InviteRefused(refused, 403));
    const form = vi.spyOn(invite, "fetchInviteeForm");
    wrap(<InvitedWishesPage code="shared-code" />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Microsoft" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith("shared-code", "microsoft-id-token", "microsoft"));
    expect((await screen.findByRole("alert")).textContent).toBe(refused);
    expect(form).not.toHaveBeenCalled();
  });
});

describe("the shared link, for the coordinator", () => {
  const dialog = (shareCode: string, onMade: () => void) => (
    <SharedLinkDialog
      term="262720"
      semesterName="Semester 2 2026-27"
      shareCode={shareCode}
      collection={COLLECTION}
      sender="Christian"
      onClose={() => {}}
      onMade={onMade}
    />
  );

  it("is made once, then copied with a message for every teacher", async () => {
    const make = vi.spyOn(wishes, "makeShareLink").mockResolvedValue({ shareCode: "the-shared-code" });
    const made = vi.fn();
    const client = new QueryClient();
    const { rerender } = render(<QueryClientProvider client={client}>{dialog("", made)}</QueryClientProvider>);
    expect(screen.getByText(/Any other address is refused and sees nothing/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Make the link" }));
    await waitFor(() => expect(make).toHaveBeenCalledWith("262720"));
    expect(made).toHaveBeenCalled();

    rerender(<QueryClientProvider client={client}>{dialog("the-shared-code", made)}</QueryClientProvider>);
    const link = `${window.location.origin}/preferences/the-shared-code`;
    expect(screen.getByTitle(link)).toBeTruthy();
    const message = screen.getByText(/Dear colleagues,/).textContent ?? "";
    expect(message).toContain(`The link: ${link}`);
    expect(message).toContain("Sign in with the Google or Microsoft (Outlook) account whose address you gave me.");
    expect(message).toContain("Please answer by November 20, 2026");
    expect(screen.getByRole("button", { name: "Copy a message for everyone" })).toBeTruthy();
  });
});
