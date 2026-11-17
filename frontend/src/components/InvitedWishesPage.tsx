import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Check, CheckCircle2, Loader2, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ReductionsStep, ReductionsSummary } from "@/components/ReductionsStep";
import { GoogleButton } from "@/components/SignInGate";
import { WishesForm } from "@/components/WishesForm";
import { WishesSummary } from "@/components/WishesSummary";
import { fetchSignInConfig } from "@/services/auth";
import type { Wishes, WishesInput } from "@/services/teacherWishes";
import {
  InviteRefused,
  fetchInvitation,
  fetchInviteeForm,
  openAsInviteeHere,
  saveInviteeAnswer,
  saveInviteeReductions,
  signInInvitee,
  signOutInvitee,
  type InviteeForm,
} from "@/services/wishInvite";

/** "10 January 2027". */
const day = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

/** The page's frame: the university's name over a card, and nothing of the coordinators' app. */
function Frame({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main className="min-h-screen bg-[#f7f8fa] px-3 py-6 sm:px-4 sm:py-12">
      <div className={`mx-auto ${wide ? "max-w-5xl" : "max-w-lg"}`}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#a6292f]">Sorbonne University Abu Dhabi</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[#171717] sm:text-xl">
            <CalendarHeart size={20} className="text-[#1f4e79]" aria-hidden="true" /> Timetable preferences and constraints request
          </h1>
        </div>
        <div className="mt-5 rounded-xl border border-[#d9dee7] bg-white p-3.5 shadow-sm sm:p-7">{children}</div>
      </div>
    </main>
  );
}

/**
 * An invited teacher's own page: the link a coordinator emailed them, opened.
 *
 * Signed out, it says what the link is for and asks for the Google account it was sent to.
 * Signed in, it is their wishes for the semester and nothing else: the form until the
 * deadline (or until the coordinator reopened it for them), and after it their answer to read.
 * A teacher with an answer from another semester may start from it.
 *
 * A full-timer has a first step before the form: their hour reductions for the year. They land
 * on it until they have saved it once, and may skip it for now; afterwards it is one click back.
 */
