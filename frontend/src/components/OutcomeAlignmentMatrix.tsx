import { ArrowDown, ArrowRight, ArrowUp, Check, Trash2, X } from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { AddEntryButton } from "@/components/AddEntryButton";
import { type HistoryField } from "@/components/FieldHistory";
import { HistoryTextField } from "@/components/HistoryTextField";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";

/** A column of the matrix: one PLO the curriculum mapping expects of the course. */
export type MatrixPlo = { id: string; code: string; outcome: string; /** "code: outcome", what a CLO stores. */ value: string };
export type CompetencyOption = SelectOption & { catalogueId?: string };
type CloRow = Record<string, string> & { id: string };

type Props = {
  rows: CloRow[];
  plos: MatrixPlo[];
  competencyOptions: CompetencyOption[];
  /** The SUAD graduate competencies that follow from a CLO's SCEN competencies, one per line. */
  graduateText: (skills: string) => string;
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
 * Three ways of showing the competencies, built side by side for Christian to choose from
 * (11 Nov 2026): a second table under the CLO–PLO matrix, a tick matrix like the PLOs', or two
 * tabs. The switch is temporary; once one is chosen the others go.
 */
export type CompetencyLayout = "table" | "ticks" | "tabs";
const LAYOUT_KEY = "scen-outcomes-competency-layout";
const LAYOUTS: Array<[CompetencyLayout, string]> = [["table", "Second table"], ["ticks", "Tick matrix"], ["tabs", "Two tabs"]];

function readLayout(): CompetencyLayout {
  try {
    const kept = window.localStorage.getItem(LAYOUT_KEY);
    return kept === "ticks" || kept === "tabs" ? kept : "table";
  } catch {
    return "table";
  }
}

/*
 * The CLO–PLO matrix: one row per outcome, ruled between the PLOs so each tick reads against
 * its column — the outcome, a narrow column per PLO (their wording is in the panel beside the
 * matrix, which takes the room), then move/remove.
 */
const GRID = "grid [grid-template-columns:minmax(14rem,1fr)_repeat(var(--plos),2.25rem)_2.25rem]";
const RULE = "border-l border-[#c3cbd6]";

/**
 * Section 4's outcomes (November 2026 review): an alignment matrix with a row per course
 * learning outcome and a column per PLO the Head of Department's curriculum mapping expects of
 * the course, a tick where they align; a column nobody has ticked is flagged at its foot. Beside
 * it a panel, in view while the outcomes scroll, gives each PLO's wording and the CLOs serving
 * it. Then the competencies each outcome develops.
 *
 * It stores what the list of cards did, so the document and the checks read it unchanged:
 * each CLO's `ploIds` and `plo` ("code: outcome", one per line), `skillIds` and `skills`.
 */
export function OutcomeAlignmentMatrix({ rows, plos, competencyOptions, graduateText, onChange, onCompetenciesChange, history }: Props) {
  const editable = Boolean(onChange);
  const [layout, setLayoutState] = useState<CompetencyLayout>(readLayout);
  const [tab, setTab] = useState<"plos" | "competencies">("plos");
  const setLayout = (next: CompetencyLayout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_KEY, next);
    } catch {
      // Kept for this visit only.
    }
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
    ? (row: CloRow, labels: string[]) => {
        const skillIds = labels.map((label) => competencyOptions.find((option) => option.value === label)?.catalogueId).filter((id): id is string => Boolean(id));
        if (editable) update(row.id, { skills: labels.join("\n"), skillIds: skillIds.join("\n") });
        else onCompetenciesChange?.(row.id, skillIds);
      }
    : undefined;
  const covered = new Set(rows.flatMap((row) => alignedIds(row, plos)));
  const uncovered = plos.filter((plo) => !covered.has(plo.id));
  const style = { "--plos": plos.length } as CSSProperties;
  // The matrix keeps the width its columns need; the panel beside it takes the rest, up to 30rem.
  const sideBySide = { "--matrix-min": `calc(14rem + ${plos.length + 1} * 2.25rem)` } as CSSProperties;

  const matrix = (
    <div role="table" aria-label="Course learning outcomes and the programme learning outcomes each is aligned to" style={style} className="min-w-0 overflow-hidden rounded-lg border border-[#c3cbd6] text-sm">
      <div role="row" className={`${GRID} border-b border-[#c3cbd6] bg-[#e6ecf4] font-semibold text-[#1d2939]`}>
        <div role="columnheader" className="px-4 py-2.5">Course learning outcome</div>
        {plos.map((plo) => <StackedHeader key={plo.id} code={plo.code} title={plo.outcome} />)}
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
        <div role="row" className={`${GRID} border-t border-[#c3cbd6] bg-[#f1f4f8]`}>
          <div role="rowheader" className="px-4 py-2 text-xs font-medium text-[#475467]">Each PLO aligned to at least one CLO</div>
          {plos.map((plo) => (
            <div key={plo.id} role="cell" className={`${RULE} flex items-center justify-center py-2`}>
              {covered.has(plo.id)
                ? <Check size={16} strokeWidth={3} aria-label={`${plo.code} aligned`} className="text-[#1d6b47]" />
                : <span title={`${plo.code} is not aligned to any CLO yet`} className="rounded-full bg-[#fef0c7] px-1 text-[10px] font-bold leading-4 text-[#8a4b00]">Not yet</span>}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
  const addOutcome = editable ? <AddEntryButton onClick={() => save([...rows, { id: crypto.randomUUID(), clo: "", plo: "", ploIds: "", skills: "", skillIds: "" }])} label="Add outcome" /> : null;
  const competencyTable = <CompetencyTable rows={rows} options={competencyOptions} graduateText={graduateText} onChange={setCompetencies} />;
  const competencyTicks = <CompetencyTicks rows={rows} options={competencyOptions} graduateText={graduateText} onChange={setCompetencies} />;

  const left =
    layout === "tabs" ? (
      <>{matrix}{addOutcome}</>
    ) : (
      <>
        {matrix}
        {addOutcome}
        {layout === "ticks" ? competencyTicks : null}
      </>
    );

  return (
    <div className="@container grid gap-4">
      <LayoutSwitch layout={layout} onChange={setLayout} />
      {layout === "tabs" ? (
        <div role="tablist" aria-label="Learning outcomes" className="flex gap-1 border-b border-[#c3cbd6]">
          {([["plos", "PLO alignment"], ["competencies", "Competencies"]] as const).map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#475467] hover:text-[#1d2939]"}`}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
      {/* On the Competencies tab, the competencies alone, across the full width. */}
      {layout === "tabs" && tab === "competencies" ? competencyTable : (
      <div style={sideBySide} className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:[grid-template-columns:minmax(var(--matrix-min),1fr)_minmax(15rem,30rem)] @3xl:items-start">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">{left}</div>
        {plos.length || layout === "ticks" ? (
          <ReferencePanel plos={plos} rows={rows} uncovered={uncovered} competencies={layout === "ticks" ? competencyOptions : undefined} />
        ) : null}
      </div>
      )}
      {/* Under the matrix and its panel, across the full width: room for each pair. */}
      {layout === "table" ? competencyTable : null}
    </div>
  );
}

/** The temporary switch between the three layouts, until one is chosen. */
function LayoutSwitch({ layout, onChange }: { layout: CompetencyLayout; onChange: (layout: CompetencyLayout) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-[#98a2b3] bg-[#fffdf5] px-3 py-2 text-sm">
      <span className="font-medium text-[#344054]">Compare layouts</span>
      <span className="text-xs text-[#475467]">(temporary, to choose how competencies are shown)</span>
      <div className="ml-auto inline-flex rounded-md border border-[#b7bec8] bg-white p-0.5">
        {LAYOUTS.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={layout === id} onClick={() => onChange(id)} className={`rounded px-3 py-1 text-sm font-semibold ${layout === id ? "bg-[#1f4e79] text-white" : "text-[#1f4e79] hover:bg-[#f2f7fb]"}`}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "PLO" over "1": a heading one tick wide. */
function StackedHeader({ code, title }: { code: string; title: string }) {
  const match = /^(.*?)[\s-]*([A-Z]?\d+)$/.exec(code);
  return (
    <div role="columnheader" title={title} aria-label={code} className={`${RULE} flex flex-col items-center justify-center py-1.5 text-center text-[11px] leading-tight`}>
      <span aria-hidden="true" className="font-medium text-[#344054]">{match?.[1] || code}</span>
      <span aria-hidden="true">{match?.[2] ?? ""}</span>
    </div>
  );
}

function TickCell({ ticked, label, onToggle }: { ticked: boolean; label: string; onToggle?: () => void }) {
  return (
    <div role="cell" className={`${RULE} flex items-center justify-center ${ticked ? "bg-[#d3e3f3]" : ""}`}>
      {onToggle ? (
        // The whole cell is the target, not a 16px box in the middle of it.
        <label className="flex h-full min-h-10 w-full cursor-pointer items-center justify-center hover:bg-[#c5daef]">
          <input type="checkbox" checked={ticked} onChange={onToggle} aria-label={label} className="h-[18px] w-[18px] cursor-pointer accent-[#1f4e79]" />
        </label>
      ) : ticked ? (
        <Check size={18} strokeWidth={3} aria-label={label} className="text-[#1f4e79]" />
      ) : null}
    </div>
  );
}

/** "CLO 2" and the first words of its outcome, to say which row a competency belongs to. */
function CloName({ row, number }: { row: CloRow; number: number }) {
  return (
    <div className="min-w-0">
      <p className="text-sm font-semibold text-[#1d2939]">CLO {number}</p>
      <p title={row.clo} className="line-clamp-2 text-xs leading-5 text-[#475467]">{row.clo}</p>
    </div>
  );
}

/**
 * Layout 1 (and the second tab of layout 3): a table of the competencies each CLO develops —
 * a row per CLO, each SCEN competency in full beside the SUAD ones it brings.
 */
function CompetencyTable({ rows, options, graduateText, onChange }: { rows: CloRow[]; options: CompetencyOption[]; graduateText: (skills: string) => string; onChange?: (row: CloRow, labels: string[]) => void }) {
  return (
    <section aria-labelledby="competency-table" className="min-w-0 overflow-hidden rounded-lg border border-[#c3cbd6] text-sm">
      <h4 id="competency-table" className="border-b border-[#c3cbd6] bg-[#e6ecf4] px-4 py-2.5 font-semibold text-[#1d2939]">Competencies each CLO develops</h4>
      <div className="@container">
        <div className="hidden grid-cols-[9rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)] gap-3 border-b border-[#d5dbe4] bg-[#f1f4f8] px-4 py-2 text-xs font-medium text-[#344054] @2xl:grid">
          <span>Outcome</span>
          <span>SCEN graduate competencies{onChange ? <span aria-hidden="true" className="ml-0.5 text-[#a6292f]">*</span> : null}</span>
          <span aria-hidden="true" />
          <span>SUAD graduate competencies</span>
        </div>
        {rows.map((row, index) => (
          <div key={row.id} className="grid grid-cols-[minmax(0,1fr)] gap-2 border-b border-[#d5dbe4] px-4 py-3 last:border-b-0 @2xl:grid-cols-[9rem_minmax(0,1fr)] @2xl:gap-3">
            <CloName row={row} number={index + 1} />
            <CompetencyPairs number={index + 1} value={row.skills ?? ""} options={options} graduateText={graduateText} onChange={onChange ? (labels) => onChange(row, labels) : undefined} />
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * A CLO's SCEN competencies, each in full beside the SUAD graduate competencies it brings, an
 * arrow between. One often brings several (SCEN-C2 brings three): the arrow then points into a
 * bracket that holds them together.
 */
function CompetencyPairs({ number, value, options, graduateText, onChange }: { number: number; value: string; options: CompetencyOption[]; graduateText: (skills: string) => string; onChange?: (labels: string[]) => void }) {
  const chosen = lines(value);
  const remaining = options.filter((option) => !chosen.includes(option.value));
  return (
    <div className="@container grid min-w-0 gap-2">
      {chosen.length ? (
        <ul aria-label={`CLO ${number} SCEN graduate competencies`} className="grid gap-2">
          {chosen.map((label) => {
            const option = options.find((item) => item.value === label);
            const code = competencyCode(label, option);
            const suad = lines(graduateText(label));
            return (
              <li key={label} className="grid grid-cols-[minmax(0,1fr)] items-start gap-1 @sm:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] @sm:items-center @sm:gap-2">
                <div className="flex items-start gap-2 rounded-md border border-[#c3cbd6] bg-white px-2 py-1.5">
                  <CodeBadge code={code} />
                  <span className="min-w-0 flex-1 text-xs leading-5 text-[#344054]">{competencyWording(label, option)}</span>
                  {onChange ? (
                    <button type="button" onClick={() => onChange(chosen.filter((item) => item !== label))} aria-label={`Remove ${code} from CLO ${number}`} className="shrink-0 rounded p-0.5 text-[#475467] hover:bg-[#f2f4f7] hover:text-[#a6292f]">
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <ArrowRight size={16} aria-hidden="true" className="mx-auto hidden text-[#475467] @sm:block" />
                <SuadList code={code} lines={suad} />
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-[#667085]">{onChange ? "None chosen yet." : "—"}</p>}
      {onChange && remaining.length ? (
        <div className="max-w-xs">
          <SelectMenu label={`Add a SCEN competency to CLO ${number}`} size="small" value="" onChange={(next) => { if (next) onChange([...chosen, next]); }} placeholder="Add a competency…" options={remaining} />
        </div>
      ) : null}
    </div>
  );
}

function SuadList({ code, lines: suad }: { code: string; lines: string[] }) {
  return (
    <ul aria-label={`SUAD graduate competencies ${code} brings`} className={`grid gap-1 pl-4 ${suad.length > 1 ? "@sm:border-l-2 @sm:border-[#667085] @sm:pl-2" : "@sm:pl-0"}`}>
      {suad.length ? suad.map((line) => {
        const [suadCode, ...rest] = line.split(" — ");
        return (
          <li key={line} className="flex items-start gap-2 rounded-md border border-[#d5dbe4] bg-[#f1f4f8] px-2 py-1.5 text-xs leading-5 text-[#344054]">
            <span className="shrink-0 font-semibold text-[#1d2939]">{suadCode}</span>
            <span className="min-w-0">{rest.join(" — ")}</span>
          </li>
        );
      }) : <li className="px-2 py-1.5 text-xs text-[#667085]">None mapped in the catalogue</li>}
    </ul>
  );
}

/**
 * Layout 2: competencies chosen like the PLOs, a tick per CLO and SCEN competency; their
 * wording is in the panel's second tab. Under the grid, the SUAD competencies each CLO gets.
 */
function CompetencyTicks({ rows, options, graduateText, onChange }: { rows: CloRow[]; options: CompetencyOption[]; graduateText: (skills: string) => string; onChange?: (row: CloRow, labels: string[]) => void }) {
  const grid = "grid [grid-template-columns:minmax(10rem,1fr)_repeat(var(--competencies),2.25rem)]";
  const style = { "--competencies": options.length } as CSSProperties;
  return (
    <section aria-labelledby="competency-ticks" className="grid min-w-0 gap-3">
      <div role="table" aria-labelledby="competency-ticks" style={style} className="min-w-0 overflow-x-auto rounded-lg border border-[#c3cbd6] text-sm">
        <div role="row" className={`${grid} border-b border-[#c3cbd6] bg-[#e6ecf4] font-semibold text-[#1d2939]`}>
          <div role="columnheader" id="competency-ticks" className="px-4 py-2.5">SCEN graduate competencies</div>
          {options.map((option) => <StackedHeader key={option.value} code={competencyCode(option.value, option)} title={String(option.label)} />)}
        </div>
        {rows.map((row, index) => {
          const chosen = lines(row.skills);
          return (
            <div key={row.id} role="row" className={`${grid} border-b border-[#d5dbe4] last:border-b-0`}>
              <div role="cell" className="min-w-0 px-4 py-2"><CloName row={row} number={index + 1} /></div>
              {options.map((option) => {
                const ticked = chosen.includes(option.value);
                const code = competencyCode(option.value, option);
                return (
                  <TickCell
                    key={option.value}
                    ticked={ticked}
                    label={`CLO ${index + 1} develops ${code}`}
                    onToggle={onChange ? () => onChange(row, ticked ? chosen.filter((item) => item !== option.value) : options.map((item) => item.value).filter((value) => value === option.value || chosen.includes(value))) : undefined}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-[#c3cbd6] bg-[#f6f8fb] p-3">
        <h4 className="text-sm font-semibold text-[#1d2939]">SUAD graduate competencies each CLO develops</h4>
        <ul className="mt-2 grid gap-1.5">
          {rows.map((row, index) => {
            const suad = lines(graduateText(row.skills ?? ""));
            return (
              <li key={row.id} className="grid grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] items-start gap-1 text-xs leading-5">
                <span className="font-semibold text-[#1d2939]">CLO {index + 1}</span>
                <ArrowRight size={14} aria-hidden="true" className="mt-0.5 text-[#475467]" />
                <span className="text-[#344054]">{suad.length ? suad.map((line) => line.replace(" — ", ": ")).join(" · ") : <span className="text-[#667085]">none yet</span>}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * Beside the matrix, in view while the outcomes scroll: the PLOs in full, each with the CLOs
 * aligned to it — or flagged when none is. In the tick layout it has a second tab with the SCEN
 * competencies' wording.
 */
function ReferencePanel({ plos, rows, uncovered, competencies }: { plos: MatrixPlo[]; rows: CloRow[]; uncovered: MatrixPlo[]; competencies?: CompetencyOption[] }) {
  const [tab, setTab] = useState<"plos" | "competencies">("plos");
  const showing = competencies ? tab : "plos";
  const servedBy = (plo: MatrixPlo) => rows.flatMap((row, index) => (alignedIds(row, plos).includes(plo.id) ? [index + 1] : []));
  const developedBy = (option: CompetencyOption) => rows.flatMap((row, index) => (lines(row.skills).includes(option.value) ? [index + 1] : []));
  return (
    <aside aria-label="Reference" className="min-w-0 rounded-lg border border-[#c3cbd6] bg-[#f1f4f8] p-3 @3xl:sticky @3xl:top-0 @3xl:max-h-[calc(100dvh-16rem)] @3xl:overflow-y-auto">
      {competencies ? (
        <div role="tablist" aria-label="Reference" className="mb-3 inline-flex rounded-md border border-[#b7bec8] bg-white p-0.5">
          {([["plos", "PLOs"], ["competencies", "Competencies"]] as const).map(([id, name]) => (
            <button key={id} type="button" role="tab" aria-selected={showing === id} onClick={() => setTab(id)} className={`rounded px-3 py-1 text-xs font-semibold ${showing === id ? "bg-[#1f4e79] text-white" : "text-[#1f4e79] hover:bg-[#f2f7fb]"}`}>{name}</button>
          ))}
        </div>
      ) : null}
      {showing === "plos" ? (
        <>
          <h4 className="text-sm font-semibold text-[#1d2939]">Programme learning outcomes</h4>
          <p className="mt-0.5 text-xs text-[#475467]">
            {uncovered.length ? <span className="font-medium text-[#8a4b00]">{uncovered.map((plo) => plo.code).join(", ")} not aligned yet</span> : "Each one aligned to a CLO"}
          </p>
          <ol className="mt-3 grid gap-2">
            {plos.map((plo) => {
              const clos = servedBy(plo);
              return (
                <ReferenceItem key={plo.id} code={plo.code} text={plo.outcome || plo.code} used={clos.length ? `CLO ${clos.join(", ")}` : ""} missing="Not aligned yet" />
              );
            })}
          </ol>
        </>
      ) : (
        <>
          <h4 className="text-sm font-semibold text-[#1d2939]">SCEN graduate competencies</h4>
          <ol className="mt-3 grid gap-2">
            {(competencies ?? []).map((option) => {
              const clos = developedBy(option);
              return <ReferenceItem key={option.value} code={competencyCode(option.value, option)} text={String(option.label)} used={clos.length ? `CLO ${clos.join(", ")}` : ""} missing="" />;
            })}
          </ol>
        </>
      )}
    </aside>
  );
}

function ReferenceItem({ code, text, used, missing }: { code: string; text: string; used: string; missing: string }) {
  const warn = !used && Boolean(missing);
  return (
    <li className={`rounded-md border px-2.5 py-2 ${warn ? "border-[#f0d8a8] bg-[#fdf8ee]" : "border-[#d5dbe4] bg-white"}`}>
      <p className="flex items-center justify-between gap-2">
        <CodeBadge code={code} />
        <span className={`text-[11px] font-medium ${used ? "text-[#1d6b47]" : "text-[#8a4b00]"}`}>{used || missing}</span>
      </p>
      <p className="mt-1.5 text-xs leading-5 text-[#344054]">{text}</p>
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

function competencyCode(label: string, option?: CompetencyOption): string {
  if (option?.badge) return String(option.badge);
  return label.split(":")[0].trim();
}

function competencyWording(label: string, option?: CompetencyOption): string {
  if (option) return String(option.label);
  return label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : "";
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
