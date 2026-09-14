/**
 * A teacher's time sheets, as links to where the workbooks actually live.
 *
 * The sheets are Excel files in OneDrive, owned and edited by the people who keep them.
 * Copying one into this database would make a second, staler copy of somebody else's
 * file, and nobody would know which of the two was the real one. What was missing was
 * never the file: it was knowing, from the teacher's profile, which sheet is theirs.
 *
 * So this card holds a label, an academic year and a link, and the link opens in a new
 * tab. Who may open it is OneDrive's decision, not ours — a coordinator without access
 * sees Microsoft's own sign-in, which is the right place for that conversation.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileSpreadsheet, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  type TeacherTimeSheet,
  createTeacherTimeSheet,
  deleteTeacherTimeSheet,
  listTeacherTimeSheets,
  updateTeacherTimeSheet,
} from "@/services/teachers";
import { isWebLink, linkHost } from "@/services/timeSheetLinks";

type Draft = { label: string; academicYear: string; url: string };

const EMPTY: Draft = { label: "", academicYear: "2026-2027", url: "" };

export function TimeSheetsCard({ teacherId, className = "" }: { teacherId: string; className?: string }) {
  const client = useQueryClient();
  const sheets = useQuery({
    queryKey: ["teacher-time-sheets", teacherId],
    queryFn: () => listTeacherTimeSheets(teacherId),
  });
  // One form for both jobs: adding, or correcting the one being edited. A pasted link is
  // got wrong often enough that fixing it must not mean deleting the row and retyping.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<TeacherTimeSheet | null>(null);

  const refresh = () => client.invalidateQueries({ queryKey: ["teacher-time-sheets", teacherId] });
  const close = () => {
    setDraft(null);
    setEditingId(null);
  };
  const save = useMutation({
    mutationFn: (input: Draft) =>
      editingId
        ? updateTeacherTimeSheet(teacherId, editingId, input)
        : createTeacherTimeSheet(teacherId, input),
    onSuccess: () => {
      close();
      void refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteTeacherTimeSheet(teacherId, id),
    onSuccess: () => void refresh(),
  });

  const rows = sheets.data ?? [];
  const ready = Boolean(draft?.label.trim()) && isWebLink(draft?.url ?? "");

  return (
    <section className={`${className} rounded-lg border border-[#d9dee7] bg-white p-5`}>
      {/*
        * The description sits under the whole header rather than beside the button. This
        * card shares a row with Requisitions, so its column is half a page wide, and a
        * sentence squeezed next to a button there wraps to four lines and pushes the
        * button off the heading it belongs to.
        */}
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Time sheets</h3>
        <button
          type="button"
          onClick={() => {
            if (draft && !editingId) close();
            else {
              setEditingId(null);
              setDraft(EMPTY);
              save.reset();
            }
          }}
          className="inline-flex shrink-0 items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"
        >
          <Plus size={16} /> Add a time sheet
        </button>
      </div>
      <p className="mt-1 text-sm text-[#667085]">
        Links to this teacher&apos;s time sheet workbooks in OneDrive. The sheets stay where they are kept.
      </p>

      {draft ? (
        <form
          className="mt-4 grid gap-3 rounded-md bg-[#f8fafc] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) save.mutate({ ...draft, url: draft.url.trim() });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
            <Field
              label="Label"
              value={draft.label}
              placeholder="Semester 1 time sheet"
              onChange={(label) => setDraft({ ...draft, label })}
            />
            <Field
              label="Academic year"
              value={draft.academicYear}
              placeholder="2026-2027"
              onChange={(academicYear) => setDraft({ ...draft, academicYear })}
            />
          </div>
          <Field
            label="Link"
            value={draft.url}
            placeholder="https://…sharepoint.com/…"
            onChange={(url) => setDraft({ ...draft, url })}
          />
          {/*
            * Said before the press, not after it. Pasting the file path from Explorer
            * instead of the share link is the mistake this catches, and a round trip to
            * the server to be told so is a round trip too many.
            */}
          {draft.url.trim() && !isWebLink(draft.url) ? (
            <p className="text-sm text-[#8a6116]">
              That is not a web address. In OneDrive use Share, then Copy link, and paste what it gives you.
            </p>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-sm text-[#8f1f25]">
              {(save.error as Error).message}
            </p>
          ) : null}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={!ready || save.isPending}
              className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {save.isPending ? "Saving…" : editingId ? "Save changes" : "Add the link"}
            </button>
            <button type="button" onClick={close} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {sheets.isLoading ? <p className="mt-4 text-sm text-[#667085]">Reading the time sheets…</p> : null}
      {sheets.error ? (
        <p role="alert" className="mt-4 text-sm text-[#8f1f25]">
          {(sheets.error as Error).message}
        </p>
      ) : null}

      {/*
        * No breakpoint on a row below, and nothing in one that cannot shrink. The card
        * sits in half a page's width whatever the window is doing, so a `sm:` rule would
        * be answering a question about the window rather than about the column, and the
        * created/updated chips a requisition shows would push the buttons straight out of
        * the card. `min-w-0` on the row is load-bearing for the same reason: a grid item
        * is allowed to be as wide as its longest unbreakable line, and a truncated label
        * is exactly that, so without it a long label pushes the buttons past the edge
        * instead of being cut.
        */}
      {rows.length ? (
        <div role="list" className="mt-4 grid gap-3" aria-label="Time sheets">
          {rows.map((sheet) => (
            <article
              key={sheet.id}
              role="listitem"
              className="flex min-w-0 items-center gap-3 rounded-lg border border-[#d9dee7] p-4 transition-colors hover:border-[#b9d0e5] hover:bg-[#f8fafc]"
            >
              <FileSpreadsheet size={18} className="shrink-0 text-[#1f6b47]" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <a
                  href={sheet.url}
                  target="_blank"
                  rel="noreferrer"
                  title={sheet.url}
                  className="flex max-w-full items-center gap-1.5 font-semibold text-[#1f4e79] hover:underline"
                >
                  <span className="truncate">{sheet.label}</span>
                  <ExternalLink size={14} className="shrink-0" aria-hidden="true" />
                </a>
                <span className="mt-1 block truncate text-sm text-[#667085]">
                  {[sheet.academicYear, linkHost(sheet.url)].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${sheet.label}`}
                  onClick={() => {
                    setEditingId(sheet.id);
                    setDraft({ label: sheet.label, academicYear: sheet.academicYear, url: sheet.url });
                    save.reset();
                  }}
                  className="rounded p-1.5 text-[#344054] hover:bg-[#eef1f5]"
                >
                  <Pencil size={16} />
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  aria-label={`Remove ${sheet.label}`}
                  onClick={() => setPendingDeletion(sheet)}
                  className="rounded p-1.5 text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!rows.length && !sheets.isLoading && !draft ? (
        <p className="py-6 text-sm text-[#667085]">
          No time sheet linked yet. Add the OneDrive link and it opens from here.
        </p>
      ) : null}
      {remove.error ? (
        <p role="alert" className="mt-2 text-sm text-[#8f1f25]">
          {(remove.error as Error).message}
        </p>
      ) : null}

      {/*
        * Only the link goes. Saying so is the whole point of the wording: nobody should
        * hesitate over whether this deletes the workbook in OneDrive.
        */}
      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Remove this link?"
        description={`Remove the link to ${pendingDeletion?.label ?? "this time sheet"}? The workbook in OneDrive is untouched.`}
        confirmLabel="Remove the link"
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => {
          if (pendingDeletion) remove.mutate(pendingDeletion.id);
          setPendingDeletion(null);
        }}
      />
    </section>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-[#344054]">
      <span>{label}</span>
      <span className="relative">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-md border border-[#b7bec8] px-3 py-2 pr-8 font-normal"
        />
        {value ? (
          <button
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onClick={() => onChange("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-[#98a2b3] hover:bg-[#eef1f5] hover:text-[#344054]"
          >
            <X size={14} />
          </button>
        ) : null}
      </span>
    </label>
  );
}
