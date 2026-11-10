import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarHeart, Settings } from "lucide-react";
import { useState } from "react";

import { InfoTip, TipButton, TipDo, TipPage, TipPoint, TipUsage } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { PortalSemesterMenu, usePortalSemester } from "@/components/PortalSemesterMenu";
import { ScreenLoading } from "@/components/ScreenLoading";
import { WishesForm } from "@/components/WishesForm";
import {
  COLLECTION_DEFAULTS,
  DAY_SHORT,
  cantHours,
  fetchWishSemester,
  openCollection,
  saveWishes,
  type CollectionInput,
  type WishCollection,
  type WishTeacher,
  type WishesInput,
} from "@/services/teacherWishes";

const field = "w-full rounded-md border border-[#cbd5e1] px-2.5 py-1.5 text-sm";
const label = "text-xs font-semibold text-[#344054]";

const STATUS = {
  submitted: { words: "Submitted", tone: "bg-[#e7f4ec] text-[#2e7d55]" },
  draft: { words: "Draft", tone: "bg-[#fdf6e3] text-[#8a6116]" },
  none: { words: "Not started", tone: "bg-[#f2f4f7] text-[#667085]" },
} as const;

/** "10 Jan 2027". */
const dated = (value: string) =>
  value ? new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

/** A semester's collection: when it closes, what teachers are told, and the rules of the form. */
function CollectionSettings({
  open,
  semesterName,
  initial,
  busy,
  error,
  onSave,
  onClose,
}: {
  open: boolean;
  semesterName: string;
  initial: CollectionInput;
  busy: boolean;
  error: string;
  onSave: (input: CollectionInput) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CollectionInput>(initial);
  const set = (changes: Partial<CollectionInput>) => setDraft((current) => ({ ...current, ...changes }));
  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  return (
    <Modal
      open={open}
      title={`Wishes for ${semesterName}`}
      description="When teachers answer by, what they're told, and the rules of the form."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-3">
          {error ? (
            <span role="alert" className="mr-auto text-sm text-[#a6292f]">
              {error}
            </span>
          ) : null}
          <button type="button" onClick={onClose} className="text-sm font-semibold text-[#667085]">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSave(draft)}
            className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        <label className="block">
          <span className={label}>Deadline</span>
          <input type="date" value={draft.deadline} onChange={(event) => set({ deadline: event.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label className="block">
          <span className={label}>Message to teachers</span>
          <textarea
            rows={3}
            value={draft.message}
            onChange={(event) => set({ message: event.target.value })}
            placeholder="Please tell us by 10 January when you can and can't teach next semester."
            className={`mt-1 ${field}`}
          />
        </label>
        <div>
          <span className={label}>Days on the grid</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((day) => (
              <label key={day} className="inline-flex items-center gap-1.5 text-sm text-[#344054]">
                <input
                  type="checkbox"
                  checked={draft.days.includes(day)}
                  onChange={(event) =>
                    set({ days: event.target.checked ? [...draft.days, day].sort((a, b) => a - b) : draft.days.filter((each) => each !== day) })
                  }
                />
                {DAY_SHORT[day]}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={label}>First hour</span>
            <select value={draft.firstHour} onChange={(event) => set({ firstHour: Number(event.target.value) })} className={`mt-1 ${field}`}>
              {hours.slice(0, 24).map((hour) => (
                <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Last hour</span>
            <select value={draft.lastHour} onChange={(event) => set({ lastHour: Number(event.target.value) })} className={`mt-1 ${field}`}>
              {hours.slice(1).map((hour) => (
                <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={label}>Most Musts a teacher may mark</span>
            <input type="number" min={0} max={10} value={draft.mustQuota} onChange={(event) => set({ mustQuota: Number(event.target.value) })} className={`mt-1 ${field}`} />
          </label>
          <label className="block">
            <span className={label}>Can&rsquo;t-teach hours a week, before a reason is asked</span>
            <input type="number" min={0} max={60} value={draft.cantCap} onChange={(event) => set({ cantCap: Number(event.target.value) })} className={`mt-1 ${field}`} />
          </label>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Timetable wishes: when each teacher can and can't teach, collected once a semester.
 *
 * A coordinator opens the semester's collection — a deadline, a message, the rules of the
 * form — sees who has answered, and answers for a teacher who sent theirs by email or said
 * them on the phone. The Semester plan reads the answers while classes are placed.
 */
export function TeacherWishesPage({ header }: { header?: HTMLElement | null }) {
  const client = useQueryClient();
  const { semesters, semester, setTermId, term } = usePortalSemester();
  const wishes = useQuery({
    queryKey: ["wishes", term],
    queryFn: () => fetchWishSemester(term),
    enabled: Boolean(term),
    retry: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [answering, setAnswering] = useState<WishTeacher | null>(null);
  const [error, setError] = useState("");

  const refresh = () => client.invalidateQueries({ queryKey: ["wishes", term] });
  const open = useMutation({
    mutationFn: (input: CollectionInput) => openCollection(term, input),
    onSuccess: async () => {
      await refresh();
      setSettingsOpen(false);
      setError("");
    },
    onError: (exc: Error) => setError(exc.message),
  });
  const save = useMutation({
    mutationFn: ({ teacherId, input }: { teacherId: string; input: WishesInput }) => saveWishes(term, teacherId, input),
    onSuccess: async () => {
      await refresh();
      setAnswering(null);
      setError("");
    },
    onError: (exc: Error) => setError(exc.message),
  });

  const menu = <PortalSemesterMenu semesters={semesters} semester={semester} onChange={setTermId} header={header} />;
  const collection: WishCollection | null = wishes.data?.collection ?? null;
  const teachers = wishes.data?.teachers ?? [];
  const submitted = teachers.filter((row) => row.wishes?.status === "submitted").length;
  const drafts = teachers.filter((row) => row.wishes?.status === "draft").length;
  const semesterName = semester?.name ?? "this semester";

  const tip = (
    <InfoTip label="How timetable wishes work" title="Timetable wishes">
      <TipDo>Open the collection for a semester, then see who has answered, and answer for anyone who sent theirs by email.</TipDo>
      <TipPoint step={1}>
        Press <TipButton icon={Settings}>Open the collection</TipButton>: a deadline, a message, the week&rsquo;s hours.
      </TipPoint>
      <TipPoint step={2}>Teachers answer: their week painted, limits, dates away, what matters most.</TipPoint>
      <TipPoint step={3}>
        On <TipPage name="Semester plan" />, a class that breaks a wish is flagged, and its teacher&rsquo;s week is shaded while you move it.
      </TipPoint>
      <TipUsage
        when={<>Bilal Maaz emails to say Tuesday afternoons are impossible.</>}
        todo={<>Press <TipButton>Fill in</TipButton> on Bilal&rsquo;s row, paint Tuesday 14:00–18:00 red, mark it a Must, and submit.</>}
        then={<>On the plan, Bilal&rsquo;s classes on Tuesday afternoon are flagged red.</>}
      />
    </InfoTip>
  );

  return (
    <section className="space-y-4">
      {header ? menu : <div className="flex justify-end">{menu}</div>}

      {!term ? (
        <p className="text-sm text-[#667085]">Choose a semester with a portal term.</p>
      ) : wishes.isLoading ? (
        <ScreenLoading label="Reading the wishes…" />
      ) : wishes.isError ? (
        <p role="alert" className="text-sm text-[#a6292f]">{(wishes.error as Error).message}</p>
      ) : !collection ? (
        <div className="rounded-lg border border-dashed border-[#c8d0da] bg-white px-5 py-8 text-center">
          <CalendarHeart size={22} className="mx-auto text-[#98a2b3]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[#344054]">No wishes collected for {semesterName} yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[#667085]">
            Open the collection with a deadline, and each teacher can say when they can and can&rsquo;t teach. You can also answer for
            a teacher yourself.
          </p>
          <button
            type="button"
            onClick={() => {
              setError("");
              setSettingsOpen(true);
            }}
            className="mt-4 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white"
          >
            Open the collection
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#d9dee7] bg-white px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#171717]">
              {semesterName} {tip}
            </span>
            <span className="text-sm text-[#667085]">{collection.deadline ? `Deadline ${dated(collection.deadline)}` : "No deadline set"}</span>
            <span className="text-sm tabular-nums text-[#667085]">
              {submitted} of {teachers.length} submitted{drafts ? ` · ${drafts} draft${drafts === 1 ? "" : "s"}` : ""}
            </span>
            <span className="text-xs text-[#98a2b3]">
              {collection.mustQuota} Musts · {collection.cantCap} h can&rsquo;t-teach cap
            </span>
            <button
              type="button"
              onClick={() => {
                setError("");
                setSettingsOpen(true);
              }}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-[#b7bec8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
            >
              <Settings size={13} aria-hidden="true" /> Settings
            </button>
          </div>
          {collection.message ? <p className="whitespace-pre-line text-sm text-[#667085]">{collection.message}</p> : null}

          <div className="overflow-x-auto rounded-lg border border-[#d9dee7] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#fbfcfe] text-[11px] uppercase tracking-wide text-[#8a94a4]">
                <tr>
                  <th className="px-4 py-2 font-semibold">Teacher</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Musts</th>
                  <th className="px-3 py-2 font-semibold">Can&rsquo;t teach</th>
                  <th className="px-3 py-2 font-semibold">Last change</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {teachers.map((row) => {
                  const status = STATUS[row.wishes?.status ?? "none"];
                  const musts = row.wishes ? row.wishes.lines.filter((line) => line.level === "must").length : 0;
                  const cant = row.wishes ? cantHours(row.wishes.cells) : 0;
                  return (
                    <tr key={row.teacherId} className="border-t border-[#f2f4f7]">
                      <td className="px-4 py-2 font-semibold text-[#344054]">{row.name}</td>
                      <td className="px-3 py-2">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.words}</span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-[#667085]">{row.wishes ? `${musts} of ${collection.mustQuota}` : ""}</td>
                      <td className={`px-3 py-2 tabular-nums ${cant > collection.cantCap ? "font-semibold text-[#a6292f]" : "text-[#667085]"}`}>
                        {row.wishes ? `${cant} h` : ""}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#667085]">
                        {row.wishes ? (
                          <>
                            {dated(row.wishes.updatedAt)}
                            {row.wishes.source === "coordinator" && row.wishes.updatedBy ? ` · entered by ${row.wishes.updatedBy}` : ""}
                          </>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setError("");
                            setAnswering(row);
                          }}
                          aria-label={`${row.wishes ? "Open" : "Fill in"} ${row.name}'s wishes`}
                          className="text-xs font-semibold text-[#1f4e79] hover:underline"
                        >
                          {row.wishes ? "Open" : "Fill in"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!teachers.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-[#667085]">
                      No teacher is active in {semesterName} yet. Add them on Active teachers.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}

      {settingsOpen ? (
        <CollectionSettings
          open
          semesterName={semesterName}
          initial={collection ? { ...collection } : COLLECTION_DEFAULTS}
          busy={open.isPending}
          error={error}
          onSave={(input) => open.mutate(input)}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
      {answering && collection ? (
        <Modal
          open
          size="wide"
          closeOnOutsideClick={false}
          title={`${answering.name}'s wishes`}
          description={`${semesterName}${answering.wishes ? ` · ${STATUS[answering.wishes.status].words.toLowerCase()}` : ""}. Saved here as entered by you.`}
          onClose={() => setAnswering(null)}
        >
          <WishesForm
            collection={collection}
            initial={answering.wishes}
            busy={save.isPending}
            error={error}
            onSave={(input) => save.mutate({ teacherId: answering.teacherId, input })}
            onCancel={() => setAnswering(null)}
          />
        </Modal>
      ) : null}
    </section>
  );
}
