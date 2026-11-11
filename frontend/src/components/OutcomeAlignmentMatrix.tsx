import { ArrowDown, ArrowRight, ArrowUp, Check, Trash2, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

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
 * Every row is a grid on the same columns, ruled between the PLOs so each tick reads against
 * its column: the outcome, a narrow column per PLO (their wording is in the panel beside the
 * matrix, which takes the room — Christian, 11 Nov 2026), then move/remove. Under each outcome, across the whole row, the SCEN
 * competencies it develops sit beside the SUAD graduate competencies each one brings.
 */
const GRID = "grid [grid-template-columns:minmax(14rem,1fr)_repeat(var(--plos),2.25rem)_2.25rem]";
const PLO_RULE = "border-l border-[#c3cbd6]";

/**
 * Section 4's outcomes as an alignment matrix (November 2026 review): a row per course
 * learning outcome, a column per PLO the Head of Department's curriculum mapping expects of
 * the course, a tick where they align. A column nobody has ticked is flagged at its foot —
 * every expected PLO must be served at least once. Beside the matrix (under it when narrow),
 * a panel that stays in view while the outcomes scroll gives each PLO's wording and the CLOs
 * that serve it.
 *
 * It stores what the list of cards did, so the document and the checks read it unchanged:
 * each CLO's `ploIds` and `plo` ("code: outcome", one per line), `skillIds` and `skills`.
 */
export function OutcomeAlignmentMatrix({ rows, plos, competencyOptions, graduateText, onChange, onCompetenciesChange, history }: Props) {
  const editable = Boolean(onChange);
  const save = (next: CloRow[]) => onChange?.(next);
  const update = (id: string, change: Partial<CloRow>) => save(rows.map((row) => (row.id === id ? ({ ...row, ...change } as CloRow) : row)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row);
    save(next);
  };
  const covered = new Set(rows.flatMap((row) => alignedIds(row, plos)));
  const uncovered = plos.filter((plo) => !covered.has(plo.id));
  const style = { "--plos": plos.length } as CSSProperties;
  // The matrix keeps the width its columns need; the PLO panel beside it takes the rest, up to
  // 30rem, and gives way first on a narrower screen.
  const layout = { "--matrix-min": `calc(14rem + ${plos.length + 1} * 2.25rem)` } as CSSProperties;

  return (
    <div className="@container">
    <div style={layout} className="grid grid-cols-[minmax(0,1fr)] gap-4 @3xl:[grid-template-columns:minmax(var(--matrix-min),1fr)_minmax(15rem,30rem)] @3xl:items-start">
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div role="table" aria-label="Course learning outcomes and the programme learning outcomes each is aligned to" style={style} className="min-w-0 overflow-hidden rounded-lg border border-[#c3cbd6] text-sm">
        <div role="row" className={`${GRID} border-b border-[#c3cbd6] bg-[#e6ecf4] font-semibold text-[#1d2939]`}>
          <div role="columnheader" className="px-4 py-2.5">Course learning outcome</div>
          {plos.map((plo) => (
            <div key={plo.id} role="columnheader" title={plo.outcome} aria-label={plo.code} className={`${PLO_RULE} flex flex-col items-center justify-center py-1.5 text-center text-[11px] leading-tight`}>
              {/* "PLO" over its number, to fit a column one tick wide. */}
              <span aria-hidden="true" className="font-medium text-[#344054]">{/^(.*?)\s*(\d+)$/.exec(plo.code)?.[1] ?? plo.code}</span>
              <span aria-hidden="true">{/^(.*?)\s*(\d+)$/.exec(plo.code)?.[2] ?? ""}</span>
            </div>
          ))}
          <div role="columnheader" className={`${PLO_RULE} py-2.5`}><span className="sr-only">Move or remove</span></div>
        </div>

        {rows.map((row, index) => {
          const number = index + 1;
          const aligned = alignedIds(row, plos);
          const extras = extraLabels(row, plos);
          return (
            <div key={row.id} role="row" className={`${GRID} border-b border-[#d5dbe4] last:border-b-0`}>
              <div role="cell" className="col-start-1 row-start-1 min-w-0 px-4 py-3">
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

              {plos.map((plo, column) => {
                const ticked = aligned.includes(plo.id);
                return (
                  <div key={plo.id} role="cell" style={{ gridColumn: column + 2, gridRow: 1 }} className={`${PLO_RULE} flex items-center justify-center ${ticked ? "bg-[#d3e3f3]" : ""}`}>
                    {editable ? (
                      // The whole cell is the target, not a 16px box in the middle of it.
                      <label className="flex h-full w-full cursor-pointer items-center justify-center hover:bg-[#c5daef]">
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={() => update(row.id, toggled(row, plos, plo))}
                          aria-label={`CLO ${number} aligned to ${plo.code}`}
                          className="h-[18px] w-[18px] cursor-pointer accent-[#1f4e79]"
                        />
                      </label>
                    ) : ticked ? (
                      <Check size={18} strokeWidth={3} aria-label={`CLO ${number} aligned to ${plo.code}`} className="text-[#1f4e79]" />
                    ) : null}
                  </div>
                );
              })}

              <div role="cell" className="col-span-full row-start-2 min-w-0 border-t border-dashed border-[#c3cbd6] bg-[#f6f8fb] px-4 py-3">
                <CompetencyChips
                  number={number}
                  value={row.skills ?? ""}
                  options={competencyOptions}
                  graduateText={graduateText}
                  onChange={editable || onCompetenciesChange ? (skills) => {
                    const skillIds = lines(skills).map((label) => competencyOptions.find((option) => option.value === label)?.catalogueId).filter((id): id is string => Boolean(id));
                    if (editable) update(row.id, { skills, skillIds: skillIds.join("\n") });
                    else onCompetenciesChange?.(row.id, skillIds);
                  } : undefined}
                />
              </div>

              <div role="cell" style={{ gridColumn: plos.length + 2, gridRow: 1 }} className={`${PLO_RULE} flex flex-col items-center justify-center gap-0.5 py-2`}>
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
            {plos.map((plo, column) => (
              <div key={plo.id} role="cell" style={{ gridColumn: column + 2 }} className={`${PLO_RULE} flex items-center justify-center py-2`}>
                {covered.has(plo.id)
                  ? <Check size={16} aria-label={`${plo.code} aligned`} className="text-[#24805a]" />
                  : <span title={`${plo.code} is not aligned to any CLO yet`} className="rounded-full bg-[#fef0c7] px-1 text-[10px] font-bold leading-4 text-[#8a4b00]">Not yet</span>}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {editable ? <AddEntryButton onClick={() => save([...rows, { id: crypto.randomUUID(), clo: "", plo: "", ploIds: "", skills: "", skillIds: "" }])} label="Add outcome" /> : null}
    </div>
      {plos.length ? <PloPanel plos={plos} rows={rows} uncovered={uncovered} /> : null}
    </div>
    </div>
  );
}

/**
 * The PLOs this course serves, worded in full, each with the CLOs aligned to it — or flagged
 * when none is. Beside the matrix it stays in view while the outcomes scroll under it.
 */
function PloPanel({ plos, rows, uncovered }: { plos: MatrixPlo[]; rows: CloRow[]; uncovered: MatrixPlo[] }) {
  const servedBy = (plo: MatrixPlo) => rows.flatMap((row, index) => (alignedIds(row, plos).includes(plo.id) ? [index + 1] : []));
  return (
    <aside aria-labelledby="matrix-plos" className="min-w-0 rounded-lg border border-[#c3cbd6] bg-[#f1f4f8] p-3 @3xl:sticky @3xl:top-0 @3xl:max-h-[calc(100dvh-16rem)] @3xl:overflow-y-auto">
      <h4 id="matrix-plos" className="text-sm font-semibold text-[#344054]">Programme learning outcomes</h4>
      <p className="mt-0.5 text-xs text-[#475467]">
        {uncovered.length ? <span className="font-medium text-[#8a4b00]">{uncovered.map((plo) => plo.code).join(", ")} not aligned yet</span> : "Each one aligned to a CLO"}
      </p>
      <ol className="mt-3 grid gap-2">
        {plos.map((plo) => {
          const clos = servedBy(plo);
          return (
            <li key={plo.id} className={`rounded-md border bg-white px-2.5 py-2 ${clos.length ? "border-[#d5dbe4]" : "border-[#f0d8a8] bg-[#fdf8ee]"}`}>
              <p className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-[#1f4e79] px-2 py-0.5 text-xs font-semibold text-white">{plo.code}</span>
                <span className={`text-[11px] font-medium ${clos.length ? "text-[#1d6b47]" : "text-[#8a4b00]"}`}>
                  {clos.length ? `CLO ${clos.join(", ")}` : "Not aligned yet"}
                </span>
              </p>
              <p className="mt-1.5 text-xs leading-5 text-[#475467]">{plo.outcome || plo.code}</p>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/**
 * A CLO's SCEN competencies, each in full beside the SUAD graduate competencies it brings,
 * an arrow between them: what the teacher chooses on the left, what follows on the right.
 */
function CompetencyChips({ number, value, options, graduateText, onChange }: { number: number; value: string; options: CompetencyOption[]; graduateText: (skills: string) => string; onChange?: (value: string) => void }) {
  const chosen = lines(value);
  const remaining = options.filter((option) => !chosen.includes(option.value));
  return (
    <div className="@container grid gap-2">
      <div className={`hidden grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] gap-2 text-xs font-medium text-[#475467] ${chosen.length ? "@sm:grid" : ""}`}>
        <span>SCEN graduate competencies{onChange ? <span aria-hidden="true" className="ml-0.5 text-[#a6292f]">*</span> : null}</span>
        <span aria-hidden="true" />
        <span>SUAD graduate competencies</span>
      </div>
      <p className={`text-xs font-medium text-[#475467] ${chosen.length ? "@sm:hidden" : ""}`}>SCEN graduate competencies{onChange ? <span aria-hidden="true" className="ml-0.5 text-[#a6292f]">*</span> : null}</p>
      {chosen.length ? (
        <ul aria-label={`CLO ${number} SCEN graduate competencies`} className="grid gap-2">
          {chosen.map((label) => {
            const option = options.find((item) => item.value === label);
            const code = competencyCode(label, option);
            const wording = option ? String(option.label) : label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : "";
            const suad = lines(graduateText(label));
            return (
              // One SCEN competency often brings several SUAD ones (SCEN-C2 brings three): the
              // arrow points into a bracket that holds them together, the SCEN one centred on it.
              <li key={label} className="grid grid-cols-[minmax(0,1fr)] items-start gap-1 @sm:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] @sm:items-center @sm:gap-2">
                <div className="flex items-start gap-2 rounded-md border border-[#c3cbd6] bg-white px-2 py-1.5">
                  <span className="mt-px shrink-0 rounded-full bg-[#1f4e79] px-1.5 text-[11px] font-semibold leading-5 text-white">{code}</span>
                  <span className="min-w-0 flex-1 text-xs leading-5 text-[#344054]">{wording}</span>
                  {onChange ? (
                    <button type="button" onClick={() => onChange(chosen.filter((item) => item !== label).join("\n"))} aria-label={`Remove ${code} from CLO ${number}`} className="shrink-0 rounded p-0.5 text-[#475467] hover:bg-[#f2f4f7] hover:text-[#a6292f]">
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <ArrowRight size={16} aria-hidden="true" className="mx-auto hidden text-[#475467] @sm:block" />
                <ul aria-label={`SUAD graduate competencies ${code} brings`} className={`grid gap-1 pl-4 ${suad.length > 1 ? "@sm:border-l-2 @sm:border-[#667085] @sm:pl-2" : "@sm:pl-0"}`}>
                  {suad.length ? suad.map((line) => {
                    const [suadCode, ...rest] = line.split(" — ");
                    return (
                      <li key={line} className="flex items-start gap-2 rounded-md border border-[#d5dbe4] bg-[#f1f4f8] px-2 py-1.5 text-xs leading-5 text-[#475467]">
                        <span className="shrink-0 font-semibold text-[#344054]">{suadCode}</span>
                        <span className="min-w-0">{rest.join(" — ")}</span>
                      </li>
                    );
                  }) : <li className="px-2 py-1.5 text-xs text-[#667085]">None mapped in the catalogue</li>}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-[#667085]">{onChange ? "None chosen yet." : "—"}</p>}
      {onChange && remaining.length ? (
        <div className="max-w-xs">
          <SelectMenu label={`Add a SCEN competency to CLO ${number}`} size="small" value="" onChange={(next) => { if (next) onChange([...chosen, next].join("\n")); }} placeholder="Add a competency…" options={remaining} />
        </div>
      ) : null}
    </div>
  );
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
