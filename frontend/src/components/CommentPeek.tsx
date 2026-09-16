import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { type StudentComment, fetchComments, writtenAt } from "@/services/studentComments";

/**
 * The comment icon on a roster row, and the thread under the pointer.
 *
 * The count told you there were four comments and nothing about what they said, so
 * reading them meant opening a dialog, reading, closing it, and moving to the next row —
 * four actions to answer a question worth one glance. Hovering now shows the whole thread
 * where it stands.
 *
 * Read-only on purpose. A panel that disappears when the pointer leaves is a bad place to
 * be typing, so adding a line stays behind the click, where the dialog holds still.
 */

/** Long enough that sweeping the pointer down a table opens nothing. */
const SETTLE = 250;
/** Long enough to cross the gap from the icon to the panel without it closing behind you. */
const GRACE = 120;

const WIDTH = 340;

export function CommentPeek({
  studentId,
  label,
  count,
  onOpen,
  className,
}: {
  studentId: string;
  /** The student as a person reads them, for the labels. */
  label: string;
  count: number;
  onOpen: () => void;
  className?: string;
}) {
  const [peeking, setPeeking] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const opening = useRef<number>(0);
  const closing = useRef<number>(0);

  const comments = useQuery({
    queryKey: ["comments", studentId],
    queryFn: () => fetchComments(studentId),
    // Nothing to peek at on a student nobody has said anything about, and the same key the
    // dialog uses — so opening it after a hover draws from what the hover already read.
    enabled: peeking && count > 0,
  });

  const stopTimers = useCallback(() => {
    window.clearTimeout(opening.current);
    window.clearTimeout(closing.current);
  }, []);

  const show = useCallback(() => {
    stopTimers();
    opening.current = window.setTimeout(() => setPeeking(true), SETTLE);
  }, [stopTimers]);

  const hide = useCallback(() => {
    stopTimers();
    closing.current = window.setTimeout(() => setPeeking(false), GRACE);
  }, [stopTimers]);

  // Nothing is left running behind a row that is scrolled away or a table that is filtered.
  useEffect(() => stopTimers, [stopTimers]);

  useEffect(() => {
    if (!peeking) return;
    const place = () => {
      const box = anchor.current?.getBoundingClientRect();
      if (!box) return;
      setAt({
        top: box.bottom + 6,
        left: Math.max(12, Math.min(box.left, window.innerWidth - WIDTH - 12)),
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeeking(false);
    };
    place();
    // The row moves under the panel as the table scrolls; the panel follows it rather than
    // hanging over a different student.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", escape);
    };
  }, [peeking]);

  const lines = comments.data ?? [];

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={count ? `${count} comment${count === 1 ? "" : "s"} on ${label}` : `Comment on ${label}`}
        title={count ? "Read the comments on this student, or add one" : "Add a comment on this student"}
        onClick={() => {
          stopTimers();
          setPeeking(false);
          onOpen();
        }}
        onPointerEnter={show}
        onPointerLeave={hide}
        // Keyboard reaches it too, and without the wait: arriving by Tab is deliberate in a
        // way that sweeping a pointer across a table is not.
        onFocus={() => {
          stopTimers();
          setPeeking(true);
        }}
        onBlur={hide}
        className={className}
      >
        <MessageSquare size={13} aria-hidden="true" />
        {count ? <span>{count}</span> : null}
      </button>

      {peeking && count > 0 && at
        ? createPortal(
            <div
              style={{ ...at, width: WIDTH }}
              // Kept alive while the pointer is inside it, so a long thread can be scrolled.
              onPointerEnter={stopTimers}
              onPointerLeave={hide}
              role="group"
              aria-label={`Comments on ${label}`}
              className="fixed z-[120] max-h-80 overflow-auto rounded-md border border-[#d9dee7] bg-white p-3 shadow-lg"
            >
              {comments.isLoading ? (
                <p className="text-sm text-[#98a2b3]">Reading…</p>
              ) : comments.error ? (
                <p className="text-sm text-[#a6292f]">{(comments.error as Error).message}</p>
              ) : lines.length === 0 ? (
                <p className="text-sm text-[#98a2b3]">Nothing said yet.</p>
              ) : (
                <ol className="space-y-2.5">
                  {lines.map((comment: StudentComment) => (
                    <li key={comment.id} className="rounded-md border border-[#e4e8ef] bg-white px-3 py-2">
                      <div className="flex items-baseline justify-between gap-3 text-xs text-[#667085]">
                        <span className="font-semibold text-[#344054]">
                          {comment.authorName || comment.authorEmail || "Somebody"}
                        </span>
                        <time dateTime={comment.createdAt} className="whitespace-nowrap">
                          {writtenAt(comment.createdAt)}
                        </time>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-[#171717]">{comment.body}</p>
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-xs text-[#98a2b3]">Click to add a line.</p>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
