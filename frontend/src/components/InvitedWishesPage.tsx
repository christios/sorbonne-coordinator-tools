import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarHeart, Check, CheckCircle2, Loader2, Lock, LogOut, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { CourseScheduleStep, CourseScheduleSummary, type CourseLayouts } from "@/components/CourseScheduleStep";
import { ReductionsStep, ReductionsSummary } from "@/components/ReductionsStep";
import { MicrosoftButton } from "@/components/MicrosoftButton";
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
  openSharedHere,
  saveInviteeAnswer,
  saveInviteeCoursePlans,
  saveInviteeReductions,
  signInInvitee,
  signOutInvitee,
  type InviteeForm,
} from "@/services/wishInvite";

/** The steps of the request: a full-timer's reductions, a course lead's courses, the form. */
type Step = "reductions" | "courses" | "preferences";

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
 * A course lead has one too, after it: the sessions of each course they lead, week by week.
 */
export function InvitedWishesPage({ code }: { code: string }) {
  const client = useQueryClient();
  const config = useQuery({ queryKey: ["sign-in-config"], queryFn: fetchSignInConfig, retry: false });
  const invitation = useQuery({
    queryKey: ["invitation", code],
    queryFn: () => fetchInvitation(code),
    retry: false,
  });
  const signedIn = invitation.data?.signedIn === true;
  const form = useQuery({ queryKey: ["invitee-form", code], queryFn: () => fetchInviteeForm(code), enabled: signedIn, retry: false });
  const [editing, setEditing] = useState(false);
  const [startFrom, setStartFrom] = useState<Wishes | null>(null);
  const [saved, setSaved] = useState<"" | "draft" | "submitted">("");
  // The steps before the form (a full-timer's, a course lead's); null until they choose, when
  // the page decides where they land.
  const [step, setStep] = useState<Step | null>(null);
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
  const signIn = useMutation({
    mutationFn: ({ credential, provider }: { credential: string; provider: "google" | "microsoft" }) =>
      signInInvitee(code, credential, provider),
    onSuccess: showForm,
  });
  // Microsoft's popup, closed or blocked, says so here; its token goes the same way as Google's.
  const [microsoftTrouble, setMicrosoftTrouble] = useState("");
  const signOut = useMutation({
    mutationFn: () => signOutInvitee(code),
    onSuccess: () => {
      dirty.current = false;
      client.removeQueries({ queryKey: ["invitee-form", code] });
      client.setQueryData(["invitation", code], (current: unknown) => (current ? { ...(current as object), signedIn: false } : current));
      // By the shared link, where this browser stands now comes from the server: nobody, signed out.
      void client.invalidateQueries({ queryKey: ["invitation", code] });
    },
  });
  const declare = useMutation({
    mutationFn: ({ items, note }: { items: Parameters<typeof saveInviteeReductions>[1]; note: string }) =>
      saveInviteeReductions(code, items, note),
    onSuccess: (data) => {
      client.setQueryData(["invitee-form", code], data);
      setStep(data.coursePlans ? "courses" : "preferences");
    },
  });
  const layOut = useMutation({
    mutationFn: (courses: CourseLayouts) => saveInviteeCoursePlans(code, courses),
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
  // A personal Microsoft account, beside Google, once the application is registered with Microsoft.
  const microsoftId = config.data?.microsoftClientId ?? "";
  if (!signedIn) {
    return (
      <Frame>
        <p className="text-base font-semibold text-[#171717]">{invite.shared ? "Hello," : `Hello ${invite.teacherName},`}</p>
        <p className="mt-2 text-sm leading-6 text-[#475467]">
          Please tell us when you can&rsquo;t teach{invite.semesterName ? ` in ${invite.semesterName}` : ""}, when you&rsquo;d rather
          not, and what matters most to you. We use your answer while we build the timetable.
        </p>
        {invite.message ? <p className="mt-3 whitespace-pre-line rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">{invite.message}</p> : null}
        {invite.deadline ? <p className="mt-3 text-sm text-[#344054]">Please answer by <b>{day(invite.deadline)}</b>.</p> : null}
        <p className="mt-5 text-sm text-[#475467]">
          {invite.shared ? (
            // The semester's shared link names nobody: the address signed in with says whose form it is.
            <>Sign in with the account whose address you gave the coordinator. It opens your own form, and only yours.</>
          ) : (
            <>
              Sign in with the account this invitation was sent to: <b className="text-[#171717]">{invite.email}</b>. Only you can
              open your answer.
            </>
          )}
          {microsoftId ? " Use Google for a Gmail address, Microsoft for an Outlook or Hotmail one." : ""}
        </p>
        {config.data?.configured && config.data.clientId ? (
          <GoogleButton clientId={config.data.clientId} onCredential={(credential) => signIn.mutate({ credential, provider: "google" })} />
        ) : (
          <p role="alert" className="mt-4 text-sm text-[#a6292f]">
            Sign-in is not available right now. Please try again later.
          </p>
        )}
        {microsoftId ? (
          <>
            <p className="my-3 text-center text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">or</p>
            <MicrosoftButton
              clientId={microsoftId}
              onCredential={(credential) => signIn.mutate({ credential, provider: "microsoft" })}
              onError={setMicrosoftTrouble}
            />
          </>
        ) : null}
        {microsoftTrouble ? (
          <p role="alert" className="mt-3 text-center text-sm text-[#a6292f]">
            {microsoftTrouble}
          </p>
        ) : null}
        {signIn.isPending ? <p className="mt-3 text-center text-sm text-[#667085]">Signing you in…</p> : null}
        {import.meta.env.DEV && invite.shared ? (
          <LocalSharedSignIn code={code} onSignedIn={() => void invitation.refetch()} />
        ) : import.meta.env.DEV ? (
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
  const courses = data.coursePlans ?? null;
  const coursesDone = !courses || courses.courses.every((course) => course.answeredAt);
  // The steps this teacher has: a full-timer's hour reductions, a course lead's courses, then the form.
  const steps: [Step, string][] = [];
  if (reductions) steps.push(["reductions", "Hour reductions"]);
  if (courses) steps.push(["courses", courses.courses.length > 1 ? "Course schedules" : "Course schedule"]);
  steps.push(["preferences", "Preferences and constraints"]);
  // Where they are: the first step they have not been through, until they choose one.
  const onStep: Step =
    step && steps.some(([key]) => key === step)
      ? step
      : reductions && !reductions.declaredAt
        ? "reductions"
        : !coursesDone
          ? "courses"
          : "preferences";
  const answering = Boolean(collection) && open.open && (editing || !data.wishes || data.wishes.status === "draft");
  if (answering && onStep === "preferences" && !formShown) setFormShown(true);
  // Back into the form, from wherever the button was: the thank-you, or the corner of the page.
  const changeAnswer = () => {
    setSaved("");
    setEditing(true);
    document.querySelector("main")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };
  // Straight to the course step, from wherever the page says it is still to do.
  const layOutCourses = () => {
    changeAnswer();
    setStep("courses");
  };
  // The answer as sent, while it can still change: "Change my answer" floats at the foot of the
  // window, where the Guided tour button sits while answering (18 Nov 2026).
  const canChange = Boolean(collection) && open.open && Boolean(data.wishes) && !answering;
  return (
    <Frame wide>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eef1f5] pb-4">
        <div>
          <p className="text-base font-semibold text-[#171717]">
            {data.teacherName}
            {data.semesterName ? <span className="font-normal text-[#667085]"> · {data.semesterName}</span> : null}
          </p>
          {/*
            * Until when the answer can change, as a badge rather than a grey line under the name
            * (18 Nov 2026: it was read past). Blue while open, the date in bold; red once closed.
            */}
          <p
            data-answer-window={open.open ? "open" : "closed"}
            className={`mt-2 inline-flex items-start gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium sm:items-center ${
              open.open ? "border-[#9fb6cf] bg-[#eef4fa] text-[#1f4e79]" : "border-[#e5b7b9] bg-[#fdf3f3] text-[#a6292f]"
            }`}
          >
            {open.open ? (
              <CalendarClock size={16} className="mt-0.5 shrink-0 sm:mt-0" aria-hidden="true" />
            ) : (
              <Lock size={16} className="mt-0.5 shrink-0 sm:mt-0" aria-hidden="true" />
            )}
            <span>
              {!open.open ? (
                <>
                  <b>The deadline has passed:</b> your answer can no longer be changed here. Write to the coordinator if
                  something has changed.
                </>
              ) : answerBy ? (
                <>
                  You can change your answer until <b className="font-bold">{day(answerBy)}</b>.
                </>
              ) : (
                "You can change your answer at any time while preferences are collected."
              )}
            </span>
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
          <p className="mt-2 text-base font-semibold text-[#1f5c3d] sm:text-lg">
            Your answer is submitted.{coursesDone ? " You\u2019re all done." : ""}
          </p>
          {coursesDone ? (
            <p className="mt-1 text-sm text-[#2e7d55]">The coordinator has it. There is nothing more to do: you can close this page.</p>
          ) : open.open ? (
            <CoursesStillOpen many={(courses?.courses.length ?? 0) > 1} onOpen={layOutCourses} />
          ) : null}
          {open.open ? (
            <div className="mt-5 flex flex-col items-center gap-2">
              <p className="text-sm text-[#475467]">Something changed?{answerBy ? ` You can change it until ${day(answerBy)}.` : ""}</p>
              <button
                type="button"
                onClick={changeAnswer}
                className="inline-flex items-center gap-2 rounded-md border border-[#1f4e79] bg-white px-4 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#eef4fa]"
              >
                <Pencil size={15} aria-hidden="true" /> Change my answer
              </button>
            </div>
          ) : null}
        </section>
      ) : data.wishes?.status === "submitted" && !editing && !answering ? (
        // Back another day, the answer given: said first, so the page is not read as a form still to fill.
        coursesDone || !open.open ? (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-md bg-[#e7f4ec] px-3 py-2 text-sm font-semibold text-[#1f5c3d]">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> Your answer is submitted: nothing more to do.
          </p>
        ) : (
          // Made a course lead after answering, or skipped the step: the one thing still to do.
          <div role="status" className="mt-4 rounded-md bg-[#fdf6e3] px-3 py-2">
            <CoursesStillOpen many={(courses?.courses.length ?? 0) > 1} onOpen={layOutCourses} />
          </div>
        )
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
            {steps.length > 1 ? (
              <nav aria-label="Steps" className="mb-5 flex flex-wrap gap-2">
                {steps.map(([key, label], index) => [key, String(index + 1), label] as const).map(([key, number, label]) => (
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
                next={courses ? "your course schedule" : "your preferences"}
                // Not declared yet is allowed: the Head of Department's page says who has not.
                onSkip={reductions.declaredAt ? undefined : () => setStep(courses ? "courses" : "preferences")}
              />
            ) : null}
            {courses && onStep === "courses" ? (
              <CourseScheduleStep
                key={courses.courses.map((course) => course.answeredAt).join("|")}
                step={courses}
                semesterName={data.semesterName}
                busy={layOut.isPending}
                error={layOut.isError ? (layOut.error as Error).message : ""}
                onSave={(laid) => layOut.mutate(laid)}
                // Not laid out yet is allowed: the coordinators' page says whose course is waiting.
                onSkip={coursesDone ? undefined : () => setStep("preferences")}
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
                          changeAnswer();
                          setStep("reductions");
                        }
                      : undefined
                  }
                />
              </div>
            ) : null}
            {courses ? (
              <div className="mb-4">
                <CourseScheduleSummary
                  step={courses}
                  onChange={
                    open.open
                      ? () => {
                          changeAnswer();
                          setStep("courses");
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
            />
          </>
        ) : (
          <p className="text-sm text-[#667085]">The deadline has passed and no answer was given. Write to the coordinator.</p>
        )}
      </div>
      {/* Room under the answer, so the floating button never hides its last line. */}
      {canChange ? <div aria-hidden="true" className="h-14" /> : null}
      {canChange
        ? createPortal(
            <button
              type="button"
              data-change-answer
              onClick={changeAnswer}
              className="fixed bottom-4 right-4 z-[92] inline-flex items-center gap-2 rounded-full bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_20px_rgba(16,24,40,0.25)] hover:bg-[#173d5f] sm:bottom-6 sm:right-6"
            >
              <Pencil size={16} aria-hidden="true" /> Change my answer
            </button>,
            document.body,
          )
        : null}
    </Frame>
  );
}

/** A course lead's step not done yet, said where the page would otherwise say they are done. */
function CoursesStillOpen({ many, onOpen }: { many: boolean; onOpen: () => void }) {
  return (
    <p className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-semibold text-[#8a6116]">
      <span>One thing is left: lay out {many ? "the courses you lead" : "the course you lead"} week by week.</span>
      <button type="button" onClick={onOpen} className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white">
        {many ? "Lay out my courses" : "Lay out my course"}
      </button>
    </p>
  );
}

/** The local copy only, by a shared link: sign in as an address, as Google would say it. */
function LocalSharedSignIn({ code, onSignedIn }: { code: string; onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const open = useMutation({ mutationFn: () => openSharedHere(code, email), onSuccess: onSignedIn });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        open.mutate();
      }}
      className="mx-auto mt-4 grid max-w-sm gap-1 rounded-md border border-dashed border-[#d99b1c] px-2 py-1.5"
    >
      <span className="flex items-center gap-2">
        <input
          aria-label="Sign in as (local copy only)"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="someone@gmail.com"
          className="min-w-0 flex-1 rounded border border-[#e5c27a] px-2 py-1 text-xs"
        />
        <button type="submit" className="whitespace-nowrap text-xs font-semibold text-[#8a6116]">
          Sign in as (local copy only)
        </button>
      </span>
      {open.isError ? <span className="text-xs text-[#a6292f]">{(open.error as Error).message}</span> : null}
    </form>
  );
}
