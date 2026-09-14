import { useStaffUser } from "@/components/useStaffUser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  FieldNote,
  listFieldNotes,
  upsertFieldNote,
} from "@/services/workflow";
import type { AppId } from "@/routes/apps";

/**
 * The records these notes are attached to, and which app they belong to.
 *
 * The app decides who may write the guidance: whoever administers *that* app. Handing out
 * accounts and maintaining the syllabus catalogue are different jobs, and the coordinator
 * doing the second should not have to ask the person doing the first to fix a sentence.
 */
type FieldInfoSource = { resourceType: string; resourceId: string; app: AppId };
const FieldInfoContext = createContext<FieldInfoSource | null>(null);

export function FieldInfoProvider({
  source,
  children,
}: {
  source: FieldInfoSource;
  children: React.ReactNode;
}) {
  const notes = useQuery({
    queryKey: ["field-notes", source.resourceType, source.resourceId],
    queryFn: () => listFieldNotes(source.resourceType, source.resourceId),
  });
  return (
    <FieldInfoContext.Provider value={source}>
      <FieldInfoNotesContext.Provider value={notes.data ?? []}>
        {children}
      </FieldInfoNotesContext.Provider>
    </FieldInfoContext.Provider>
  );
}

const FieldInfoNotesContext = createContext<FieldNote[]>([]);

export function FieldInfoLabel({
  fieldKey,
  hint,
  name,
  children,
}: {
  fieldKey?: string;
  /** What to call this field out loud, when the visible label carries more than its name. */
  name?: string;
  /**
   * Guidance that ships with the field, shown until an administrator writes their own.
   *
   * It exists so a paragraph explaining a field need not sit on the page taking a third
   * of a screen for the ninety-ninth time somebody opens the form.
   */
  hint?: string;
  children: React.ReactNode;
}) {
  const source = useContext(FieldInfoContext);
  const notes = useContext(FieldInfoNotesContext);
  const [editorOpen, setEditorOpen] = useState(false);
  const user = useStaffUser();
  const canEdit = Boolean(user?.isAdmin) || (source ? user?.apps?.[source.app] === "admin" : false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const note = notes.find((item) => item.fieldKey === fieldKey);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const guidance = note?.content ?? hint ?? "";
  // Clicking the label is how guidance is written, so the label looks clickable only to
  // whoever may write it. Everybody else can still open what is there to read — hover is a
  // poor way to read a paragraph — but is not invited to change it, or to open an empty
  // panel about a field nobody has written anything about.
  const writable = Boolean(source && fieldKey) && canEdit;
  const readable = Boolean(source && fieldKey) && Boolean(guidance);
  if (!writable && !guidance) return <>{children}</>;
  return (
    <span
      ref={anchorRef}
      className="group relative inline-flex items-center gap-1"
      onClick={writable || readable ? () => setEditorOpen(true) : undefined}
    >
      <span
        className={
          writable ? "cursor-pointer transition-colors hover:text-[#1f4e79]" : undefined
        }
      >
        {children}
      </span>
      {guidance ? (
        <span
          role="img"
          aria-label={`Field information for ${name ?? String(children)}`}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={() => setPreviewOpen(true)}
          onMouseLeave={() => setPreviewOpen(false)}
          className="p-0.5 text-[#667085]"
        >
          <Info size={15} />
        </span>
      ) : null}
      {previewOpen && guidance ? (
        <FieldInfoPreview anchorRef={anchorRef} content={guidance} />
      ) : null}
      {editorOpen && source && fieldKey ? (
        <FieldInfoPopover
          source={source}
          fieldKey={fieldKey}
          canEdit={canEdit}
          content={guidance}
          anchorRef={anchorRef}
          onClose={() => setEditorOpen(false)}
        />
      ) : null}
    </span>
  );
}

function FieldInfoPreview({
  anchorRef,
  content,
}: {
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  content: string;
}) {
  const position = useFieldInfoLayerPosition(anchorRef, 96);
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      role="tooltip"
      style={position.style}
      className="fixed z-[110] block w-80 rounded-md border border-[#d9dee7] bg-white p-3 text-left text-sm font-normal text-[#344054] shadow-lg"
    >
      {content || "No information has been added for this field."}
    </span>,
    document.body,
  );
}

function FieldInfoPopover({
  source,
  fieldKey,
  canEdit,
  content,
  anchorRef,
  onClose,
}: {
  source: FieldInfoSource;
  fieldKey: string;
  canEdit: boolean;
  content: string;
  anchorRef: React.RefObject<HTMLSpanElement | null>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(content);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const position = useFieldInfoLayerPosition(anchorRef, 280);
  useEffect(() => {
    const close = (event: Event) => {
      if (
        event.target instanceof Node &&
        !popoverRef.current?.contains(event.target) &&
        !anchorRef.current?.contains(event.target)
      )
        onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [anchorRef, onClose]);
  const save = useMutation({
    // Which app the field belongs to is the browser's business, not the note's.
    mutationFn: () =>
      upsertFieldNote({
        resourceType: source.resourceType,
        resourceId: source.resourceId,
        fieldKey,
        content: draft,
      }),
    onSuccess: () => {
      client.invalidateQueries({
        queryKey: ["field-notes", source.resourceType, source.resourceId],
      });
      onClose();
    },
  });
  if (typeof document === "undefined") return null;
  return createPortal(
    <span
      ref={popoverRef}
      role="dialog"
      aria-label="Field information"
      onClick={(event) => event.stopPropagation()}
      style={position.style}
      className="fixed z-[110] grid max-h-[calc(100vh-1.5rem)] w-80 gap-2 overflow-y-auto rounded-md border border-[#d9dee7] bg-white p-3 text-left shadow-lg"
    >
      <span className="flex items-center justify-between">
        <span className="text-sm font-semibold text-[#344054]">
          Field information
        </span>
        <button
          type="button"
          aria-label="Close field information"
          onClick={onClose}
          className="rounded p-1 text-[#667085] hover:bg-[#f2f4f7]"
        >
          <X size={15} />
        </button>
      </span>
      {canEdit ? (
        <textarea
          aria-label="Field information text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add guidance for coordinators"
          className="min-h-24 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
        />
      ) : (
        <p className="whitespace-pre-line text-sm font-normal leading-6 text-[#475467]">
          {draft.trim() || "No guidance for this field yet."}
        </p>
      )}
      <span className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm font-semibold text-[#475467]"
        >
          {canEdit ? "Cancel" : "Close"}
        </button>
        {canEdit ? (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save information"}
          </button>
        ) : null}
      </span>
    </span>,
    document.body,
  );
}

function useFieldInfoLayerPosition(
  anchorRef: React.RefObject<HTMLSpanElement | null>,
  estimatedHeight: number,
) {
  const [style, setStyle] = useState<React.CSSProperties>({
    left: 12,
    top: 12,
  });
  useLayoutEffect(() => {
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const gap = 8;
      const viewportPadding = 12;
      const availableBelow = window.innerHeight - bounds.bottom - gap;
      const availableAbove = bounds.top - gap;
      const showAbove =
        availableBelow < estimatedHeight && availableAbove > availableBelow;
      setStyle({
        left: Math.min(
          Math.max(viewportPadding, bounds.left),
          Math.max(viewportPadding, window.innerWidth - 320 - viewportPadding),
        ),
        top: showAbove
          ? Math.max(viewportPadding, bounds.top - gap)
          : bounds.bottom + gap,
        transform: showAbove ? "translateY(-100%)" : undefined,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, estimatedHeight]);
  return { style };
}
