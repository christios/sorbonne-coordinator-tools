import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import {
  type Operation,
  type PlacementRow,
  type ReferenceBlock,
  type ReferenceRow,
  type WorkbookPreview,
  allKeys,
  blocksWithDecisions,
  countDecisions,
  operationsFrom,
  placementsByBlock,
  studentsMoved,
} from "@/services/workbookReview";

const BADGES: Record<string, string> = {
  changed: "bg-[#fdf6e6] text-[#8a6116]",
  added: "bg-[#eef7f0] text-[#2f6b3d]",
  moved: "bg-[#fdf6e6] text-[#8a6116]",
  placed: "bg-[#eef7f0] text-[#2f6b3d]",
};

const LABELS: Record<string, string> = {
  changed: "Changed",
  added: "New",
  moved: "Moved",
  placed: "Placed",
};

/**
 * Reviewing a group workbook against the semester it would change.
 *
 * Both halves of the file used to land on drop. That is right once and wrong every time
 * after: a re-upload rewrote CRNs somebody had corrected by hand, and moved students
 * between groups without saying whose. Neither failure announces itself.
 *
 * So the file is read, nothing is written, and every difference is a box that starts
 * unticked. What is left unticked keeps the value it has — which is what makes the result
 * "the semester plus what was approved" rather than "whatever the spreadsheet said".
 */
