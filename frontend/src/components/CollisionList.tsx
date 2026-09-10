import { useMutation } from "@tanstack/react-query";
import { useState } from "react";

import {
  describeCollisionSlot,
  describeOverlap,
  settleCollision,
  type SectionCollision,
  type SettledCollision,
} from "@/services/portalLists";

/**
 * Our sections sharing an hour with a department's we do not own, and what to do about it.
 *
 * The three remedies, and none of them is "move a student":
 *
 *   move ours   — entirely within the department's power, and the actual fix. Not a
 *                 button here: it is a timetable request, made where requests are made.
 *   accept      — the option block is protected university-wide and the students chose a
 *                 clashing option. A real answer, and the commonest one.
 *   refer       — once, about the slot, to whoever owns the block.
 *
 * Settling is the server's, not this browser's: every input is the same for every
 * coordinator, so accepting one is the department deciding rather than one person hiding a
 * line on their own machine. Settled rows stay visible with their reason, and the note
 * expires by itself the moment the registrar moves our section — its key is that slot.
 */
export function CollisionList({
  term,
  collides,
  settled,
  swept,
  onSettled,
}: {
  term: string;
  collides: SectionCollision[];
  settled: SettledCollision[];
  /** False when nobody has swept the registrar's timetable: blind, not clean. */
  swept: boolean;
  onSettled: () => void;
}) {
  const [noting, setNoting] = useState<SectionCollision | null>(null);
  const [note, setNote] = useState("");
  const [showingQuiet, setShowingQuiet] = useState(false);
  const settle = useMutation({
    mutationFn: (input: { row: SectionCollision; disposition: "accepted" | "referred" | ""; note: string }) =>
      settleCollision({
        termCode: term,
        ourCrn: input.row.ourCrn,
        weekday: input.row.weekday,
        startsAt: input.row.startsAt,
        endsAt: input.row.endsAt,
        disposition: input.disposition,
        note: input.note,
      }),
    onSuccess: () => {
      setNoting(null);
      setNote("");
      onSettled();
    },
  });

  if (!swept) {
    return (
      <p className="mt-2 px-6 text-xs text-[#8a6116]">
        Nobody has pulled the registrar&apos;s timetable for this semester, so no collision can be found in any of
        it. Run a portal sync.
      </p>
    );
  }

  /*
   * Split by whether anybody is actually caught in the middle of it.
   *
   * On the real sweep, 26 of 32 slots had nobody registered in both sides. They are true —
   * our section and somebody else's really do share an hour, and a student may register
   * into it tomorrow — but twenty-six lines nobody will ever act on is the shape of an
   * alarm that cannot be cleared, and this page has already learnt what those do to the
   * eye. So they are kept, counted, and folded until asked for.
   */
  const caught = collides.filter((row) => row.students > 0);
  const quiet = collides.filter((row) => row.students === 0);
  const shown = showingQuiet ? [...caught, ...quiet] : caught;

  return (
    <div className="mt-2 text-xs">
      {collides.length ? (
        <>
          <h4 className="px-6 font-semibold uppercase tracking-wide text-[#b08a2e]">
            Sharing an hour with another department
          </h4>
          <ul className="mt-1 divide-y divide-[#f3ead2]">
            {shown.map((row) => (
              <li key={`${row.ourCrn}|${row.weekday}|${row.startsAt}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-6 py-2">
                <span className="font-medium text-[#8a6116]">
                  {row.ourCourse || row.ourCrn} {row.ourCrn}
                </span>
                <span>{describeCollisionSlot(row)}</span>
                {/* The overlap itself, which is what says whether it is worth an argument:
                    fifteen minutes at the end of a class is not ninety in the middle. */}
                <span className="font-medium text-[#8a6116]">{describeOverlap(row.minutes)}</span>
                <span className="text-[#b08a2e]">
                  vs {row.theirs.map((other) => other.courseCode || other.crn).join(", ")}
                </span>
                {/* The count is the whole student side of it: the remedy is about the
                    section, and a list of names would only invite the wrong one. */}
                {row.students ? (
                  <span className="text-[#a6292f]">{row.students} in both</span>
                ) : (
                  <span className="text-[#b08a2e]">nobody in both</span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    disabled={settle.isPending}
                    onClick={() => settle.mutate({ row, disposition: "accepted", note: "" })}
                    className="font-semibold text-[#1f4e79] underline disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={settle.isPending}
                    onClick={() => {
                      setNote("");
                      setNoting(row);
                    }}
                    className="font-semibold text-[#1f4e79] underline disabled:opacity-50"
                  >
                    Refer
                  </button>
                </span>
                {noting === row ? (
                  <span className="flex w-full items-center gap-2 pt-1">
                    <input
                      aria-label={`Who this slot was referred to, for ${row.ourCrn}`}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Referred to whom, and about what"
                      className="min-w-0 flex-1 rounded border border-[#e3d3a8] px-2 py-1"
                    />
                    <button
                      type="button"
                      onClick={() => settle.mutate({ row, disposition: "referred", note })}
                      className="font-semibold text-[#1f4e79] underline"
                    >
                      Save
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {quiet.length ? (
            <button
              type="button"
              onClick={() => setShowingQuiet((current) => !current)}
              className="mt-1 px-6 font-semibold text-[#1f4e79] underline"
            >
              {showingQuiet
                ? `Hide the ${quiet.length} no student of ours is in`
                : `${quiet.length} more, that no student of ours is in`}
            </button>
          ) : null}
          {!caught.length && !showingQuiet ? (
            <p className="mt-1 px-6 text-[#b08a2e]">None of them catches a student of ours.</p>
          ) : null}
        </>
      ) : null}

      {settled.length ? (
        <>
          <h4 className="mt-3 px-6 font-semibold uppercase tracking-wide text-[#b08a2e]">Settled</h4>
          <ul className="mt-1 divide-y divide-[#f3ead2]">
            {settled.map((row) => (
              <li key={`${row.ourCrn}|${row.weekday}|${row.startsAt}`} className="flex flex-wrap items-baseline gap-x-3 px-6 py-2 text-[#b08a2e]">
                <span className="font-medium">{row.ourCourse || row.ourCrn} {row.ourCrn}</span>
                <span>{describeCollisionSlot(row)}</span>
                <span>{row.disposition === "referred" ? "referred" : "accepted"}{row.note ? ` — ${row.note}` : ""}</span>
                <button
                  type="button"
                  onClick={() => settle.mutate({ row, disposition: "", note: "" })}
                  className="ml-auto font-semibold text-[#1f4e79] underline"
                >
                  Put it back
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {settle.error ? (
        <p role="alert" className="mt-2 px-6 text-[#a6292f]">{(settle.error as Error).message}</p>
      ) : null}
    </div>
  );
}
