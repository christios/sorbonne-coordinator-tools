import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Lock, Send, Undo2 } from "lucide-react";

import { useStaffUser } from "@/components/useStaffUser";
import { setSyllabusReview, setSyllabusVisibility, type Syllabus } from "@/services/syllabi";

/**
 * Who else may read this syllabus, and whether its author has asked for it to be looked at.
 *
 * Only its author decides either. A syllabus the department wrote before anyone had their own
 * belongs to nobody, and there is nothing here to decide about it.
 */
export function SyllabusSharing({ syllabus }: { syllabus: Syllabus }) {
  const client = useQueryClient();
  const user = useStaffUser();
  const mine = Boolean(syllabus.ownerEmail) && syllabus.ownerEmail === user?.email;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["syllabi"] });
    void client.invalidateQueries({ queryKey: ["syllabus", syllabus.id] });
  };
  const publish = useMutation({
    mutationFn: (visibility: "private" | "public") => setSyllabusVisibility(syllabus.id, visibility),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (submitted: boolean) => setSyllabusReview(syllabus.id, submitted),
    onSuccess: refresh,
  });
  const busy = publish.isPending || review.isPending;

  if (!syllabus.ownerEmail) return null;
  if (!mine) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-[#667085]">
        {syllabus.visibility === "public" ? <Eye size={16} /> : <Lock size={16} />}
        {syllabus.visibility === "public" ? "Published" : "Shared for review"}
      </span>
    );
  }

  const button =
    "inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-60";
  return (
    <>
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
      {syllabus.visibility === "public" ? null : (
        <button type="button" disabled={busy} onClick={() => review.mutate(!syllabus.submittedAt)} className={button}>
          {syllabus.submittedAt ? <Undo2 size={17} /> : <Send size={17} />}
          {syllabus.submittedAt ? "Withdraw from review" : "Submit for review"}
        </button>
      )}
      {syllabus.submittedAt ? (
        <span className="text-sm text-[#8a6116]">A coordinator can read this while it is up for review.</span>
      ) : null}
    </>
  );
}
