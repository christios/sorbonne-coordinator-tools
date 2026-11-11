import { ChevronRight, ListChecks } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { MissingForReview } from "@/services/syllabi";

type Section = { id: string; label: string };
type Card = { id: string; label: string };

/** How many cards a line of many shows before "+ N more". */
const SHOWN_CARDS = 4;

/**
 * What a syllabus must still say before it can be submitted for review (November 2026 review).
 *
 * A count that opens the list, grouped by section in screen order, each line taking the
 * teacher to what it names. Before review it stands where "Submit for review" would be; on a
 * departmental, published or submitted syllabus it only says what the template still needs.
 * The server keeps the rules; this only shows what it answered for the last saved version.
 *
 * Since 11 Nov 2026 a gap in schedule cards names them: a graded activity's gaps make one line
 * — its name, then what it lacks ("week", "CLOs assessed") — and a gap shared by many sessions
 * one line with the sessions as links. Opening one opens its card, unfolded, in the schedule.
 */
export function SubmissionChecklist({
  missing,
  sections,
  onOpenSection,
  onOpenItem,
  forReview = true,
}: {
  missing: MissingForReview[];
  sections: Section[];
  onOpenSection?: (section: string) => void;
  /** Opens one card of a section, unfolded; without it a card's line opens its section. */
  onOpenItem?: (section: string, itemId: string) => void;
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
  const openSection = onOpenSection
    ? (section: string) => {
        onOpenSection(section);
        setOpen(false);
      }
    : undefined;
  const openCard = onOpenItem || onOpenSection
    ? (section: string, id: string) => {
        if (onOpenItem) onOpenItem(section, id);
        else onOpenSection?.(section);
        setOpen(false);
      }
    : undefined;

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
          className="absolute right-0 z-30 mt-2 flex max-h-[min(36rem,75vh)] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[#d0d5dd] bg-white text-left shadow-[0_12px_32px_rgba(16,24,40,0.18)]"
        >
          <div className="flex-none border-b border-[#eaecf0] px-4 pb-3 pt-3.5">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#fef0c7] text-[#8a4b00]">
                <ListChecks size={15} />
              </span>
              <h3 className="text-sm font-semibold text-[#101828]">{forReview ? "Before you submit for review" : "Still to fill in"}</h3>
              <span className="ml-auto rounded-full bg-[#fef0c7] px-2 text-xs font-semibold leading-5 text-[#8a4b00]">
                {count} in {groups.length} section{groups.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[#475467]">
              {forReview
                ? "Submit for review appears once these are filled in. You can save and export the syllabus at any time."
                : "The syllabus template requires these. You can still save, export and publish the syllabus."}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {groups.map((group) => (
              <section key={group.id} aria-labelledby={`checklist-${group.id}`}>
                <h4 id={`checklist-${group.id}`} className="sticky top-0 z-10 bg-white px-2 pb-1 pt-3">
                  <button
                    type="button"
                    disabled={!openSection}
                    onClick={() => openSection?.(group.id)}
                    className="group/heading flex w-full items-center gap-2 text-left text-xs font-semibold text-[#344054] enabled:hover:text-[#1f4e79]"
                  >
                    {group.title}
                    <span aria-hidden="true" className="rounded-full bg-[#f2f4f7] px-1.5 text-[11px] font-semibold leading-4 text-[#475467]">{group.items.length}</span>
                    {openSection ? <span aria-hidden="true" className="ml-auto text-[11px] font-medium text-[#1f4e79] opacity-0 group-hover/heading:opacity-100">Open section</span> : null}
                  </button>
                </h4>
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                  {linesOf(group.items).map((line, index) => (
                    <li key={line.kind === "card" ? line.card.id : `${group.id}-${index}`}>
                      {line.kind === "card" ? (
                        <CardLine line={line} onOpen={openCard ? () => openCard(group.id, line.card.id) : undefined} />
                      ) : line.kind === "cards" ? (
                        <CardsLine line={line} onOpen={openCard ? (id) => openCard(group.id, id) : undefined} />
                      ) : (
                        <PlainLine message={line.message} onOpen={openSection ? () => openSection(group.id) : undefined} />
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

type Line =
  | { kind: "plain"; message: string }
  | { kind: "card"; card: Card; needs: string[] }
  | { kind: "cards"; summary: string; cards: Card[] };

const ROW = "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left";
const DOT = <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#f79009]" />;

function PlainLine({ message, onOpen }: { message: string; onOpen?: () => void }) {
  if (!onOpen) return <p className={`${ROW} text-sm text-[#344054]`}>{DOT}{message}</p>;
  return (
    <button type="button" onClick={onOpen} className={`${ROW} group/line text-sm text-[#344054] hover:bg-[#f2f7fb]`}>
      {DOT}
      <span className="min-w-0 flex-1">{message}</span>
      <ChevronRight size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#98a2b3] group-hover/line:text-[#1f4e79]" />
    </button>
  );
}

/** One card and everything it lacks, as words to tick off: "Essay — week · CLOs assessed". */
function CardLine({ line, onOpen }: { line: Extract<Line, { kind: "card" }>; onOpen?: () => void }) {
  const body = (
    <>
      {DOT}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-[#1d2939]">{line.card.label}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-[#667085]">Needs</span>
          {line.needs.map((need) => (
            <span key={need} className="rounded-md border border-[#f0d8a8] bg-[#fffaeb] px-1.5 text-[11px] font-medium leading-[18px] text-[#8a4b00]">{need}</span>
          ))}
        </span>
      </span>
    </>
  );
  if (!onOpen) return <div className={ROW}>{body}</div>;
  return (
    <button type="button" onClick={onOpen} aria-label={`${line.card.label}: needs ${line.needs.join(", ")}`} className={`${ROW} group/line hover:bg-[#f2f7fb]`}>
      {body}
      <ChevronRight size={15} aria-hidden="true" className="mt-0.5 shrink-0 text-[#98a2b3] group-hover/line:text-[#1f4e79]" />
    </button>
  );
}

/** A gap many sessions share, said once, the sessions as links to their cards. */
function CardsLine({ line, onOpen }: { line: Extract<Line, { kind: "cards" }>; onOpen?: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? line.cards : line.cards.slice(0, SHOWN_CARDS);
  const hidden = line.cards.length - shown.length;
  const chip = "max-w-full truncate rounded-md border px-1.5 text-[11px] font-medium leading-[18px]";
  return (
    <div className={ROW}>
      {DOT}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[#1d2939]">{line.summary}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {shown.map((card) =>
            onOpen ? (
              <button key={card.id} type="button" onClick={() => onOpen(card.id)} title={card.label} className={`${chip} border-[#c3cbd6] bg-white text-[#1f4e79] hover:border-[#1f4e79] hover:bg-[#f2f7fb]`}>
                {card.label}
              </button>
            ) : (
              <span key={card.id} title={card.label} className={`${chip} border-[#d5dbe4] bg-[#f8f9fb] text-[#344054]`}>{card.label}</span>
            ),
          )}
          {hidden > 0 ? (
            <button type="button" onClick={() => setAll(true)} className={`${chip} border-transparent text-[#475467] underline underline-offset-2 hover:text-[#1f4e79]`}>
              + {hidden} more
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The section's gaps as lines, in the server's order: a graded activity's gaps gather on the
 * line of its first one; a gap shared by many sessions is one line; anything else stays a
 * sentence. A list from an older server, without cards, reads as sentences, as before.
 */
function linesOf(items: MissingForReview[]): Line[] {
  const lines: Line[] = [];
  const byCard = new Map<string, Extract<Line, { kind: "card" }>>();
  for (const item of items) {
    const cards = (item.items ?? []).filter((card) => card.id);
    if (cards.length && item.summary) {
      lines.push({ kind: "cards", summary: item.summary, cards });
    } else if (cards.length === 1) {
      const card = cards[0];
      let line = byCard.get(card.id);
      if (!line) {
        line = { kind: "card", card, needs: [] };
        byCard.set(card.id, line);
        lines.push(line);
      }
      line.needs.push(item.need ?? item.message);
    } else {
      lines.push({ kind: "plain", message: item.message });
    }
  }
  return lines;
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
