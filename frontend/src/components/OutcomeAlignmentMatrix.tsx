import { ArrowDown, ArrowUp, Check, Trash2, X } from "lucide-react";
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
 * Every row is a grid on the same columns, so the columns line up down the matrix, and the
 * layout is chosen by the matrix's own width rather than the window's:
 *
 * - narrow: the outcome, its PLO ticks, then move/remove; its competencies under its wording;
 * - wide (`@5xl`): the outcome capped at 28rem so its lines stay readable, the ticks, then the
 *   competencies in a column of their own, as the document's table has them.
 *
 * The PLO ticks are therefore always beside the outcome, never scrolled out of sight.
 */
const GRID = "grid [grid-template-columns:minmax(0,1fr)_repeat(var(--plos),2.75rem)_5.5rem] @5xl:[grid-template-columns:minmax(0,28rem)_repeat(var(--plos),3.25rem)_minmax(0,1fr)_5.5rem]";
const COMPETENCIES_CELL = "col-start-1 row-start-2 @5xl:row-start-1 @5xl:[grid-column:calc(var(--plos)_+_2)]";
const ACTIONS_CELL = "row-span-2 [grid-column:calc(var(--plos)_+_2)] @5xl:row-span-1 @5xl:[grid-column:calc(var(--plos)_+_3)]";

