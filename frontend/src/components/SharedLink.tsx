import { useMutation } from "@tanstack/react-query";
import { Ban, Check, Copy, Link2, Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { invitationLink, makeShareLink, type WishCollection } from "@/services/teacherWishes";

/** "10 January 2027". */
const day = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";

/** The message for every teacher, with the semester's one link, ready for Teams or one email to all. */
function sharedMessage({
  semesterName,
  collection,
  link,
  sender,
}: {
  semesterName: string;
  collection: WishCollection;
  link: string;
  sender: string;
}): string {
  return [
    "Dear colleagues,",
    "",
    `Please fill in the timetable preferences and constraints request for ${semesterName}: when you can't teach, when you'd rather not, any time away, and the limits that matter to you, so that we can take it into account while we build the timetable.`,
    ...(collection.message.trim() ? ["", collection.message.trim()] : []),
    "",
    `The link: ${link}`,
    "",
    `Sign in with the Google or Microsoft (Outlook) account whose address you gave me. If the page says your address is not on the list, write to me.${
      collection.deadline ? ` Please answer by ${day(collection.deadline)}; you can change your answer until then.` : ""
    }`,
    "",
    "Thank you,",
    sender,
  ].join("\n");
}

/**
 * The semester's one link for every teacher (18 Nov 2026): to copy, with a message for all,
 * and to make anew. It lets nobody in by itself — an address set for a teacher opens that
 * teacher's form; any other is refused. The coordinators keep the list.
 */
export function SharedLinkDialog({
  term,
  semesterName,
  shareCode,
  collection,
  sender,
  onClose,
  onMade,
}: {
  term: string;
  semesterName: string;
  shareCode: string;
  collection: WishCollection;
  sender: string;
  onClose: () => void;
  onMade: () => Promise<unknown> | void;
}) {
  const [copied, setCopied] = useState<"" | "link" | "message">("");
  const [renewing, setRenewing] = useState(false);
  const make = useMutation({
    mutationFn: () => makeShareLink(term),
    onSuccess: async () => {
      setRenewing(false);
      setCopied("");
      await onMade();
    },
  });
  const link = shareCode ? invitationLink(shareCode) : "";
  const message = link ? sharedMessage({ semesterName, collection, link, sender }) : "";
  const copy = (what: "link" | "message", words: string) => {
    void navigator.clipboard?.writeText(words);
    setCopied(what);
  };

  return (
    <Modal open title="One link for every teacher" description={`Post it once for ${semesterName}: in Teams, or in one email to all.`} onClose={onClose}>
      <div className="grid gap-4">
        <ul className="grid gap-1.5 text-sm text-[#344054]">
          <li className="flex gap-2">
            <Check size={16} className="mt-0.5 shrink-0 text-[#2e7d55]" aria-hidden="true" />
            <span>A teacher signs in with Google or Microsoft. The address you set for them opens their own form.</span>
          </li>
          <li className="flex gap-2">
            <Ban size={16} className="mt-0.5 shrink-0 text-[#a6292f]" aria-hidden="true" />
            <span>
              Any other address is refused and sees nothing. Set or change a teacher&rsquo;s address with <b>Invite</b> on their row.
            </span>
          </li>
        </ul>

        {!shareCode ? (
          <div className="flex justify-end">
            <button
              type="button"
              disabled={make.isPending}
              onClick={() => make.mutate()}
              className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {make.isPending ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
              Make the link
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 rounded-md border border-[#d0d5dd] bg-[#f8fafc] px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#344054]" title={link}>
                {link}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copy("link", link)}
                className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
              >
                {copied === "link" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} Copy the link
              </button>
              <button
                type="button"
                onClick={() => copy("message", message)}
                className="inline-flex items-center gap-2 rounded-md border border-[#1f4e79] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79]"
              >
                {copied === "message" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} Copy a message for everyone
              </button>
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[#f8fafc] px-3 py-2 font-sans text-xs leading-5 text-[#475467]">
              {message}
            </pre>
            {renewing ? (
              <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-[#fdf6e3] px-3 py-2 text-sm text-[#7a5410]">
                <span className="flex-1">A new link stops this one working. Anybody already let in keeps their form.</span>
                <button type="button" onClick={() => setRenewing(false)} className="font-semibold text-[#667085]">
                  Cancel
                </button>
                <button type="button" disabled={make.isPending} onClick={() => make.mutate()} className="font-semibold text-[#7a5410] underline">
                  Make a new link
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setRenewing(true)} className="inline-flex w-fit items-center gap-1.5 text-xs font-semibold text-[#667085] hover:text-[#344054]">
                <RefreshCw size={12} aria-hidden="true" /> Make a new link
              </button>
            )}
          </>
        )}
        {make.isError ? (
          <p role="alert" className="text-sm text-[#a6292f]">
            {(make.error as Error).message}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
