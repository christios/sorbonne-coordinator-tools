import { ArrowDown, ArrowRight, ArrowUp, Check, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type ReactNode } from "react";

import { AddEntryButton } from "@/components/AddEntryButton";
import { type HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";
import { ScrollPane } from "@/components/ScrollPane";

/** A column of the CLO–PLO matrix: one PLO the curriculum mapping expects of the course. */
export type MatrixPlo = { id: string; code: string; outcome: string; /** "code: outcome", what a CLO stores. */ value: string };
/** A column of the competency matrix: one SCEN graduate competency, ticked per CLO. */
export type MatrixCompetency = {
  id: string;
  code: string;
  outcome: string;
  /** "code: outcome", what a CLO stores. */
  value: string;
  /** The SUAD graduate competencies it brings, as the catalogue maps them. */
  graduateIds: string[];
};
/** A SUAD graduate competency: a column that follows from the SCEN ones, never ticked itself. */
export type MatrixGraduate = { id: string; code: string; outcome: string };
type CloRow = Record<string, string> & { id: string };

type Props = {
  rows: CloRow[];
  plos: MatrixPlo[];
  competencies: MatrixCompetency[];
  graduates: MatrixGraduate[];
  /** Left out in Head-of-Department mode: the outcomes and their PLOs are then read, not edited. */
  onChange?: (rows: CloRow[]) => void;
  /**
   * The competencies on their own, for Head-of-Department mode: they are the teacher's in
   * either mode (Christian, 10 Nov 2026). Given the CLO's id and its competency ids.
   */
  onCompetenciesChange?: (cloId: string, skillIds: string[]) => void;
  history?: { onOpenHistory: (field: HistoryField) => void };
};

/*
 * The CLO–PLO matrix: one row per outcome, ruled between the PLOs so each tick reads against
 * its column — the outcome, a narrow column per PLO (their wording is in the panel beside the
 * matrices, which takes the room), then move/remove.
 */
const GRID = "grid [grid-template-columns:minmax(14rem,1fr)_repeat(var(--plos),2.25rem)_2.25rem]";
/*
 * The competency matrix: the outcome, a column per SCEN competency, an arrow, then a column per
 * SUAD graduate competency they bring. Narrower columns than the PLOs' so both groups fit beside
 * the panel on a laptop; below that the matrix scrolls sideways, the outcome column staying put.
 */
const COMPETENCY_GRID = "grid [grid-template-columns:minmax(8rem,1fr)_repeat(var(--scen),2rem)_1.5rem_repeat(var(--suad),2rem)]";
const RULE = "border-l border-[#c3cbd6]";
/*
 * Each matrix is a pane of its own (11 Nov 2026): on a large screen the section fills the
 * height and the panes scroll inside it, headings and totals staying in view, rather than the
 * whole section scrolling as one page. They share the height by what they hold, and neither
 * shrinks below a heading and a couple of rows.
 */
const PANE_SIZE = "lg:min-h-36 lg:flex-[0_1_auto]";
const PANE = "min-w-0 overflow-auto rounded-lg border border-[#c3cbd6] bg-white text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1f4e79]";

type Reference = "plos" | "scen" | "suad";
/** What the pointer or keyboard is on in the competency matrix, to light up what it links to. */
type Trace = { row?: string; scen?: string; suad?: string };

/**
 * Section 4's outcomes (November 2026 review). An alignment matrix with a row per course
 * learning outcome and a column per PLO the Head of Department's curriculum mapping expects of
 * the course, a tick where they align; a column nobody has ticked is flagged at its foot. Under
 * it, the competencies: a tick per CLO and SCEN competency, and past an arrow the SUAD graduate
 * competencies those ticks bring, which follow on their own. Beside both, a panel gives every
 * PLO and competency in full with what it is linked to.
 *
 * It stores what the list of cards did, so the document and the checks read it unchanged:
 * each CLO's `ploIds` and `plo` ("code: outcome", one per line), `skillIds` and `skills`.
 */
export function OutcomeAlignmentMatrix({ rows, plos, competencies, graduates, onChange, onCompetenciesChange, history }: Props) {
  const editable = Boolean(onChange);
  const [reference, setReference] = useState<Reference>("plos");
  const [revealed, setRevealed] = useState<string | null>(null);
  const reveal = (tab: Reference, id: string) => {
    setReference(tab);
    setRevealed(id);
  };
  const save = (next: CloRow[]) => onChange?.(next);
  const update = (id: string, change: Partial<CloRow>) => save(rows.map((row) => (row.id === id ? ({ ...row, ...change } as CloRow) : row)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    save(next);
  };
  // The competencies are the teacher's in either mode: through the row, or on their own.
  const setCompetencies = editable || onCompetenciesChange
    ? (row: CloRow, ids: string[]) => {
        const ordered = competencies.filter((competency) => ids.includes(competency.id));
        if (editable) update(row.id, { skills: ordered.map((item) => item.value).join("\n"), skillIds: ordered.map((item) => item.id).join("\n") });
        else onCompetenciesChange?.(row.id, ordered.map((item) => item.id));
      }
    : undefined;
  const covered = new Set(rows.flatMap((row) => alignedIds(row, plos)));
  const uncovered = plos.filter((plo) => !covered.has(plo.id));
  const style = { "--plos": plos.length } as CSSProperties;
  // The matrices keep the width the PLO columns need; the panel beside them takes the rest, from
  // 15 to 30rem, giving way first to the competency matrix so it fits whole on a laptop.
  const competencyWidth = `(8rem + ${competencies.length + graduates.length} * 2rem + 1.5rem)`;
  const sideBySide = {
    "--matrix-min": `calc(14rem + ${plos.length + 1} * 2.25rem)`,
    "--panel-max": `clamp(15rem, 100cqw - ${competencyWidth} - 2rem, 30rem)`,
  } as CSSProperties;

  const matrix = (
    <ScrollPane role="region" aria-label="Alignment to the programme learning outcomes" tabIndex={0} outerClassName={PANE_SIZE} className={PANE}>
      <div role="table" aria-label="Course learning outcomes and the programme learning outcomes each is aligned to" style={style}>
        <div role="row" data-pane-head className={`${GRID} sticky top-0 z-10 border-b border-[#c3cbd6] bg-[#e6ecf4] font-semibold text-[#1d2939]`}>
          <div role="columnheader" className="px-4 py-2.5">Course learning outcome</div>
          {plos.map((plo) => (
            <ColumnHead key={plo.id} code={plo.code} short={trailingNumber(plo.code) || plo.code} stackedOver={trailingNumber(plo.code) ? "PLO" : undefined} title={plo.outcome} onReveal={() => reveal("plos", plo.id)} />
          ))}
          <div role="columnheader" className={`${RULE} py-2.5`}><span className="sr-only">Move or remove</span></div>
        </div>
        {rows.map((row, index) => {
          const number = index + 1;
          const aligned = alignedIds(row, plos);
          const extras = extraLabels(row, plos);
          return (
            <div key={row.id} role="row" className={`${GRID} border-b border-[#d5dbe4] last:border-b-0`}>
              <div role="cell" className="min-w-0 px-4 py-3">
                {editable ? (
                  <HistoryTextField
                    label={`CLO ${number}`}
                    required
                    value={row.clo ?? ""}
                    onChange={(clo) => update(row.id, { clo })}
                    grow
                    history={history ? { field: { path: `learningOutcomes.clos[${row.id}].clo`, label: `CLO ${number} · Course learning outcome` }, onOpenHistory: history.onOpenHistory } : undefined}
                  />
                ) : (
                  <p className="text-[#344054]"><span className="font-semibold">CLO {number}</span> {row.clo}</p>
                )}
                {extras.length ? (
                  <p role="note" className="mt-2 rounded-md border border-[#f0d8a8] bg-[#fdf8ee] px-2 py-1 text-xs leading-5 text-[#8a6116]">
                    Also aligned to {extras.join("; ")}, which the curriculum mapping does not expect of this course.
                    {editable ? (
                      <button type="button" onClick={() => update(row.id, keepOnly(plos, aligned))} className="ml-1 inline-flex items-center gap-0.5 font-semibold underline underline-offset-2">
                        <X size={12} aria-hidden="true" /> Remove
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </div>
              {plos.map((plo) => (
                <TickCell
                  key={plo.id}
                  ticked={aligned.includes(plo.id)}
                  label={`CLO ${number} aligned to ${plo.code}`}
                  onToggle={editable ? () => update(row.id, toggled(row, plos, plo)) : undefined}
                />
              ))}
              <div role="cell" className={`${RULE} flex flex-col items-center justify-center gap-0.5 py-2`}>
                {editable ? (
                  <>
                    <IconButton label={`Move CLO ${number} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} aria-hidden="true" /></IconButton>
                    <IconButton label={`Move CLO ${number} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} aria-hidden="true" /></IconButton>
                    <IconButton label={`Remove CLO ${number}`} danger onClick={() => save(rows.filter((item) => item.id !== row.id))}><Trash2 size={15} aria-hidden="true" /></IconButton>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
        {rows.length === 0 ? <div role="row" className="px-4 py-4 text-[#475467]"><span role="cell">No course learning outcomes yet.</span></div> : null}
        {plos.length ? (
          // The coverage stays in view at the foot of the pane while the outcomes scroll.
          <div role="row" data-pane-foot className={`${GRID} sticky bottom-0 z-10 border-t border-[#c3cbd6] bg-[#f1f4f8]`}>
            <div role="rowheader" className="px-4 py-2 text-xs font-medium text-[#475467]">Each PLO aligned to at least one CLO</div>
            {plos.map((plo) => (
              <div key={plo.id} role="cell" className={`${RULE} flex items-center justify-center py-2`}>
                {covered.has(plo.id)
                  ? <Check size={16} strokeWidth={3} aria-label={`${plo.code} aligned`} className="text-[#1d6b47]" />
                  : <span title={`${plo.code} is not aligned to any CLO yet`} className="rounded-full bg-[#fef0c7] px-1 text-[10px] font-bold leading-4 text-[#8a4b00]">Not yet</span>}
              </div>
            ))}
            <div role="cell" className={RULE} />
          </div>
        ) : null}
      </div>
    </ScrollPane>
  );

  return (
    <div className="@container min-w-0 lg:h-full lg:min-h-0">
      <div style={sideBySide} className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:[grid-template-columns:minmax(var(--matrix-min),1fr)_minmax(15rem,var(--panel-max))] lg:h-full lg:min-h-0 lg:[grid-template-rows:minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto">
          {matrix}
          {editable ? (
            <div className="flex-none">
              <AddEntryButton onClick={() => save([...rows, { id: crypto.randomUUID(), clo: "", plo: "", ploIds: "", skills: "", skillIds: "" }])} label="Add outcome" />
            </div>
          ) : null}
          {competencies.length ? (
            <CompetencyMatrix rows={rows} competencies={competencies} graduates={graduates} onChange={setCompetencies} onReveal={reveal} />
          ) : (
            <p className="flex-none rounded-lg border border-[#f0d8a8] bg-[#fdf8ee] px-3 py-2 text-sm text-[#8a6116]">
              The department has no SCEN graduate competencies in its catalogue yet, so none can be chosen.
            </p>
          )}
        </div>
        <ReferencePanel
          tab={reference}
          onTab={(tab) => { setReference(tab); setRevealed(null); }}
          revealed={revealed}
          plos={plos}
          competencies={competencies}
          graduates={graduates}
          rows={rows}
          uncovered={uncovered}
        />
      </div>
    </div>
  );
}

/**
 * The competencies each outcome develops, as one matrix: the teacher ticks SCEN competencies,
 * and past the arrow the SUAD graduate competencies they bring light up on their own, so the
 * CLO → graduate competency mapping is read across the row. One SCEN competency often brings
 * several (SCEN-C2 brings three); pointing at a tick, or a heading, lights up what it is
 * linked to on the other side.
 */
function CompetencyMatrix({
  rows,
  competencies,
  graduates,
  onChange,
  onReveal,
}: {
  rows: CloRow[];
  competencies: MatrixCompetency[];
  graduates: MatrixGraduate[];
  onChange?: (row: CloRow, ids: string[]) => void;
  onReveal: (tab: Reference, id: string) => void;
}) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const scenCount = competencies.length;
  const style = { "--scen": scenCount, "--suad": graduates.length } as CSSProperties;
  const byId = new Map(competencies.map((item) => [item.id, item]));
  const chosenOf = new Map(rows.map((row) => [row.id, chosenIds(row, competencies)]));
  const sources = (rowId: string, graduate: MatrixGraduate) =>
    (chosenOf.get(rowId) ?? []).map((id) => byId.get(id)).filter((item): item is MatrixCompetency => Boolean(item?.graduateIds.includes(graduate.id)));
  // Headings light up for what is pointed at, and for what it links to on the other side.
  const scenLit = (competency: MatrixCompetency) =>
    trace?.scen === competency.id || Boolean(trace?.suad && competency.graduateIds.includes(trace.suad) && (!trace.row || chosenOf.get(trace.row)?.includes(competency.id)));
  const suadLit = (graduate: MatrixGraduate) =>
    trace?.suad === graduate.id || Boolean(trace?.scen && byId.get(trace.scen)?.graduateIds.includes(graduate.id));
  const leave = (event: FocusEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTrace(null);
  };
  const scenColumn = (index: number) => ({ gridColumn: index + 2 });
  const arrowColumn = { gridColumn: scenCount + 2 };
  const suadColumn = (index: number) => ({ gridColumn: scenCount + 3 + index });

  return (
    <ScrollPane role="region" aria-label="Competencies each outcome develops" tabIndex={0} outerClassName={PANE_SIZE} className={PANE} onMouseLeave={() => setTrace(null)} onBlur={leave}>
      <div role="table" aria-label="SCEN graduate competencies each course learning outcome develops, and the SUAD graduate competencies they bring" style={style} className="min-w-fit">
        <div data-pane-head className={`${COMPETENCY_GRID} sticky top-0 z-10 border-b border-[#c3cbd6] bg-[#e6ecf4] text-[#1d2939]`}>
          <div aria-hidden="true" className={`${RULE} row-start-1 px-2 pb-1 pt-2 text-xs leading-4`} style={{ gridColumn: `2 / span ${scenCount}` }}>
            <span className="block font-semibold">SCEN graduate competencies</span>
            <span className="block text-[11px] text-[#475467]">{onChange ? "Tick what each CLO develops" : "What each CLO develops"}</span>
          </div>
          <div aria-hidden="true" className="row-span-2 row-start-1 flex items-center justify-center text-[#475467]" style={arrowColumn}>
            <ArrowRight size={16} strokeWidth={2.5} />
          </div>
          {graduates.length ? (
            <div aria-hidden="true" className={`${RULE} row-start-1 px-2 pb-1 pt-2 text-xs leading-4`} style={{ gridColumn: `${scenCount + 3} / span ${graduates.length}` }}>
              <span className="block font-semibold">SUAD graduate competencies</span>
              <span className="block text-[11px] text-[#475467]">Equivalent competencies</span>
            </div>
          ) : null}
          <div role="row" className="contents">
            <div role="columnheader" data-pane-sticky-col className="sticky left-0 z-[1] col-start-1 row-span-2 row-start-1 flex items-end bg-[#e6ecf4] px-3 py-2 text-sm font-semibold">Outcome</div>
            {competencies.map((competency, index) => (
              <ColumnHead
                key={competency.id}
                code={competency.code}
                short={shortCode("C", competency.code)}
                title={competency.outcome}
                lit={scenLit(competency)}
                className="row-start-2"
                style={scenColumn(index)}
                onPoint={() => setTrace({ scen: competency.id })}
                onReveal={() => onReveal("scen", competency.id)}
              />
            ))}
            <div role="columnheader" className="row-start-2" style={arrowColumn}><span className="sr-only">Brings</span></div>
            {graduates.map((graduate, index) => (
              <ColumnHead
                key={graduate.id}
                code={graduate.code}
                short={shortCode("GC", graduate.code)}
                title={graduate.outcome}
                lit={suadLit(graduate)}
                className="row-start-2"
                style={suadColumn(index)}
                onPoint={() => setTrace({ suad: graduate.id })}
                onReveal={() => onReveal("suad", graduate.id)}
              />
            ))}
          </div>
        </div>
        {rows.map((row, index) => {
          const number = index + 1;
          const chosen = chosenOf.get(row.id) ?? [];
          return (
            <div key={row.id} role="row" className={`${COMPETENCY_GRID} border-b border-[#d5dbe4] last:border-b-0`}>
              <div role="rowheader" className="sticky left-0 z-[1] min-w-0 bg-white px-3 py-2">
                <p className="text-sm font-semibold text-[#1d2939]">CLO {number}</p>
                <p title={row.clo} className="truncate text-xs leading-5 text-[#475467]">{row.clo || "Not written yet"}</p>
              </div>
              {competencies.map((competency) => {
                const ticked = chosen.includes(competency.id);
                const linked = trace?.row === row.id && ticked && Boolean(trace.suad) && competency.graduateIds.includes(trace.suad ?? "");
                return (
                  <TickCell
                    key={competency.id}
                    compact
                    ticked={ticked}
                    linked={linked}
                    label={`CLO ${number} develops ${competency.code}`}
                    onPoint={() => setTrace({ row: row.id, scen: competency.id })}
                    onToggle={onChange ? () => onChange(row, ticked ? chosen.filter((id) => id !== competency.id) : [...chosen, competency.id]) : undefined}
                  />
                );
              })}
              <div role="cell" aria-hidden="true" className="flex items-center justify-center text-[#98a2b3]">
                <ArrowRight size={14} />
              </div>
              {chosen.length === 0 && graduates.length ? (
                <div role="cell" className={`${RULE} flex items-center px-2 text-xs font-medium text-[#8a4b00]`} style={{ gridColumn: `${scenCount + 3} / span ${graduates.length}` }}>
                  {onChange ? "Tick at least one SCEN competency" : "No SCEN competency yet"}
                </div>
              ) : (
                graduates.map((graduate) => {
                  const from = sources(row.id, graduate);
                  const linked = trace?.row === row.id && from.length > 0 && (trace.suad === graduate.id || from.some((item) => item.id === trace.scen));
                  return (
                    <div
                      key={graduate.id}
                      role="cell"
                      title={from.length ? `${graduate.code}, through ${from.map((item) => item.code).join(", ")}` : undefined}
                      onMouseEnter={from.length ? () => setTrace({ row: row.id, suad: graduate.id }) : undefined}
                      className={`${RULE} flex items-center justify-center ${from.length ? "bg-[#dcefe4]" : ""} ${linked ? "shadow-[inset_0_0_0_2px_#b54708]" : ""}`}
                    >
                      {from.length ? (
                        <Check size={15} strokeWidth={3} aria-label={`CLO ${number} develops ${graduate.code}, through ${from.map((item) => item.code).join(", ")}`} className="text-[#1d6b47]" />
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
        {rows.length === 0 ? <div role="row" className="px-4 py-4 text-[#475467]"><span role="cell">No course learning outcomes yet.</span></div> : null}
        {rows.length ? (
          <div role="row" data-pane-foot className={`${COMPETENCY_GRID} sticky bottom-0 z-10 border-t border-[#c3cbd6] bg-[#f1f4f8] text-[11px]`}>
            <div role="rowheader" className="sticky left-0 z-[1] bg-[#f1f4f8] px-3 py-2 text-xs font-medium text-[#475467]">Number of CLOs</div>
            {competencies.map((competency) => (
              <Count key={competency.id} value={rows.filter((row) => chosenOf.get(row.id)?.includes(competency.id)).length} />
            ))}
            <div role="cell" />
            {graduates.map((graduate) => (
              <Count key={graduate.id} value={rows.filter((row) => sources(row.id, graduate).length > 0).length} />
            ))}
          </div>
        ) : null}
      </div>
    </ScrollPane>
  );
}

function Count({ value }: { value: number }) {
  return (
    <div role="cell" className={`${RULE} flex items-center justify-center py-2 font-semibold ${value ? "text-[#1d2939]" : "text-[#98a2b3]"}`}>
      {value || "–"}
    </div>
  );
}

/**
 * A column heading one tick wide — "PLO" over "1", or "C4" — the full wording in the panel,
 * which opening the heading brings into view.
 */
function ColumnHead({
  code,
  short,
  stackedOver,
  title,
  lit = false,
  className = "",
  style,
  onPoint,
  onReveal,
}: {
  code: string;
  /** What fits one tick wide: "4", "C4", "GC1". */
  short: string;
  /** Written over the short form, as "PLO" over "1". */
  stackedOver?: string;
  title: string;
  lit?: boolean;
  className?: string;
  style?: CSSProperties;
  onPoint?: () => void;
  onReveal: () => void;
}) {
  return (
    <div role="columnheader" aria-label={code} style={style} className={`${RULE} ${className} flex`} onMouseEnter={onPoint}>
      <button
        type="button"
        onClick={onReveal}
        onFocus={onPoint}
        title={`${code}: ${title}`}
        aria-label={`${code}: show in full`}
        className={`flex w-full flex-col items-center justify-center text-center text-[11px] leading-tight ${stackedOver ? "py-1.5" : "py-1"} ${lit ? "bg-[#1f4e79] text-white" : "hover:bg-[#d5dfec]"}`}
      >
        {stackedOver ? <span aria-hidden="true" className={`font-medium ${lit ? "" : "text-[#344054]"}`}>{stackedOver}</span> : null}
        <span aria-hidden="true" className="font-semibold">{short || code}</span>
      </button>
    </div>
  );
}

function TickCell({
  ticked,
  label,
  onToggle,
  onPoint,
  compact = false,
  linked = false,
}: {
  ticked: boolean;
  label: string;
  onToggle?: () => void;
  onPoint?: () => void;
  compact?: boolean;
  linked?: boolean;
}) {
  return (
    <div role="cell" onMouseEnter={onPoint} className={`${RULE} flex items-center justify-center ${ticked ? "bg-[#d3e3f3]" : ""} ${linked ? "shadow-[inset_0_0_0_2px_#b54708]" : ""}`}>
      {onToggle ? (
        // The whole cell is the target, not a 16px box in the middle of it.
        <label className={`flex h-full w-full cursor-pointer items-center justify-center hover:bg-[#c5daef] ${compact ? "min-h-9" : "min-h-10"}`}>
          <input type="checkbox" checked={ticked} onChange={onToggle} onFocus={onPoint} aria-label={label} className={`cursor-pointer accent-[#1f4e79] ${compact ? "h-4 w-4" : "h-[18px] w-[18px]"}`} />
        </label>
      ) : ticked ? (
        <Check size={compact ? 16 : 18} strokeWidth={3} aria-label={label} className="text-[#1f4e79]" />
      ) : null}
    </div>
  );
}

/**
 * Beside the matrices, in view while they scroll: the PLOs, the SCEN competencies and the SUAD
 * graduate competencies in full, each with the CLOs it serves and what it is linked to.
 */
function ReferencePanel({
  tab,
  onTab,
  revealed,
  plos,
  competencies,
  graduates,
  rows,
  uncovered,
}: {
  tab: Reference;
  onTab: (tab: Reference) => void;
  revealed: string | null;
  plos: MatrixPlo[];
  competencies: MatrixCompetency[];
  graduates: MatrixGraduate[];
  rows: CloRow[];
  uncovered: MatrixPlo[];
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!revealed) return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("[data-reference]") ?? []);
    items.find((item) => item.dataset.reference === revealed)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [revealed, tab]);
  const numbers = (test: (row: CloRow) => boolean) => rows.flatMap((row, index) => (test(row) ? [index + 1] : []));
  const cloList = (list: number[]) => (list.length ? `CLO ${list.join(", ")}` : "");
  const byId = new Map(competencies.map((item) => [item.id, item]));
  const developing = (graduate: MatrixGraduate) =>
    numbers((row) => chosenIds(row, competencies).some((id) => byId.get(id)?.graduateIds.includes(graduate.id)));
  const tabs: Array<[Reference, string]> = [["plos", "PLOs"], ["scen", "SCEN"], ["suad", "SUAD"]];

  return (
    <aside ref={panel} aria-label="Reference" className="min-w-0 rounded-lg border border-[#c3cbd6] bg-[#f1f4f8] lg:flex lg:min-h-0 lg:flex-col">
      <div role="tablist" aria-label="Reference" className="flex gap-1 border-b border-[#c3cbd6] px-3 pt-2">
        {tabs.map(([id, name]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs font-semibold ${tab === id ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#475467] hover:text-[#1d2939]"}`}
          >
            {name}
          </button>
        ))}
      </div>
      <ScrollPane role="tabpanel" tabIndex={0} outerClassName="lg:min-h-0 lg:flex-1" className="overflow-y-auto p-3 focus-visible:outline-2 focus-visible:outline-[#1f4e79] lg:flex-1">
        {tab === "plos" ? (
          <>
            <h4 className="text-sm font-semibold text-[#1d2939]">Programme learning outcomes</h4>
            <p className="mt-0.5 text-xs text-[#475467]">
              {uncovered.length ? <span className="font-medium text-[#8a4b00]">{uncovered.map((plo) => plo.code).join(", ")} not aligned yet</span> : plos.length ? "Each one aligned to a CLO" : "The curriculum mapping expects none of this course"}
            </p>
            <ol className="mt-3 grid gap-2">
              {plos.map((plo) => (
                <ReferenceItem
                  key={plo.id}
                  id={plo.id}
                  revealed={revealed === plo.id}
                  code={plo.code}
                  text={plo.outcome || plo.code}
                  used={cloList(numbers((row) => alignedIds(row, plos).includes(plo.id)))}
                  missing="Not aligned yet"
                />
              ))}
            </ol>
          </>
        ) : tab === "scen" ? (
          <>
            <h4 className="text-sm font-semibold text-[#1d2939]">SCEN graduate competencies</h4>
            <p className="mt-0.5 text-xs text-[#475467]">Each brings the SUAD graduate competencies listed under it.</p>
            <ol className="mt-3 grid gap-2">
              {competencies.map((competency) => (
                <ReferenceItem
                  key={competency.id}
                  id={competency.id}
                  revealed={revealed === competency.id}
                  code={competency.code}
                  text={competency.outcome}
                  used={cloList(numbers((row) => chosenIds(row, competencies).includes(competency.id)))}
                  missing=""
                  links={graduates.filter((graduate) => competency.graduateIds.includes(graduate.id)).map((graduate) => graduate.code)}
                  linksLabel="Brings"
                />
              ))}
            </ol>
          </>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-[#1d2939]">SUAD graduate competencies</h4>
            <p className="mt-0.5 text-xs text-[#475467]">Developed through the SCEN competencies listed under each.</p>
            <ol className="mt-3 grid gap-2">
              {graduates.map((graduate) => (
                <ReferenceItem
                  key={graduate.id}
                  id={graduate.id}
                  revealed={revealed === graduate.id}
                  code={graduate.code}
                  text={graduate.outcome}
                  used={cloList(developing(graduate))}
                  missing=""
                  links={competencies.filter((competency) => competency.graduateIds.includes(graduate.id)).map((competency) => competency.code)}
                  linksLabel="Through"
                />
              ))}
            </ol>
          </>
        )}
      </ScrollPane>
    </aside>
  );
}

function ReferenceItem({
  id,
  revealed,
  code,
  text,
  used,
  missing,
  links,
  linksLabel,
}: {
  id: string;
  revealed: boolean;
  code: string;
  text: string;
  used: string;
  missing: string;
  links?: string[];
  linksLabel?: string;
}) {
  const warn = !used && Boolean(missing);
  return (
    <li
      data-reference={id}
      className={`rounded-md border px-2.5 py-2 ${warn ? "border-[#f0d8a8] bg-[#fdf8ee]" : "border-[#d5dbe4] bg-white"} ${revealed ? "ring-2 ring-[#1f4e79]" : ""}`}
    >
      <p className="flex items-center justify-between gap-2">
        <CodeBadge code={code} />
        <span className={`text-[11px] font-medium ${used ? "text-[#1d6b47]" : "text-[#8a4b00]"}`}>{used || missing}</span>
      </p>
      <p className="mt-1.5 text-xs leading-5 text-[#344054]">{text}</p>
      {links ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[#475467]">
          <span className="font-medium">{linksLabel}</span>
          {links.length ? links.map((link) => (
            <span key={link} className="rounded border border-[#c3cbd6] bg-[#f1f4f8] px-1 font-semibold leading-4 text-[#1d2939]">{link}</span>
          )) : <span>none in the catalogue</span>}
        </p>
      ) : null}
    </li>
  );
}

function CodeBadge({ code }: { code: string }) {
  return <span className="mt-px shrink-0 rounded-full bg-[#1f4e79] px-1.5 text-[11px] font-semibold leading-5 text-white">{code}</span>;
}

function IconButton({ label, disabled = false, danger = false, onClick, children }: { label: string; disabled?: boolean; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-label={label} title={label} className={`inline-flex h-7 w-7 items-center justify-center rounded-md disabled:text-[#c0c6cf] disabled:hover:bg-transparent ${danger ? "text-[#a6292f] hover:bg-[#fff1f2]" : "text-[#1f4e79] hover:bg-[#e8edf3]"}`}>
      {children}
    </button>
  );
}

function lines(value: string | undefined): string[] {
  return (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

/** "3" from "PLO 3", "SCEN-C3" or "GradComp 3": the number a column heading keeps. */
function trailingNumber(code: string): string {
  return /(\d+)\s*$/.exec(code)?.[1] ?? "";
}

/** "C3" for SCEN-C3, "GC1" for GradComp 1; a code without a number is kept whole. */
function shortCode(prefix: string, code: string): string {
  const number = trailingNumber(code);
  return number ? `${prefix}${number}` : code;
}

/** The competencies a CLO develops: by id, or for an older CLO by their wording. */
function chosenIds(row: CloRow, competencies: MatrixCompetency[]): string[] {
  const ids = lines(row.skillIds);
  if (ids.length) return competencies.filter((item) => ids.includes(item.id)).map((item) => item.id);
  const labels = lines(row.skills);
  return competencies
    .filter((item) => labels.some((label) => label === item.value || label === item.code || label.startsWith(`${item.code}:`)))
    .map((item) => item.id);
}

/** "PLO 3" from "PLO 3: …" or "PLO3", to match a CLO written before PLOs had ids. */
function ploNumber(value: string): string | undefined {
  const match = /^PLO\s*(\d+)\b/i.exec(value);
  return match ? match[1] : undefined;
}

function matches(label: string, plo: MatrixPlo): boolean {
  if (label === plo.value || label === plo.code || label.startsWith(`${plo.code}:`)) return true;
  const number = ploNumber(label);
  return number !== undefined && number === ploNumber(plo.code);
}

/** The columns a CLO is ticked in: by id, or for an older CLO by the PLOs' wording. */
function alignedIds(row: CloRow, plos: MatrixPlo[]): string[] {
  const ids = lines(row.ploIds);
  if (ids.length) return plos.filter((plo) => ids.includes(plo.id)).map((plo) => plo.id);
  const labels = lines(row.plo);
  return plos.filter((plo) => labels.some((label) => matches(label, plo))).map((plo) => plo.id);
}

/** PLOs a CLO is aligned to that are not columns: kept until removed, never dropped silently. */
function extraLabels(row: CloRow, plos: MatrixPlo[]): string[] {
  return lines(row.plo).filter((label) => !plos.some((plo) => matches(label, plo)));
}

function extraIds(row: CloRow, plos: MatrixPlo[]): string[] {
  return lines(row.ploIds).filter((id) => !plos.some((plo) => plo.id === id));
}

function toggled(row: CloRow, plos: MatrixPlo[], plo: MatrixPlo): Partial<CloRow> {
  const current = alignedIds(row, plos);
  const next = current.includes(plo.id) ? current.filter((id) => id !== plo.id) : [...current, plo.id];
  const ordered = plos.filter((item) => next.includes(item.id));
  return {
    ploIds: [...ordered.map((item) => item.id), ...extraIds(row, plos)].join("\n"),
    plo: [...ordered.map((item) => item.value), ...extraLabels(row, plos)].join("\n"),
  };
}

function keepOnly(plos: MatrixPlo[], aligned: string[]): Partial<CloRow> {
  const ordered = plos.filter((plo) => aligned.includes(plo.id));
  return { ploIds: ordered.map((plo) => plo.id).join("\n"), plo: ordered.map((plo) => plo.value).join("\n") };
}
