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

type FieldInfoSource = { resourceType: string; resourceId: string };
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
  children,
}: {
  fieldKey?: string;
  children: React.ReactNode;
}) {
  const source = useContext(FieldInfoContext);
  const notes = useContext(FieldInfoNotesContext);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const note = notes.find((item) => item.fieldKey === fieldKey);
  const anchorRef = useRef<HTMLSpanElement>(null);
  if (!source || !fieldKey) return <>{children}</>;
  return (
    <span
      ref={anchorRef}
      className="group relative inline-flex items-center gap-1"
      onClick={() => setEditorOpen(true)}
    >
      <span className="cursor-pointer transition-colors hover:text-[#1f4e79]">
        {children}
      </span>
      {note ? (
        <span
          role="img"
          aria-label={`Field information for ${String(children)}`}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={() => setPreviewOpen(true)}
          onMouseLeave={() => setPreviewOpen(false)}
          className="p-0.5 text-[#667085]"
        >
          <Info size={15} />
        </span>
      ) : null}
      {previewOpen && note ? (
        <FieldInfoPreview anchorRef={anchorRef} content={note.content} />
      ) : null}
      {editorOpen ? (
        <FieldInfoPopover
          source={source}
          fieldKey={fieldKey}
          content={note?.content ?? ""}
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
  content,
  anchorRef,
  onClose,
}: {
  source: FieldInfoSource;
  fieldKey: string;
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
    mutationFn: () => upsertFieldNote({ ...source, fieldKey, content: draft }),
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
      <textarea
        aria-label="Field information text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Add guidance for coordinators"
        className="min-h-24 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-normal text-[#344054] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
      />
      <span className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-sm font-semibold text-[#475467]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="rounded-md bg-[#1f4e79] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save information"}
        </button>
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
