import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useStaffUser } from "@/components/useStaffUser";
import { STUDENT_THREAD, type Thread, type ThreadLine } from "@/services/threads";
import { writtenAt } from "@/services/studentComments";

const same = (left: string, right: string) =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

/** Where a thread's lines are kept in the cache: the same key the row's hover reads. */
export const threadKey = (thread: Thread, subjectId: string) => ["comments", thread.countsKey, subjectId];

const box =
  "w-full rounded-md border border-[#98a2b3] px-3 py-2 text-sm text-[#171717] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";

/**
 * One record's thread: what has been said, by whom and when, and a box to say more.
 *
 * The same component on the student's record, on a teacher's, and behind every row's
 * comment icon, so there is one thread however it is reached, and it reads and behaves the
 * same everywhere. A line can be rewritten or deleted by whoever wrote it — the server
 * refuses anyone else's anyway, and a button that will be refused is a worse button than
 * none. A rewritten line keeps its date and signature; deleting one asks first, because it
 * is gone for everybody.
 */
export function CommentThread({
  studentId,
  label,
  thread = STUDENT_THREAD,
}: {
  /** The record the thread hangs from: a student, or anything else `thread` can reach. */
  studentId: string;
  label: string;
  thread?: Thread;
}) {
  const client = useQueryClient();
  const me = useStaffUser();
  const key = threadKey(thread, studentId);
  const comments = useQuery({ queryKey: key, queryFn: () => thread.list(studentId) });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [deleting, setDeleting] = useState<ThreadLine | null>(null);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    // The count on the row.
    void client.invalidateQueries({ queryKey: [thread.countsKey] });
  };
  const post = useMutation({
    mutationFn: () => thread.post(studentId, draft.trim()),
    onSuccess: () => {
      setDraft("");
      refresh();
    },
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => thread.edit(id, body.trim()),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => thread.remove(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const submit = () => {
    if (draft.trim() && !post.isPending) post.mutate();
  };
  const saveEdit = () => {
    if (editing && editing.body.trim() && !edit.isPending) edit.mutate(editing);
  };

  return (
    <div className="space-y-3">
      {comments.isLoading ? (
        <p className="text-sm text-[#475467]">Reading…</p>
      ) : comments.error ? (
        <p role="alert" className="text-sm text-[#a6292f]">
          {(comments.error as Error).message}
        </p>
      ) : (comments.data ?? []).length === 0 ? (
        <p className="text-sm text-[#475467]">Nothing said yet.</p>
      ) : (
        <ol aria-label={`Comments on ${label}`} className="space-y-2.5">
          {(comments.data ?? []).map((comment: ThreadLine) => {
            const mine = Boolean(me && same(me.email, comment.authorEmail));
            const open = editing?.id === comment.id;
            return (
              <li key={comment.id} className="rounded-md border border-[#d0d5dd] bg-white px-3 py-2">
                <div className="flex items-baseline justify-between gap-3 text-xs text-[#475467]">
                  <span className="font-semibold text-[#344054]">
                    {comment.authorName || comment.authorEmail || "Somebody"}
                  </span>
                  <span className="flex items-center gap-1 whitespace-nowrap">
                    <time dateTime={comment.createdAt}>{writtenAt(comment.createdAt)}</time>
                    {mine && !open ? (
                      <>
                        <button
                          type="button"
                          aria-label="Edit this comment"
                          title="Edit"
                          onClick={() => setEditing({ id: comment.id, body: comment.body })}
                          className="ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold text-[#344054] hover:bg-[#eef4fa] hover:text-[#1f4e79]"
                        >
                          <Pencil size={11} aria-hidden="true" /> Edit
                        </button>
                        <button
                          type="button"
                          aria-label="Delete this comment"
                          title="Delete"
                          onClick={() => setDeleting(comment)}
                          className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-semibold text-[#a6292f] hover:bg-[#fdf3f3]"
                        >
                          <Trash2 size={11} aria-hidden="true" /> Delete
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
                {open ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveEdit();
                    }}
                    className="mt-1.5 space-y-2"
                  >
                    <textarea
                      aria-label="Edit the comment"
                      value={editing.body}
                      rows={2}
                      autoFocus
                      onChange={(event) => setEditing({ id: comment.id, body: event.target.value })}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          saveEdit();
                        } else if (event.key === "Escape") {
                          event.stopPropagation();
                          setEditing(null);
                        }
                      }}
                      className={box}
                    />
                    <div className="flex items-center justify-end gap-2">
                      {edit.error ? (
                        <p role="alert" className="mr-auto text-xs text-[#a6292f]">
                          {(edit.error as Error).message}
                        </p>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="rounded-md border border-[#98a2b3] px-3 py-1 text-xs font-semibold text-[#344054]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!editing.body.trim() || edit.isPending}
                        className="rounded-md bg-[#1f4e79] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-[#171717]">{comment.body}</p>
                )}
              </li>
            );
          })}
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
          placeholder={`Add a comment — everyone who opens this ${thread.noun} sees it`}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter with the platform's modifier posts; plain Enter is a new line.
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          className={box}
        />
        <div className="flex items-center justify-between gap-3 text-xs text-[#475467]">
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

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this comment?"
        description={`It is deleted for everybody who opens this ${thread.noun}. This cannot be undone.`}
        confirmLabel="Delete comment"
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id);
        }}
      />
    </div>
  );
}
