import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Lock, Send, Undo2 } from "lucide-react";

import { SubmissionChecklist } from "@/components/SubmissionChecklist";
import { SyllabusStatusPill } from "@/components/SyllabusStatusPill";
import { useStaffUser } from "@/components/useStaffUser";
import { getSyllabusCompleteness, setSyllabusReview, setSyllabusVisibility, type Syllabus } from "@/services/syllabi";

/**
 * Who else may read this syllabus, and whether its author has asked for it to be looked at.
 *
 * Everybody sees what it is — the pill is the same word the library shows, so the two places
 * agree. Only whoever it belongs to can change it: its author, or the syllabus administrator
 * for the shared set the department wrote before anyone had their own.
 *
 * Since November 2026 a syllabus is submitted only once it says everything the template
 * requires: until then its author sees what is still to fill in, where the button would be.
 */
export function SyllabusSharing({
  syllabus,
  sections = [],
  onOpenSection,
}: {
  syllabus: Syllabus;
  sections?: Array<{ id: string; label: string }>;
  onOpenSection?: (section: string) => void;
}) {
  const client = useQueryClient();
  const user = useStaffUser();
  const mine = Boolean(syllabus.ownerEmail) && syllabus.ownerEmail === user?.email;
  // The shared set is the syllabus administrator's to publish. The rules have always allowed
  // it; not offering it here only hid it.
  const curator = Boolean(user?.isAdmin) || user?.apps?.syllabus === "admin";
  const shared = !syllabus.ownerEmail;
  const decides = mine || (shared && curator);
  // There is nobody to submit a departmental syllabus on behalf of: whoever could read the
  // request is already the one reading it.
  const offersReview = decides && syllabus.visibility !== "public" && !shared;
  // Asked again whenever a save changes the syllabus: the list answers for the saved version.
  const completeness = useQuery({
    queryKey: ["syllabus-completeness", syllabus.id, syllabus.revision],
    queryFn: () => getSyllabusCompleteness(syllabus.id),
    enabled: offersReview && !syllabus.submittedAt,
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["syllabi"] });
    void client.invalidateQueries({ queryKey: ["syllabus", syllabus.id] });
    void client.invalidateQueries({ queryKey: ["syllabus-completeness", syllabus.id] });
  };
  const publish = useMutation({
    mutationFn: (visibility: "private" | "public") => setSyllabusVisibility(syllabus.id, visibility),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (submitted: boolean) => setSyllabusReview(syllabus.id, submitted),
    onSuccess: refresh,
    // Refused because something went missing since the list was last asked: ask again.
    onError: () => void client.invalidateQueries({ queryKey: ["syllabus-completeness", syllabus.id] }),
  });
  const busy = publish.isPending || review.isPending;

  if (!decides) return <SyllabusStatusPill syllabus={syllabus} />;

  const button =
    "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60";
  const missing = completeness.data?.missing ?? [];
  return (
    <>
      <SyllabusStatusPill syllabus={syllabus} />
      {/* Publishing and asking for a review are different things: one opens it to everybody,
          the other to a coordinator only, and a syllabus can want the second without the first. */}
      <button
        type="button"
        disabled={busy}
        onClick={() => publish.mutate(syllabus.visibility === "public" ? "private" : "public")}
        className={button}
      >
        {busy ? <Loader2 className="animate-spin" size={17} /> : syllabus.visibility === "public" ? <Lock size={17} /> : <Eye size={17} />}
        {syllabus.visibility === "public" ? "Make private" : "Publish"}
      </button>
      {!offersReview ? null : !syllabus.submittedAt && missing.length ? (
        <SubmissionChecklist missing={missing} sections={sections} onOpenSection={onOpenSection} />
      ) : (
        <button
          type="button"
          disabled={busy || (!syllabus.submittedAt && !completeness.data)}
          onClick={() => review.mutate(!syllabus.submittedAt)}
          className={button}
        >
          {syllabus.submittedAt ? <Undo2 size={17} /> : <Send size={17} />}
          {syllabus.submittedAt ? "Withdraw from review" : "Submit for review"}
        </button>
      )}
      {review.isError ? (
        <span role="alert" className="text-sm font-medium text-[#a6292f]">
          {review.error instanceof Error ? review.error.message : "Could not submit — please try again."}
        </span>
      ) : null}
    </>
  );
}