export function InvitedWishesPage({ code }: { code: string }) {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["sign-in-config"], queryFn: fetchSignInConfig, retry: false });
  const invitation = useQuery({ queryKey: ["invitation", code], queryFn: () => fetchInvitation(code), retry: false });
  const signedIn = invitation.data?.signedIn === true;
  const form = useQuery({ queryKey: ["invitee-form", code], queryFn: () => fetchInviteeForm(code), enabled: signedIn, retry: false });
  const [editing, setEditing] = useState(false);
  const [startFrom, setStartFrom] = useState<Wishes | null>(null);
  const [saved, setSaved] = useState<"" | "draft" | "submitted">("");
  // A full-timer's two steps; null until they choose, when the page decides where they land.
  const [step, setStep] = useState<"reductions" | "preferences" | null>(null);
  // The form, once opened, stays mounted when they look back at step 1: nothing typed is lost.
  const [formShown, setFormShown] = useState(false);

  // The thank-you, brought into view once as it appears: Submit is at the foot of a long page.
  const showThanks = useCallback((node: HTMLElement | null) => node?.scrollIntoView?.({ behavior: "smooth", block: "center" }), []);

  // Leaving with changes not saved asks first, as the coordinators' window does.
  const dirty = useRef(false);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const showForm = (data: InviteeForm) => {
    client.setQueryData(["invitee-form", code], data);
    client.setQueryData(["invitation", code], (current: unknown) => (current ? { ...(current as object), signedIn: true } : current));
  };
  const signIn = useMutation({ mutationFn: (credential: string) => signInInvitee(code, credential), onSuccess: showForm });
  const signOut = useMutation({
    mutationFn: () => signOutInvitee(code),
    onSuccess: () => {
      dirty.current = false;
      client.removeQueries({ queryKey: ["invitee-form", code] });
      client.setQueryData(["invitation", code], (current: unknown) => (current ? { ...(current as object), signedIn: false } : current));
    },
  });
  const declare = useMutation({
    mutationFn: ({ items, note }: { items: Parameters<typeof saveInviteeReductions>[1]; note: string }) =>
      saveInviteeReductions(code, items, note),
    onSuccess: (data) => {
      client.setQueryData(["invitee-form", code], data);
      setStep("preferences");
    },
  });
  const save = useMutation({
    mutationFn: (input: WishesInput) => saveInviteeAnswer(code, input),
    onSuccess: (data, input) => {
      dirty.current = false;
      client.setQueryData(["invitee-form", code], data);
      setSaved(input.submit ? "submitted" : "draft");
      if (input.submit) setEditing(false);
    },
  });

  if (invitation.isLoading || config.isLoading) {
    return (
      <Frame>
        <p className="flex items-center gap-2 text-sm text-[#667085]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Opening your invitation…
        </p>
      </Frame>
    );
  }
  if (invitation.isError || !invitation.data) {
    const gone = invitation.error instanceof InviteRefused && invitation.error.status === 401;
    return (
      <Frame>
        <p className="text-base font-semibold text-[#171717]">{gone ? "This link no longer works" : "This page could not be opened"}</p>
        <p className="mt-2 text-sm text-[#475467]">{(invitation.error as Error | null)?.message}</p>
      </Frame>
    );
  }

  const invite = invitation.data;
  if (!signedIn) {
    return (
      <Frame>
        <p className="text-base font-semibold text-[#171717]">Hello {invite.teacherName},</p>
        <p className="mt-2 text-sm leading-6 text-[#475467]">
          Please tell us when you can&rsquo;t teach{invite.semesterName ? ` in ${invite.semesterName}` : ""}, when you&rsquo;d rather
          not, and what matters most to you. We use your answer while we build the timetable.
        </p>
        {invite.message ? <p className="mt-3 whitespace-pre-line rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">{invite.message}</p> : null}
        {invite.deadline ? <p className="mt-3 text-sm text-[#344054]">Please answer by <b>{day(invite.deadline)}</b>.</p> : null}
        <p className="mt-5 text-sm text-[#475467]">
          Sign in with the Google account this invitation was sent to: <b className="text-[#171717]">{invite.email}</b>. Only
          you can open your answer.
        </p>
        {config.data?.configured && config.data.clientId ? (
          <GoogleButton clientId={config.data.clientId} onCredential={(credential) => signIn.mutate(credential)} />
        ) : (
          <p role="alert" className="mt-4 text-sm text-[#a6292f]">
            Sign-in is not available right now. Please try again later.
          </p>
        )}
        {signIn.isPending ? <p className="mt-3 text-center text-sm text-[#667085]">Signing you in…</p> : null}
        {import.meta.env.DEV ? (
          // The local copy only: Google's sign-in does not finish on a developer's address.
          <button
            type="button"
            onClick={() => void openAsInviteeHere(code).then(() => invitation.refetch())}
            className="mx-auto mt-4 block rounded-md border border-dashed border-[#d99b1c] px-3 py-1.5 text-xs font-semibold text-[#8a6116]"
          >
            Open as this teacher (local copy only)
          </button>
        ) : null}
        {signIn.isError ? (
          <p role="alert" className="mt-3 text-center text-sm text-[#a6292f]">
            {(signIn.error as Error).message}
          </p>
        ) : null}
      </Frame>
    );
  }

  if (form.isLoading || !form.data) {
    return (
      <Frame>
        {form.isError ? (
          <p role="alert" className="text-sm text-[#a6292f]">{(form.error as Error).message}</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-[#667085]">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Reading your answer…
          </p>
        )}
      </Frame>
    );
  }

  const data = form.data;
  const { collection, window: open } = data;
  const answerBy = open.reopenedUntil && open.deadline && open.reopenedUntil > open.deadline ? open.reopenedUntil : open.deadline;
  const reductions = data.reductions ?? null;
  // Where a full-timer is: step 1 until they have been through it, then wherever they chose.
  const onStep = !reductions ? "preferences" : (step ?? (reductions.declaredAt ? "preferences" : "reductions"));
  const answering = Boolean(collection) && open.open && (editing || !data.wishes || data.wishes.status === "draft");
  if (answering && onStep === "preferences" && !formShown) setFormShown(true);
  return (
    <Frame wide>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eef1f5] pb-4">
        <div>
          <p className="text-base font-semibold text-[#171717]">
            {data.teacherName}
            {data.semesterName ? <span className="font-normal text-[#667085]"> · {data.semesterName}</span> : null}
          </p>
          <p className="mt-1 text-sm text-[#667085]">
            {!open.open
              ? "The deadline has passed: your answer can no longer be changed here. Write to the coordinator if something has changed."
              : answerBy
                ? `You can change your answer until ${day(answerBy)}.`
                : "You can change your answer at any time while preferences are collected."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut.mutate()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-[#667085] hover:bg-[#f2f4f7] hover:text-[#344054]"
        >
          <LogOut size={13} aria-hidden="true" /> Sign out ({data.email})
        </button>
      </div>
      {collection?.message ? <p className="mt-4 whitespace-pre-line text-sm text-[#475467]">{collection.message}</p> : null}

      {saved === "submitted" && !editing ? (
        /*
         * The end, and plainly so (17 Nov 2026): a line in green was read past, and teachers did not
         * know they were done. A large thank-you, that nothing is left to do, and that the page can close.
         */
        <section ref={showThanks} role="status" data-submitted className="mt-5 rounded-xl border border-[#a7d7b8] bg-[#eef8f1] px-5 py-7 text-center sm:px-10 sm:py-9">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#2e7d55] text-white shadow-sm">
            <Check size={36} strokeWidth={3} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold text-[#14532d] sm:text-3xl">Thank you, {data.teacherName}!</h2>
          <p className="mt-2 text-base font-semibold text-[#1f5c3d] sm:text-lg">Your answer is submitted. You&rsquo;re all done.</p>
          <p className="mt-1 text-sm text-[#2e7d55]">The coordinator has it. There is nothing more to do: you can close this page.</p>
          {open.open && answerBy ? (
            <p className="mx-auto mt-4 max-w-md text-sm text-[#475467]">
              Something changed? Press <b>Change my answer</b> below, until {day(answerBy)}.
            </p>
          ) : null}
        </section>
      ) : data.wishes?.status === "submitted" && !editing && !answering ? (
        // Back another day, the answer given: said first, so the page is not read as a form still to fill.
        <p role="status" className="mt-4 flex items-start gap-2 rounded-md bg-[#e7f4ec] px-3 py-2 text-sm font-semibold text-[#1f5c3d]">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> Your answer is submitted: nothing more to do.
        </p>
      ) : null}
      {saved === "draft" ? (
        <p role="status" className="mt-4 rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">
          Saved as a draft. Submit when you&rsquo;re done; until then the coordinators see it as a draft.
        </p>
      ) : null}

      <div className="mt-5">
        {!collection ? (
          <p className="text-sm text-[#667085]">Preferences are not being collected for this semester any more.</p>
        ) : answering ? (
          <>
            {reductions ? (
              <nav aria-label="Steps" className="mb-5 flex flex-wrap gap-2">
                {(
                  [
                    ["reductions", "1", "Hour reductions"],
                    ["preferences", "2", "Preferences and constraints"],
                  ] as const
                ).map(([key, number, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-current={onStep === key ? "step" : undefined}
                    onClick={() => setStep(key)}
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
                      onStep === key ? "border-[#1f4e79] bg-[#1f4e79] text-white" : "border-[#b7bec8] bg-white text-[#344054]"
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                        onStep === key ? "bg-white text-[#1f4e79]" : "bg-[#e4e7ec] text-[#344054]"
                      }`}
                    >
                      {number}
                    </span>
                    {label}
                  </button>
                ))}
              </nav>
            ) : null}
            {reductions && onStep === "reductions" ? (
              <ReductionsStep
                key={reductions.declaredAt}
                sheet={reductions}
                busy={declare.isPending}
                error={declare.isError ? (declare.error as Error).message : ""}
                onSave={(items, note) => declare.mutate({ items, note })}
                // Not declared yet is allowed: the Head of Department's page says who has not.
                onSkip={reductions.declaredAt ? undefined : () => setStep("preferences")}
              />
            ) : null}
            <div hidden={onStep !== "preferences"}>
              {formShown && !data.wishes && data.previous && !startFrom ? (
                <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">
                  <span className="flex-1">
                    You answered for {data.previous.semesterName || "another semester"} before. Start from that answer and change what&rsquo;s
                    different?
                  </span>
                  <button
                    type="button"
                    onClick={() => setStartFrom({ ...data.previous!.wishes, status: "draft" })}
                    className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Start from it
                  </button>
              </div>
            ) : null}
            {formShown ? (
            <WishesForm
              key={`${data.wishes?.updatedAt ?? ""}|${startFrom ? "previous" : "fresh"}`}
              collection={collection}
              calendar={data.calendar}
              inView={onStep === "preferences"}
              initial={data.wishes ?? startFrom}
              voice="you"
              busy={save.isPending}
              error={save.isError ? (save.error as Error).message : ""}
              onDirtyChange={(changed) => {
                dirty.current = changed;
              }}
              onSave={(input) => save.mutate(input)}
              // Back to the answer as submitted; a draft has nowhere else to go.
              onCancel={data.wishes?.status === "submitted" ? () => setEditing(false) : undefined}
            />
            ) : null}
            </div>
          </>
        ) : data.wishes ? (
          <>
            {saved === "submitted" ? <h3 className="mb-3 text-base font-semibold text-[#171717]">What you sent</h3> : null}
            {reductions ? (
              <div className="mb-4">
                <ReductionsSummary
                  sheet={reductions}
                  onChange={
                    open.open
                      ? () => {
                          setSaved("");
                          setEditing(true);
                          setStep("reductions");
                        }
                      : undefined
                  }
                />
              </div>
            ) : null}
            <WishesSummary
              name={data.teacherName}
              collection={collection}
              wishes={data.wishes}
              voice="you"
              editLabel="Change my answer"
              onEdit={
                open.open
                  ? () => {
                      setSaved("");
                      setEditing(true);
                    }
                  : undefined
              }
            />
          </>
        ) : (
          <p className="text-sm text-[#667085]">The deadline has passed and no answer was given. Write to the coordinator.</p>
        )}
      </div>
    </Frame>
  );
}
