import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Modal } from "@/components/Modal";
import { SelectMenu } from "@/components/SelectMenu";
import { fetchActiveTeachers } from "@/services/portalLists";
import { clearSessionChange, saveSessionChange, type ChangeKind, type SessionChange } from "@/services/sessionChanges";
import { formatLongDate, type PlacedSession } from "@/services/weekSchedule";

const TYPED = "__typed__";

/**
 * What happened to one class: it ran, it was cancelled, or somebody else taught it.
 *
 * Opened from a box on a CRN's calendar. One fact per slot — choosing "as planned" takes
 * back whatever was said before, so the calendar and the hours read clean again.
 */
export function SessionChangeDialog({
  session,
  label,
  plannedTeacher,
  existing,
  onClose,
}: {
  session: PlacedSession & { termCode?: string };
  /** What to call the class in the title — "MATH-351 · CRN 23436". */
  label: string;
  plannedTeacher: string;
  existing: SessionChange | null;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const teachers = useQuery({ queryKey: ["active-teachers"], queryFn: fetchActiveTeachers });
  const [kind, setKind] = useState<ChangeKind | "planned">(existing?.kind ?? "planned");
  const [coverId, setCoverId] = useState(existing?.coverTeacherId || (existing?.coverTeacherName ? TYPED : ""));
  const [typedName, setTypedName] = useState(existing?.coverTeacherId ? "" : (existing?.coverTeacherName ?? ""));
  const [note, setNote] = useState(existing?.note ?? "");
  const termCode = session.termCode ?? "";

  const invalidate = () => client.invalidateQueries({ queryKey: ["session-changes", termCode] });
  const save = useMutation({
    mutationFn: async () => {
      if (kind === "planned") {
        if (existing) await clearSessionChange(existing.id);
        return;
      }
      const chosen = (teachers.data ?? []).find((teacher) => teacher.id === coverId) ?? null;
      await saveSessionChange({
        termCode,
        crn: session.crn,
        meetsOn: session.date,
        startsAt: session.start,
        endsAt: session.end,
        kind,
        coverTeacherId: kind === "covered" ? (chosen?.id ?? "") : "",
        coverTeacherName: kind === "covered" ? (chosen?.fullName ?? typedName) : "",
        note,
      });
    },
    onSuccess: async () => {
      await invalidate();
      onClose();
    },
  });

  const coverName = coverId === TYPED ? typedName.trim() : ((teachers.data ?? []).find((teacher) => teacher.id === coverId)?.fullName ?? "");
  const incomplete = kind === "covered" && !coverName;
  const options = [
    ...(teachers.data ?? []).map((teacher) => ({ value: teacher.id, label: teacher.fullName })),
    { value: TYPED, label: "Somebody not on the list…" },
  ];

  return (
    <Modal
      open
      title={`${formatLongDate(session.date)} · ${session.start}–${session.end}`}
      description={`${label}${plannedTeacher ? ` · planned: ${plannedTeacher}` : ""}`}
      onClose={onClose}
      footer={
        <>
          {save.error ? <span role="alert" className="mr-auto text-sm text-[#a6292f]">{(save.error as Error).message}</span> : null}
          <button type="button" onClick={onClose} className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]">
            Cancel
          </button>
          <button
            type="button"
            disabled={incomplete || save.isPending || !termCode}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1a4268] disabled:opacity-50"
          >
            Save
          </button>
        </>
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-semibold text-[#171717]">What happened to this class?</legend>
        {(
          [
            ["planned", "Ran as planned", "Nothing to note. Takes back anything said before."],
            ["cancelled", "Cancelled", "The class did not take place. Its hours come off the planned teacher."],
            ["covered", "Covered by another teacher", "Somebody stood in. The hours move from the planned teacher to them."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 ${kind === value ? "border-[#1f4e79] bg-[#f2f7fb]" : "border-[#d9dee7] bg-white"}`}>
            <input type="radio" name="what-happened" value={value} checked={kind === value} onChange={() => setKind(value)} className="mt-1" />
            <span>
              <span className="block text-sm font-medium text-[#344054]">{title}</span>
              <span className="block text-xs text-[#98a2b3]">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {kind === "covered" ? (
        <div className="mt-3 space-y-2">
          <SelectMenu label="Who covered it" value={coverId} onChange={setCoverId} options={options} placeholder="Choose a teacher" searchable required />
          {coverId === TYPED ? (
            <input
              aria-label="Name of the teacher who covered it"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder="Their name, as the department knows it"
              className="h-9 w-full rounded-md border border-[#b7bec8] px-3 text-sm focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
            />
          ) : null}
        </div>
      ) : null}

      {kind !== "planned" ? (
        <label className="mt-3 block">
          <span className="text-xs font-semibold uppercase tracking-wide text-[#8a94a4]">Note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="Why, if it helps the next person — optional."
            className="mt-1 w-full rounded-md border border-[#b7bec8] px-3 py-2 text-sm focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
          />
        </label>
      ) : null}

      {existing ? (
        <p className="mt-3 text-xs text-[#98a2b3]">
          Last said by {existing.authorName || existing.authorEmail || "somebody"} on {new Date(existing.updatedAt).toLocaleDateString("en-GB")}.
        </p>
      ) : null}
      {!termCode ? <p className="mt-3 text-xs text-[#a6292f]">This semester is linked to no portal term, so nothing can be noted on it.</p> : null}
    </Modal>
  );
}
