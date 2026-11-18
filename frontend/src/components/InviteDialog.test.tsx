import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InviteDialog } from "@/components/InviteDialog";
import * as wishes from "@/services/teacherWishes";

const COLLECTION: wishes.WishCollection = {
  termCode: "262720", deadline: "2027-01-10", message: "", days: [1, 2, 3, 4, 5], firstHour: 8, lastHour: 19,
  mustQuota: 3, cantCap: 12, openedAt: "", openedBy: "",
};

describe("inviting a teacher", () => {
  it("takes their Google address, then hands over the email ready to send, link and all", async () => {
    const invite = vi.spyOn(wishes, "inviteTeacher").mockResolvedValue({
      code: "abc123",
      invitation: { email: "joumana.rifai@gmail.com", createdAt: "", createdBy: "", openedAt: "", signedInAt: "" },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InviteDialog
          term="262720"
          semesterName="Semester 2 2026-27"
          teacher={{ teacherId: "t-joumana", name: "Joumana El Rifai", email: "joumana.rifai@gmail.com", wishes: null }}
          collection={COLLECTION}
          sender="Christian"
          onClose={() => {}}
          onInvited={() => {}}
        />
      </QueryClientProvider>,
    );
    // A Gmail address on their record is the one offered.
    expect((screen.getByRole("textbox", { name: /Their Google or Microsoft account/ }) as HTMLInputElement).value).toBe(
      "joumana.rifai@gmail.com",
    );
    fireEvent.click(screen.getByRole("button", { name: "Make the invitation" }));
    const email = await screen.findByRole("link", { name: "Email the invitation" });
    expect(invite).toHaveBeenCalledWith("262720", "t-joumana", "joumana.rifai@gmail.com");
    const href = decodeURIComponent(email.getAttribute("href") ?? "");
    expect(href.startsWith("mailto:joumana.rifai@gmail.com?subject=Timetable preferences and constraints request: Semester 2 2026-27")).toBe(true);
    expect(href).toContain(`${window.location.origin}/preferences/abc123`);
    expect(href).toContain("Dear Joumana,");
    expect(href).toContain("Sign in with your Google account joumana.rifai@gmail.com");
    expect(href).toContain("Christian");
  });

  it("takes a personal Outlook address too, and the email says to sign in with Microsoft", async () => {
    const invite = vi.spyOn(wishes, "inviteTeacher").mockResolvedValue({
      code: "abc123",
      invitation: { email: "prof.someone@outlook.com", createdAt: "", createdBy: "", openedAt: "", signedInAt: "" },
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <InviteDialog
          term="262720"
          semesterName="Semester 2 2026-27"
          teacher={{ teacherId: "t-prof", name: "Prof Someone", email: "prof.someone@sorbonne.ae", wishes: null }}
          collection={COLLECTION}
          sender="Christian"
          onClose={() => {}}
          onInvited={() => {}}
        />
      </QueryClientProvider>,
    );
    // A university address is not one they sign in with here: nothing is offered.
    const box = screen.getByRole("textbox", { name: /Their Google or Microsoft account/ }) as HTMLInputElement;
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "prof.someone@outlook.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Make the invitation" }));
    const email = await screen.findByRole("link", { name: "Email the invitation" });
    expect(invite).toHaveBeenCalledWith("262720", "t-prof", "prof.someone@outlook.com");
    expect(decodeURIComponent(email.getAttribute("href") ?? "")).toContain("Sign in with your Microsoft account prof.someone@outlook.com");
  });
});
