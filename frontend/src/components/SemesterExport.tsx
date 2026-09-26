import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { useMemo, useState } from "react";

import { Modal } from "@/components/Modal";
import { usePageState } from "@/components/usePageState";
import {
  MAX_PAGES,
  downloadSemesterPdf,
  frameOf,
  semesterPages,
  semesterUnits,
  type ExportZoom,
  type SemesterExportInput,
  type SemesterPage,
} from "@/services/semesterPdf";

const START: ExportZoom = { maxPages: 1 };

/**
 * The whole semester as a PDF, with its size chosen first and the pages it will take shown.
 *
 * A week drawn large enough to read every box is more than one sheet of paper, and a
 * semester is sixteen weeks of them. Nobody should find that out from the printer. The
 * week always spans the page's width; what is chosen is at most how many pages a week may
 * take — and the preview draws a week's pages exactly as the file will.
 */
export function SemesterExport({
  open,
  onClose,
  input,
  shown,
}: {
  open: boolean;
  onClose: () => void;
  input: SemesterExportInput;
  /** "20 of 162 sections", so the filters on the page are not a surprise in the file. */
  shown: string;
}) {
  const [kept, setZoom] = usePageState<ExportZoom>("semester-export:zoom:v3", START);
  const zoom = { ...START, ...kept };
  const units = useMemo(() => (open ? semesterUnits(input) : []), [open, input]);
  const pages = useMemo(() => (open ? semesterPages(input, zoom, units) : []), [open, input, zoom, units]);
  // The unit to preview: the one that takes the most pages, unless one has been chosen.
  const fullest = useMemo(() => {
    const counts = new Map<number, number>();
    for (const page of pages) counts.set(page.unit, (counts.get(page.unit) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  }, [pages]);
  const [chosen, setChosen] = useState<number | null>(null);
  const unit = Math.min(units.length - 1, chosen ?? fullest);
  const ofUnit = pages.filter((page) => page.unit === unit);
  // Weeks the ceiling made smaller than asked: said, so a small class is not a surprise.
  const squeezed = useMemo(() => {
    if (!zoom.maxPages) return 0;
    const free = open ? semesterPages(input, { ...zoom, maxPages: null }, units) : [];
    const perUnit = new Map<number, number>();
    for (const page of free) perUnit.set(page.unit, (perUnit.get(page.unit) ?? 0) + 1);
    return [...perUnit.values()].filter((pages) => pages > (zoom.maxPages ?? Infinity)).length;
  }, [open, input, units, zoom.maxPages]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");
  const noun = input.layout === "rooms-day" ? "day" : "week";

  const exportIt = async () => {
    setBusy(true);
    setFailed("");
    try {
      await downloadSemesterPdf(input, zoom);
      onClose();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : "The PDF could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      size="wide"
      title={`Export ${input.semester}`}
      description={`Every ${noun} of the semester, drawn as the page draws it: ${shown}, with the page's filters.`}
      onClose={onClose}
      footer={
        <>
          {failed ? <span className="mr-auto text-sm text-[#a6292f]">{failed}</span> : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[#b7bec8] bg-white px-3 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || pages.length === 0}
            onClick={() => void exportIt()}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1a4368] disabled:opacity-50"
          >
            <Download size={15} aria-hidden="true" />
            {busy ? "Making the PDF…" : `Export ${pages.length} page${pages.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <Choice
          label={`Pages per ${noun}, at most`}
          value={zoom.maxPages ? String(zoom.maxPages) : ""}
          options={[
            ...MAX_PAGES.map((pages) => ({ value: String(pages), label: String(pages) })),
            { value: "", label: "No limit" },
          ]}
          onChange={(pages) => setZoom({ ...zoom, maxPages: pages ? Number(pages) : null })}
        />
      </div>

      <p className="mt-4 text-sm text-[#344054]" aria-live="polite">
        {pages.length === 0 ? (
          "The portal has booked no classes for these sections, so there is nothing to export."
        ) : (
          <>
            <strong className="font-semibold">{pages.length} pages</strong> for the whole semester, over{" "}
            {units.length} {noun}s; the {noun} below takes {ofUnit.length}. Every page is A4 landscape, filled to its
            edges.
            {squeezed
              ? ` ${squeezed} ${noun}${squeezed === 1 ? " is" : "s are"} drawn smaller to stay within ${zoom.maxPages} page${zoom.maxPages === 1 ? "" : "s"}.`
              : ""}
          </>
        )}
      </p>

      {ofUnit.length ? (
        <div className="mt-3 rounded-lg border border-[#e4e8ef] bg-[#f8fafc] p-3">
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              aria-label={`Previous ${noun}`}
              disabled={unit <= 0}
              onClick={() => setChosen(unit - 1)}
              className="inline-flex h-7 items-center rounded-md border border-[#d9dee7] bg-white px-1.5 text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={`Next ${noun}`}
              disabled={unit >= units.length - 1}
              onClick={() => setChosen(unit + 1)}
              className="inline-flex h-7 items-center rounded-md border border-[#d9dee7] bg-white px-1.5 text-[#344054] hover:bg-[#f8fafc] disabled:opacity-40"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
            <span className="text-sm font-semibold text-[#344054]">{ofUnit[0].title}</span>
            <span className="text-xs text-[#98a2b3]">
              {chosen === null ? `the ${noun} that takes the most pages · ` : ""}
              {ofUnit.length} page{ofUnit.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className={`grid gap-3 ${ofUnit.length > 1 ? "sm:grid-cols-2" : ""}`} aria-label="Pages of this week">
            {ofUnit.map((page) => (
              <figure key={page.line} className="m-0">
                <PagePreview page={page} layout={input.layout} />
                <figcaption className="mt-0.5 text-center text-[11px] text-[#667085]">
                  Page {pages.indexOf(page) + 1}
                  {page.part ? ` · ${page.part}` : ""}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

/** A row of buttons standing for one choice. */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-[#667085]">{label}</span>
      <span role="group" aria-label={label} className="inline-flex overflow-hidden rounded-md border border-[#d3d9e2]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={`border-l border-[#d3d9e2] px-2.5 py-1.5 text-xs font-semibold first:border-l-0 ${
              option.value === value ? "bg-[#1f4e79] text-white" : "bg-white text-[#344054] hover:bg-[#f8fafc]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * One page, small: the same layout the PDF is drawn from, in outline. Too small to read a
 * box, and not meant to be — it shows where the page cuts the week and how full it is.
 */
function PagePreview({ page, layout }: { page: SemesterPage; layout: SemesterExportInput["layout"] }) {
  const frame = frameOf(layout);
  const gridLeft = frame.left + frame.labelWidth;
  return (
    <svg
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      role="img"
      aria-label={`${page.title}${page.part ? `, ${page.part}` : ""}`}
      className="block w-full rounded border border-[#d9dee7] bg-white shadow-sm"
    >
      <text x={frame.left} y={frame.titleY} fontSize={11} fontWeight={700} fill="#1f4e79">
        {page.title}
      </text>
      <rect x={frame.left} y={page.gridTop} width={frame.right - frame.left} height={frame.contentTop - page.gridTop} fill="#f8fafc" />
      {page.ticks
        .filter((tick) => tick.weight === "hour")
        .map((tick) => (
          <line key={tick.x} x1={tick.x} x2={tick.x} y1={frame.contentTop} y2={page.gridBottom} stroke="#dfe4eb" strokeWidth={0.8} />
        ))}
      {page.seams.map((seam) => (
        <line key={`s${seam}`} x1={seam} x2={seam} y1={page.gridTop} y2={page.gridBottom} stroke="#8a96a8" strokeWidth={1.5} />
      ))}
      {page.days.map((day) => (
        <text key={`d${day.x}`} x={day.x + 4} y={page.gridTop + 10} fontSize={8} fontWeight={700} fill="#344054">
          {day.label}
        </text>
      ))}
      {page.hours.map((hour) => (
        <text key={`h${hour.x}`} x={hour.x} y={frame.contentTop - 4.5} fontSize={7} textAnchor="middle" fill="#667085">
          {hour.label}
        </text>
      ))}
      {page.rows.map((row) => (
        <g key={`${row.y}-${row.label}`}>
          <line x1={frame.left} x2={frame.right} y1={row.y} y2={row.y} stroke="#e4e8ef" strokeWidth={0.8} />
          <text x={frame.left + 4} y={row.y + 10} fontSize={8} fontWeight={700} fill="#344054">
            {row.label}
          </text>
        </g>
      ))}
      <line x1={gridLeft} x2={gridLeft} y1={page.gridTop} y2={page.gridBottom} stroke="#e4e8ef" strokeWidth={0.8} />
      {page.boxes.map((box, index) => (
        <rect
          key={index}
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={1.5}
          fill={box.color}
          opacity={box.klass.state === "cancelled" ? 0.5 : 1}
        />
      ))}
      <rect
        x={frame.left}
        y={page.gridTop}
        width={frame.right - frame.left}
        height={page.gridBottom - page.gridTop}
        rx={3}
        fill="none"
        stroke="#e4e8ef"
      />
    </svg>
  );
}
