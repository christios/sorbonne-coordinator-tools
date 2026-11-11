import { ChevronRight, ListChecks } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { MissingForReview } from "@/services/syllabi";

type Section = { id: string; label: string };

/**
 * What a syllabus must still say before it can be submitted for review (November 2026 review).
 *
 * A count that opens the list, grouped by section in screen order, each line taking the
 * teacher to its section. Before review it stands where "Submit for review" would be; on a
 * departmental, published or submitted syllabus it only says what the template still needs.
 * The server keeps the rules; this only shows what it answered for the last saved version.
 */
export function SubmissionChecklist({
  missing,
  sections,
  onOpenSection,
  forReview = true,
}: {
  missing: MissingForReview[];
  sections: Section[];
  onOpenSection?: (section: string) => void;
  /** Whether Submit for review is waiting on this list. */
  forReview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const groups = groupBySection(missing, sections);
  const count = missing.length;
  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-2 rounded-md border border-[#f0c36d] bg-[#fffaeb] px-3 py-2 text-sm font-semibold text-[#8a4b00] hover:bg-[#fef0c7]"
      >
        <ListChecks size={17} aria-hidden="true" />
        {count} to fill in{forReview ? " before review" : ""}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label={forReview ? "Still to fill in before review" : "Still to fill in"}
          className="absolute right-0 z-30 mt-2 max-h-[70vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-[#d0d5dd] bg-white p-4 text-left shadow-lg"
        >
          <h3 className="text-sm font-semibold text-[#101828]">{forReview ? "Before you submit for review" : "Still to fill in"}</h3>
          <p className="mt-1 text-xs text-[#475467]">
            {forReview
              ? "Submit for review appears once these are filled in. You can save and export the syllabus at any time."
              : "The syllabus template requires these. You can still save, export and publish the syllabus."}
          </p>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-3">
            {groups.map((group) => (
              <section key={group.id}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-[#475467]">{group.title}</h4>
                <ul className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-1">
                  {group.items.map((item, index) => (
                    <li key={`${group.id}-${index}`}>
                      {onOpenSection ? (
                        <button
                          type="button"
                          onClick={() => {
                            onOpenSection(group.id);
                            setOpen(false);
                          }}
                          className="flex w-full items-start gap-1 rounded px-1 py-0.5 text-left text-sm text-[#344054] hover:bg-[#f2f7fb]"
                        >
                          <span className="min-w-0 flex-1">{item.message}</span>
                          <ChevronRight size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#667085]" />
                        </button>
                      ) : (
                        <span className="text-sm text-[#344054]">{item.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupBySection(missing: MissingForReview[], sections: Section[]) {
  const groups: Array<{ id: string; title: string; items: MissingForReview[] }> = [];
  for (const item of missing) {
    let group = groups.find((entry) => entry.id === item.section);
    if (!group) {
      group = { id: item.section, title: sections.find((section) => section.id === item.section)?.label ?? item.section, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
