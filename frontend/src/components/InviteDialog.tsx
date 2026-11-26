import { useMutation } from "@tanstack/react-query";
import { Check, Copy, Mail } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Modal } from "@/components/Modal";
import {
  addPerson,
  inviteTeacher,
  invitationLink,
  type AddedPerson,
  type WishCollection,
  type WishInvitation,
  type WishTeacher,
} from "@/services/teacherWishes";

/** "10 January 2027". */
const day = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

/** A Google address, as far as an address can say: Gmail's, or one the teacher says is a Google account. */
const looksLikeGmail = (email: string) => /@(gmail|googlemail)\.com$/i.test(email.trim());
/** A personal Microsoft address: Outlook's, Hotmail's, Live's or MSN's, in any country. */
const looksLikeMicrosoft = (email: string) => /@(outlook|hotmail|live|msn)\.[a-z.]+$/i.test(email.trim());
/** How the invited teacher signs in, said for their address. */
const signInWith = (email: string) => (looksLikeMicrosoft(email) ? "Microsoft" : "Google");

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
      `Please fill in the timetable preferences and constraints request for ${semesterName}: when you can't teach, when you'd rather not, any time away, and the limits that matter to you, so that we can take it into account while we build the timetable.`,
      ...(collection.message.trim() ? ["", collection.message.trim()] : []),
      "",
      `Your link: ${link}`,
      "",
      `Sign in with your ${signInWith(email)} account ${email}: the link opens your form and nothing else, and only for that account.${
        collection.deadline ? ` Please answer by ${day(collection.deadline)}; you can change your answer until then.` : ""
      }`,
      "",
      "Thank you,",
      sender,
    ].join("\n"),
  };
}

/** The address field, said the same way wherever an invitation is made. */
function AddressField({ email, onChange, autoFocus }: { email: string; onChange: (email: string) => void; autoFocus?: boolean }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium text-[#344054]">Their Google or Microsoft account</span>
      <input
        type="email"
        value={email}
        onChange={(event) => onChange(event.target.value)}
        placeholder="someone@gmail.com or someone@outlook.com"
        autoFocus={autoFocus}
        className="w-full rounded-md border border-[#d0d5dd] px-3 py-2 text-sm"
      />
      <span className="text-xs text-[#667085]">
        A Gmail address, or a personal Outlook, Hotmail or Live one. They sign in with this account to open their form, and
        only this one opens it.
      </span>
    </label>
  );
}

/**
 * An invitation made, ready to send from the coordinator's own mailbox: the email written, the
 * link in it, each to copy. The link is shown only here, and kept nowhere else.
 */