/**
 * Section 4's outcomes as an alignment matrix (November 2026 review): a row per course
 * learning outcome, a column per PLO the Head of Department's curriculum mapping expects of
 * the course, a tick where they align. A column nobody has ticked is flagged at its foot —
 * every expected PLO must be served at least once — and the PLOs and competencies are written
 * out in full under the matrix, where nothing is cut short.
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
  const chosenCompetencies = uniqueCompetencies(rows, competencyOptions);
  const style = { "--plos": plos.length } as CSSProperties;

  return (
    <div className="@container grid grid-cols-[minmax(0,1fr)] gap-4">
      <div role="table" aria-label="Course learning outcomes and the programme learning outcomes each is aligned to" style={style} className="min-w-0 overflow-hidden rounded-lg border border-[#d9dee7] text-sm">
        <div role="row" className={`${GRID} border-b border-[#d9dee7] bg-[#f8fafc] font-semibold text-[#344054]`}>
          <div role="columnheader" className="px-4 py-2.5">Course learning outcome</div>
          {plos.map((plo) => (
            <div key={plo.id} role="columnheader" title={plo.outcome} className="px-0.5 py-2.5 text-center text-xs">{plo.code}</div>
          ))}
          <div role="columnheader" className="hidden px-3 py-2.5 @5xl:block">SCEN competencies</div>
          <div role="columnheader" className="px-2 py-2.5"><span className="sr-only">Move or remove</span></div>
        </div>

        {rows.map((row, index) => {
          const number = index + 1;
          const aligned = alignedIds(row, plos);
          const extras = extraLabels(row, plos);
          return (
            <div key={row.id} role="row" className={`${GRID} border-b border-[#e5e7eb] last:border-b-0`}>
              <div role="cell" className="col-start-1 row-start-1 min-w-0 px-4 pt-3 @5xl:pb-3">
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
                  <div key={plo.id} role="cell" style={{ gridColumn: column + 2 }} className={`row-span-2 flex justify-center @5xl:row-span-1 ${ticked ? "bg-[#f2f7fb]" : ""}`}>
                    {editable ? (
                      // The whole cell is the target, not a 16px box in the middle of it.
                      <label className="flex w-full cursor-pointer justify-center pt-8 hover:bg-[#e8f0f8]">
                        <input
                          type="checkbox"
                          checked={ticked}
                          onChange={() => update(row.id, toggled(row, plos, plo))}
                          aria-label={`CLO ${number} aligned to ${plo.code}`}
                          className="h-[18px] w-[18px] cursor-pointer accent-[#1f4e79]"
                        />
                      </label>
                    ) : ticked ? (
                      <Check size={18} aria-label={`CLO ${number} aligned to ${plo.code}`} className="mt-8 text-[#1f4e79]" />
                    ) : null}
                  </div>
                );
              })}

              <div role="cell" className={`${COMPETENCIES_CELL} min-w-0 px-4 pb-3 pt-2 @5xl:px-3 @5xl:pt-8`}>
                <CompetencyChips
                  number={number}
                  value={row.skills ?? ""}
                  options={competencyOptions}
                  graduate={graduateText(row.skills ?? "")}
                  onChange={editable || onCompetenciesChange ? (skills) => {
                    const skillIds = lines(skills).map((label) => competencyOptions.find((option) => option.value === label)?.catalogueId).filter((id): id is string => Boolean(id));
                    if (editable) update(row.id, { skills, skillIds: skillIds.join("\n") });
                    else onCompetenciesChange?.(row.id, skillIds);
                  } : undefined}
                />
              </div>

              <div role="cell" className={`${ACTIONS_CELL} flex items-start justify-end gap-0.5 px-1.5 pt-7`}>
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
        {rows.length === 0 ? <div role="row" className="px-4 py-4 text-[#667085]"><span role="cell">No course learning outcomes yet.</span></div> : null}

        {plos.length ? (
          <div role="row" className={`${GRID} border-t border-[#d9dee7] bg-[#f8fafc]`}>
            <div role="rowheader" className="px-4 py-2 text-xs font-medium text-[#667085]">Each PLO aligned to at least one CLO</div>
            {plos.map((plo, column) => (
              <div key={plo.id} role="cell" style={{ gridColumn: column + 2 }} className="flex items-center justify-center py-2">
                {covered.has(plo.id)
                  ? <Check size={16} aria-label={`${plo.code} aligned`} className="text-[#24805a]" />
                  : <span title={`${plo.code} is not aligned to any CLO yet`} className="rounded-full bg-[#fef0c7] px-1 text-[10px] font-bold leading-4 text-[#8a4b00]">Not yet</span>}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {editable ? <AddEntryButton onClick={() => save([...rows, { id: crypto.randomUUID(), clo: "", plo: "", ploIds: "", skills: "", skillIds: "" }])} label="Add outcome" /> : null}

      {plos.length ? (
        <Legend
          title="Programme learning outcomes this course serves"
          note={uncovered.length ? `${uncovered.map((plo) => plo.code).join(", ")}: not aligned yet` : ""}
          items={plos.map((plo) => ({ code: plo.code, text: plo.outcome || plo.code, warn: !covered.has(plo.id) }))}
        />
      ) : null}
      {chosenCompetencies.length ? <Legend title="SCEN graduate competencies chosen" items={chosenCompetencies} /> : null}
    </div>
  );
}

/** A CLO's competencies as their codes; the wording is in the list under the matrix and on hover. */
function CompetencyChips({ number, value, options, graduate, onChange }: { number: number; value: string; options: CompetencyOption[]; graduate: string; onChange?: (value: string) => void }) {
  const chosen = lines(value);
  const remaining = options.filter((option) => !chosen.includes(option.value));
  const suad = lines(graduate);
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-[#475467] @5xl:sr-only">
        SCEN competencies{onChange ? <span aria-hidden="true" className="ml-0.5 text-[#a6292f]">*</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {chosen.map((label) => {
          const option = options.find((item) => item.value === label);
          const code = competencyCode(label, option);
          return (
            <span key={label} title={option?.label ?? label} className="inline-flex items-center gap-1 rounded-full bg-[#e8edf3] py-0.5 pl-2 pr-1 text-xs font-semibold text-[#1f4e79]">
              {code}
              {onChange ? (
                <button type="button" onClick={() => onChange(chosen.filter((item) => item !== label).join("\n"))} aria-label={`Remove ${code} from CLO ${number}`} className="rounded-full p-0.5 text-[#667085] hover:bg-white hover:text-[#a6292f]">
                  <X size={11} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          );
        })}
        {!chosen.length ? <span className="text-xs text-[#98a2b3]">{onChange ? "None yet" : "—"}</span> : null}
        {onChange && remaining.length ? (
          <div className="w-28">
            <SelectMenu label={`Add a SCEN competency to CLO ${number}`} size="small" value="" onChange={(next) => { if (next) onChange([...chosen, next].join("\n")); }} placeholder="Add…" options={remaining} />
          </div>
        ) : null}
      </div>
      {suad.length ? (
        <p className="text-[11px] leading-4 text-[#667085]">
          SUAD: {suad.map((line, index) => <span key={line} title={line}>{index ? ", " : ""}{line.split(" — ")[0]}</span>)}
        </p>
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

function Legend({ title, note = "", items }: { title: string; note?: string; items: Array<{ code: string; text: string; warn?: boolean }> }) {
  return (
    <section className="min-w-0">
      <h4 className="text-sm font-semibold text-[#344054]">
        {title}
        {note ? <span className="ml-2 font-normal text-[#8a4b00]">{note}</span> : null}
      </h4>
      <dl className="mt-2 grid grid-cols-[minmax(0,1fr)] gap-2 @3xl:grid-cols-2">
        {items.map((item) => (
          <div key={item.code} className={`flex gap-3 rounded-md border px-3 py-2 ${item.warn ? "border-[#f0d8a8] bg-[#fdf8ee]" : "border-[#e5e7eb] bg-white"}`}>
            <dt className="h-fit shrink-0 rounded-full bg-[#e8edf3] px-2 py-0.5 text-xs font-semibold text-[#1f4e79]">{item.code}</dt>
            <dd className="text-sm leading-5 text-[#475467]">{item.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function lines(value: string | undefined): string[] {
  return (value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function competencyCode(label: string, option?: CompetencyOption): string {
  if (option?.badge) return String(option.badge);
  return label.split(":")[0].trim();
}

/** The competencies the matrix uses, once each, in the catalogue's order, for the list under it. */
function uniqueCompetencies(rows: CloRow[], options: CompetencyOption[]) {
  const used = new Set(rows.flatMap((row) => lines(row.skills)));
  const known = options.filter((option) => used.has(option.value)).map((option) => ({ code: competencyCode(option.value, option), text: String(option.label) }));
  const unknown = [...used].filter((label) => !options.some((option) => option.value === label)).map((label) => ({ code: competencyCode(label), text: label.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : label }));
  return [...known, ...unknown];
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
