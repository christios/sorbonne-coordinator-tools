import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useStaffUser } from "@/components/useStaffUser";
import {
  deleteComment,
  fetchComments,
  postComment,
  type StudentComment,
} from "@/services/studentComments";

/** When a line was written, the way the rest of the record dates things. */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const same = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/**
 * One student's thread: what has been said, by whom and when, and a box to say more.
 *
 * The same component on the record and behind the row's icon, so there is one thread
 * however it is reached. Removing a line is offered only on one's own — the server
 * refuses anyone else's anyway, but a button that will be refused is a worse button than
 * none.
 */
export function CommentThread({
  studentId,
  label,
}: {
  studentId: string;
  label: string;
}) {
  const client = useQueryClient();
  const me = useStaffUser();
  const comments = useQuery({
    queryKey: ["comments", studentId],
    queryFn: () => fetchComments(studentId),
  });
  const [draft, setDraft] = useState("");

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["comments", studentId] });
    // The count on the row.
    void client.invalidateQueries({ queryKey: ["comment-summary"] });
  };
  const post = useMutation({
    mutationFn: () => postComment(studentId, draft.trim()),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: refresh,
  });
  const submit = () => {
    if (draft.trim() && !post.isPending) post.mutate();
  };

  return (
    <div className="space-y-3">
      {comments.isLoading ? (
        <p className="text-sm text-[#98a2b3]">Reading…</p>
      ) : comments.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          {(comments.error as Error).message}
        </p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="text-sm text-[#98a2b3]">Nothing said yet.</p>
      ) : (
        <ol aria-label={`Comments on ${label}`} className="space-y-2.5">
          {(comments.data ?? []).map((comment: StudentComment) => (
            <li
              key={comment.id}
              className="rounded-md border border-[#e4e8ef] bg-white px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-3 text-xs text-[#667085]">
                <span className="font-semibold text-[#344054]">
                  {comment.authorName || comment.authorEmail || "Somebody"}
                </span>
                <span className="flex items-center gap-2 whitespace-nowrap">
                  <time dateTime={comment.createdAt}>
                    {when(comment.createdAt)}
                  </time>
                  {me && same(me.email, comment.authorEmail) ? (
                    <button
                      type="button"
                      aria-label="Remove this comment"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(comment.id)}
                      className="rounded px-1 text-[11px] text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                    >
                      Remove
                    </button>
                  ) : null}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-[#171717]">
                {comment.body}
              </p>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="space-y-2"
      >
        <textarea
          aria-label={`Add a comment on ${label}`}
          value={draft}
          rows={2}
          placeholder="Add a comment — everyone who opens this student sees it"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter with the platform's modifier posts; plain Enter is a new line.
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className="w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
        />
        <div className="flex items-center justify-between gap-3 text-xs text-[#98a2b3]">
          <span>{me ? `Posting as ${me.name || me.email}` : ""}</span>
          <button
            type="submit"
            disabled={!draft.trim() || post.isPending}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            Post
          </button>
        </div>
        {post.error ? (
          <p role="alert" className="text-xs text-[#a6292f]">
            {(post.error as Error).message}
          </p>
        ) : null}
      </form>
    </div>
  );
}