export function WorkbookReview({
  preview,
  busy,
  error,
  onApply,
  onCancel,
}: {
  preview: WorkbookPreview;
  busy: boolean;
  error: string | null;
  onApply: (operations: Operation[], approved: number) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const decisions = useMemo(() => allKeys(preview), [preview]);
  const blocks = useMemo(() => blocksWithDecisions(preview.reference.blocks), [preview]);
  const placements = useMemo(() => placementsByBlock(preview.placements.rows), [preview]);
  const moving = studentsMoved(preview.placements.rows, selected);

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const setMany = (keys: string[], on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      keys.forEach((key) => (on ? next.add(key) : next.delete(key)));
      return next;
    });

  return (
    <section className="pb-28">
      <button
        type="button"
        onClick={onCancel}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-[#1f4e79] hover:underline"
      >
        <ArrowLeft size={16} aria-hidden="true" /> Back to the groups
      </button>

      <div className="rounded-lg border border-[#d9dee7] bg-white p-5">
        <h3 className="text-base font-semibold text-[#171717]">
          {preview.filename} against this semester
        </h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[#667085]">
          Nothing has been written yet. Tick what should be applied — anything left unticked keeps
          the value it has now, so a correction made here survives a workbook that has not caught up.
        </p>

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Count label="New blocks" value={preview.reference.summary.blocksNew} />
          <Count label="New groups" value={preview.reference.summary.groupsAdded} />
          <Count label="CRNs changed" value={preview.reference.summary.crnsChanged} />
          <Count label="CRNs filled in" value={preview.reference.summary.crnsAdded} />
          <Count label="Students placed" value={preview.placements.summary.placed} />
          <Count label="Students moved" value={preview.placements.summary.moved} />
          <Count
            label="Already agreed"
            value={preview.reference.summary.unchanged + preview.placements.summary.unchanged}
            muted
          />
        </dl>

        {preview.reference.summary.crnsChanged > 0 ? (
          <Note>
            {preview.reference.summary.crnsChanged} CRN(s) in this workbook disagree with what the
            semester holds. If one of them was corrected here, leave that row unticked and the
            correction stands.
          </Note>
        ) : null}
        {preview.placements.summary.moved > 0 ? (
          <Note>
            {preview.placements.summary.moved} student(s) are already in a group and this workbook
            would move them. Each says which group they are in now.
          </Note>
        ) : null}
        {preview.placements.unknownStudents.length > 0 ? (
          <Note>
            {preview.placements.unknownStudents.length} id(s) in this workbook are not students in
            this cohort, so they are not offered here. The roster comes from the registrar — sync it
            and move them into the cohort first if they belong to it.
          </Note>
        ) : null}
        {preview.placements.unknownGroups.length > 0 ? (
          <Note>
            No such group in this semester: {preview.placements.unknownGroups.slice(0, 8).join(", ")}
            {preview.placements.unknownGroups.length > 8
              ? ` and ${preview.placements.unknownGroups.length - 8} more`
              : ""}
            . Approve the blocks above first, or the Reference sheet and the student tabs have
            drifted apart.
          </Note>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-md border border-[#e5b7b9] bg-[#fdf3f3] px-4 py-3 text-sm text-[#a6292f]"
          >
            {error}
          </p>
        ) : null}
      </div>

      {decisions.length === 0 ? (
        <p className="mt-5 rounded-lg border border-[#d9dee7] bg-white px-6 py-8 text-sm text-[#667085]">
          This workbook matches the semester exactly. There is nothing to apply.
        </p>
      ) : (
        <>
          {blocks.length > 0 ? (
            <div className="mt-5 space-y-4">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-[#667085]">
                Blocks, groups and CRNs
              </h4>
              {blocks.map((block) => (
                <BlockCard
                  key={block.scopeCode}
                  block={block}
                  selected={selected}
                  onToggle={toggle}
                  onToggleMany={setMany}
                />
              ))}
            </div>
          ) : null}

          {placements.length > 0 ? (
            <div className="mt-6 space-y-4">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-[#667085]">
                Who is in which group
              </h4>
              {placements.map(({ scopeCode, rows }) => (
                <PlacementCard
                  key={scopeCode}
                  scopeCode={scopeCode}
                  rows={rows}
                  selected={selected}
                  onToggle={toggle}
                  onToggleMany={setMany}
                />
              ))}
            </div>
          ) : null}
        </>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#d9dee7] bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[86rem] flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-[#344054]">
            <b className="tabular-nums">{selected.size}</b> of {countDecisions(preview)} change(s)
            approved
            {moving > 0 ? (
              <span className="ml-2 font-semibold text-[#8a6116]">
                · {moving} student(s) would change group
              </span>
            ) : null}
            {decisions.length > 0 ? (
              <span className="ml-3">
                <button
                  type="button"
                  onClick={() => setMany(decisions, true)}
                  className="font-semibold text-[#1f4e79] hover:underline"
                >
                  Tick everything
                </button>
                {selected.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="ml-3 font-semibold text-[#1f4e79] hover:underline"
                  >
                    Clear
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => onApply(operationsFrom(preview, selected), selected.size)}
            disabled={selected.size === 0 || busy}
            className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
          >
            {busy ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : null}
            Apply {selected.size} change(s)
          </button>
        </div>
      </div>
    </section>
  );
}

function Count({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[#667085]">{label}</dt>
      <dd className={muted ? "text-lg font-semibold text-[#98a2b3]" : "text-lg font-semibold text-[#171717]"}>
        {value}
      </dd>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-md border border-[#e8d9ac] bg-[#fdf9ee] px-4 py-3 text-sm leading-6 text-[#8a6116]">
      <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function TickAll({
  keys,
  selected,
  onToggleMany,
}: {
  keys: string[];
  selected: Set<string>;
  onToggleMany: (keys: string[], on: boolean) => void;
}) {
  const allOn = keys.length > 0 && keys.every((key) => selected.has(key));
  return (
    <button
      type="button"
      onClick={() => onToggleMany(keys, !allOn)}
      className="rounded-md border border-[#b7bec8] bg-white px-3 py-1.5 text-xs font-semibold text-[#344054] hover:bg-[#f8fafc]"
    >
      {allOn ? "Untick these" : `Tick all ${keys.length}`}
    </button>
  );
}

function BlockCard({
  block,
  selected,
  onToggle,
  onToggleMany,
}: {
  block: ReferenceBlock;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], on: boolean) => void;
}) {
  const keys = block.rows.map((row) => row.key);

  return (
    <article className="rounded-lg border border-[#d9dee7] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] px-5 py-3.5">
        <div className="min-w-0">
          <h5 className="text-sm font-semibold text-[#171717]">
            {block.scopeCode}
            {block.scopeName ? <span className="text-[#667085]"> · {block.scopeName}</span> : null}
          </h5>
          <p className="mt-0.5 text-xs text-[#667085]">
            {block.isNew ? "This semester has no such block yet" : "Already in this semester"}
            {block.unchanged > 0 ? ` · ${block.unchanged} CRN(s) already agree` : ""}
          </p>
        </div>
        <TickAll keys={keys} selected={selected} onToggleMany={onToggleMany} />
      </header>

      <ul className="divide-y divide-[#eef1f5]">
        {block.rows.map((row) => (
          <ReferenceRowItem
            key={row.key}
            row={row}
            checked={selected.has(row.key)}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </article>
  );
}

function ReferenceRowItem({
  row,
  checked,
  onToggle,
}: {
  row: ReferenceRow;
  checked: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(row.key)}
        aria-label={`Approve ${row.label}: ${row.detail}`}
        className="mt-1 size-4 shrink-0 accent-[#1f4e79]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGES[row.status]}`}>
            {LABELS[row.status]}
          </span>
          <span className="text-sm font-semibold text-[#344054]">{row.label}</span>
        </div>
        <p className="mt-0.5 text-sm tabular-nums text-[#667085]">{row.detail}</p>
      </div>
    </li>
  );
}

function PlacementCard({
  scopeCode,
  rows,
  selected,
  onToggle,
  onToggleMany,
}: {
  scopeCode: string;
  rows: PlacementRow[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], on: boolean) => void;
}) {
  const keys = rows.map((row) => row.key);
  const moved = rows.filter((row) => row.status === "moved").length;

  return (
    <article className="rounded-lg border border-[#d9dee7] bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e8ef] px-5 py-3.5">
        <div className="min-w-0">
          <h5 className="text-sm font-semibold text-[#171717]">{scopeCode}</h5>
          <p className="mt-0.5 text-xs text-[#667085]">
            {rows.length} student(s){moved > 0 ? ` · ${moved} already in another group` : ""}
          </p>
        </div>
        <TickAll keys={keys} selected={selected} onToggleMany={onToggleMany} />
      </header>

      <ul className="divide-y divide-[#eef1f5]">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-5 py-2.5">
            <input
              type="checkbox"
              checked={selected.has(row.key)}
              onChange={() => onToggle(row.key)}
              aria-label={`Approve ${row.studentId} in ${row.detail}`}
              className="size-4 shrink-0 accent-[#1f4e79]"
            />
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGES[row.status]}`}>
              {LABELS[row.status]}
            </span>
            <span className="text-sm font-semibold tabular-nums text-[#344054]">{row.studentId}</span>
            <span className="text-sm tabular-nums text-[#667085]">
              {row.before ? `group ${row.before} → ${row.after}` : `group ${row.after}`}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