function InvitationReady({
  name,
  semesterName,
  collection,
  sender,
  code,
  invitation,
  lead,
  onClose,
}: {
  name: string;
  semesterName: string;
  collection: WishCollection;
  sender: string;
  code: string;
  invitation: WishInvitation;
  lead?: ReactNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<"" | "link" | "email">("");
  const link = invitationLink(code);
  const message = invitationEmail({ teacherName: name, semesterName, collection, link, email: invitation.email, sender });
  const copy = (what: "link" | "email", words: string) => {
    void navigator.clipboard?.writeText(words);
    setCopied(what);
  };
  return (
    <div className="grid gap-4">
      {lead ?? (
        <p className="text-sm text-[#344054]">
          The invitation for <b>{name}</b> is ready. Send it from your own mailbox:
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={`mailto:${encodeURIComponent(invitation.email)}?subject=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.body)}`}
          className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
        >
          <Mail size={15} aria-hidden="true" /> Email the invitation
        </a>
        <button
          type="button"
          onClick={() => copy("email", `${message.subject}\n\n${message.body}`)}
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
        {`To: ${invitation.email}\nSubject: ${message.subject}\n\n${message.body}`}
      </pre>
      <p className="text-xs text-[#667085]">
        The link is shown only now, and is kept nowhere else. If it is lost, make a new invitation: the old link stops working.
      </p>
      <div className="flex justify-end">
        <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054]">
          Done
        </button>
      </div>
    </div>
  );
}

/** Cancel and the form's own button, at the foot of a dialog's form. */
function FormFoot({ busy, ready, words, busyWords, onClose }: { busy: boolean; ready: boolean; words: string; busyWords: string; onClose: () => void }) {
  return (
    <div className="flex justify-end gap-3">
      <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
        Cancel
      </button>
      <button
        type="submit"
        disabled={!ready || busy}
        className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
      >
        {busy ? busyWords : words}
      </button>
    </div>
  );
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
  const [email, setEmail] = useState(
    teacher.invitation?.email ?? (looksLikeGmail(teacher.email) || looksLikeMicrosoft(teacher.email) ? teacher.email : ""),
  );
  const invite = useMutation({
    mutationFn: () => inviteTeacher(term, teacher.teacherId, email.trim()),
    onSuccess: onInvited,
  });
  const made = invite.data;

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
          <AddressField email={email} onChange={setEmail} autoFocus />
          {invite.isError ? (
            <p role="alert" className="text-sm text-[#a6292f]">
              {(invite.error as Error).message}
            </p>
          ) : null}
          <FormFoot
            busy={invite.isPending}
            ready={Boolean(email.trim())}
            words={teacher.invitation ? "Make a new invitation" : "Make the invitation"}
            busyWords="Making it…"
            onClose={onClose}
          />
        </form>
      ) : (
        <InvitationReady
          name={teacher.name}
          semesterName={semesterName}
          collection={collection}
          sender={sender}
          code={made.code}
          invitation={made.invitation}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

/**
 * Put somebody on the semester's list who is on neither Active teachers nor the part-time
 * teachers list — a new hire, a candidate, somebody not in the portal yet (user, 26 Nov 2026).
 *
 * Their name and the address they sign in with; the invitation is made with them, so the
 * shared link opens their form at once, and their own link is ready to send. They give their
 * preferences and constraints alone: the hour reductions and the course schedule are for
 * teachers active in the semester. An address the department holds already puts that person
 * on the list as they are, and the dialog says so.
 */
export function AddPersonDialog({
  term,
  semesterName,
  collection,
  sender,
  onClose,
  onAdded,
}: {
  term: string;
  semesterName: string;
  collection: WishCollection;
  sender: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const add = useMutation({
    mutationFn: () => addPerson(term, name.trim(), email.trim()),
    onSuccess: onAdded,
  });
  const made: AddedPerson | undefined = add.data;

  return (
    <Modal
      open
      title="Add a person"
      description={`Somebody on neither Active teachers nor the part-time teachers list, to give their timetable preferences for ${semesterName}.`}
      onClose={onClose}
    >
      {!made ? (
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            add.mutate();
          }}
        >
          <p role="note" className="rounded-md bg-[#f2f7fb] px-3 py-2 text-sm text-[#344054]">
            A new hire, a candidate, or somebody not in the portal yet. They give their preferences and constraints only: no hour
            reductions and no course schedule, which are for teachers on Active teachers.
          </p>
          <label className="grid gap-1">
            <span className="text-sm font-medium text-[#344054]">Their name</span>
            <input
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="First name and surname"
              autoFocus
              className="w-full rounded-md border border-[#d0d5dd] px-3 py-2 text-sm"
            />
          </label>
          <AddressField email={email} onChange={setEmail} />
          {add.isError ? (
            <p role="alert" className="text-sm text-[#a6292f]">
              {(add.error as Error).message}
            </p>
          ) : null}
          <FormFoot busy={add.isPending} ready={Boolean(name.trim() && email.trim())} words="Add and invite" busyWords="Adding…" onClose={onClose} />
        </form>
      ) : (
        <InvitationReady
          name={made.name}
          semesterName={semesterName}
          collection={collection}
          sender={sender}
          code={made.code}
          invitation={made.invitation}
          onClose={onClose}
          lead={
            <p className="text-sm text-[#344054]">
              {made.existing ? (
                <>
                  That address is <b>{made.name}</b>&rsquo;s, whom the department has already: they&rsquo;re on the list now, as they are.
                </>
              ) : (
                <>
                  <b>{made.name}</b> is on the list.
                </>
              )}{" "}
              The shared link opens their form already. To send their own link, use your mailbox:
            </p>
          }
        />
      )}
    </Modal>
  );
}
