import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { inviteTeacher, invitationLink, type WishCollection, type WishTeacher } from "@/services/teacherWishes";

/** "10 January 2027". */
const day = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

/** A Google address, as far as an address can say: Gmail's, or one the teacher says is a Google account. */
const looksLikeGmail = (email: string) => /@(gmail|googlemail)\.com$/i.test(email.trim());

/** The invitation as the email says it: to the teacher, from the coordinator, with their link. */
export function invitationEmail({
  teacherName,
  semesterName,
  collection,
  link,
  email,
  sender,
}: {
  teacherName: string;
  semesterName: string;
  collection: WishCollection;
  link: string;
  email: string;
  sender: string;
}): { subject: string; body: string } {
  const first = teacherName.split(/\s+/)[0] || teacherName;
  return {
    subject: `Timetable preferences and constraints request: ${semesterName}`,
    body: [
      `Dear ${first},`,
      "",
      `Please fill in the timetable preferences and constraints request for ${semesterName}: when you can and can't teach, any time away, and what matters most to you, so that we can take it into account while we build the timetable.`,
      ...(collection.message.trim() ? ["", collection.message.trim()] : []),
      "",
      `Your link: ${link}`,
      "",
      `Sign in with your Google account ${email}: the link opens your form and nothing else, and only for that account.${
        collection.deadline ? ` Please answer by ${day(collection.deadline)}; you can change your answer until then.` : ""
      }`,
      "",
      "Thank you,",
      sender,
    ].join("\n"),
  };
}

/**
 * Invite one teacher to give their wishes themselves.
 *
 * First the Google address they will sign in with; then the invitation, ready to send from
 * the coordinator's own mailbox — the email written, the link in it. The link is shown only
 * here: the server keeps no copy of it, so a lost link is replaced by a new one, which stops
 * the old one working.
 */
export function InviteDialog({
  term,
  semesterName,
  teacher,
  collection,
  sender,
  onClose,
  onInvited,
}: {
  term: string;
  semesterName: string;
  teacher: WishTeacher;
  collection: WishCollection;
  sender: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState(teacher.invitation?.email ?? (looksLikeGmail(teacher.email) ? teacher.email : ""));
  const [copied, setCopied] = useState<"" | "link" | "email">("");
  const invite = useMutation({
    mutationFn: () => inviteTeacher(term, teacher.teacherId, email.trim()),
    onSuccess: onInvited,
  });
  const made = invite.data;
  const link = made ? invitationLink(made.code) : "";
  const message = made
    ? invitationEmail({ teacherName: teacher.name, semesterName, collection, link, email: made.invitation.email, sender })
    : null;
  const copy = (what: "link" | "email", words: string) => {
    void navigator.clipboard?.writeText(words);
    setCopied(what);
  };

  return (
    <Modal
      open
      title={`Invite ${teacher.name}`}
      description={`To give their timetable preferences and constraints for ${semesterName} themselves.`}
      onClose={onClose}
    >
      {!made ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          {teacher.invitation ? (
            <p role="note" className="rounded-md bg-[#fdf6e3] px-3 py-2 text-sm text-[#7a5d00]">
              {teacher.name} was invited already, at {teacher.invitation.email}. A new invitation makes a new link, and the old
              one stops working.
            </p>
          ) : null}
          <label className="grid gap-1">
            <span className="text-sm font-medium text-[#344054]">Their Google account</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="someone@gmail.com"
              autoFocus
              className="w-full rounded-md border border-[#d0d5dd] px-3 py-2 text-sm"
            />
            <span className="text-xs text-[#667085]">
              They sign in with this account to open their form, and only this one opens it.
            </span>
          </label>
          {invite.isError ? (
            <p role="alert" className="text-sm text-[#a6292f]">
              {(invite.error as Error).message}
            </p>
          ) : null}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!email.trim() || invite.isPending}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {invite.isPending ? "Making it…" : teacher.invitation ? "Make a new invitation" : "Make the invitation"}
            </button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4">
          <p className="text-sm text-[#344054]">
            The invitation for <b>{teacher.name}</b> is ready. Send it from your own mailbox:
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={`mailto:${encodeURIComponent(made.invitation.email)}?subject=${encodeURIComponent(message!.subject)}&body=${encodeURIComponent(message!.body)}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
            >
              <Mail size={15} aria-hidden="true" /> Email the invitation
            </a>
            <button
              type="button"
              onClick={() => copy("email", `${message!.subject}\n\n${message!.body}`)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
            >
              {copied === "email" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} Copy the email
            </button>
            <button
              type="button"
              onClick={() => copy("link", link)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
            >
              {copied === "link" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} Copy the link
            </button>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-[#f8fafc] px-3 py-2 font-sans text-xs leading-5 text-[#475467]">
            {`To: ${made.invitation.email}\nSubject: ${message!.subject}\n\n${message!.body}`}
          </pre>
          <p className="text-xs text-[#667085]">
            The link is shown only now, and is kept nowhere else. If it is lost, make a new invitation: the old link stops
            working.
          </p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
