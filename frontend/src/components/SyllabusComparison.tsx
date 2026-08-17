import { ArrowLeft, GitCompareArrows, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Syllabus, SyllabusChange, SyllabusComparisonRow, SyllabusSummary, WordDiffOperation, compareSyllabi } from "@/services/syllabi";
import { SelectMenu } from "@/components/SelectMenu";

export function SyllabusComparison({ syllabus, candidates, onBack }: { syllabus: Syllabus; candidates: SyllabusSummary[]; onBack: () => void }) {
  const options = candidates.filter((candidate) => candidate.id !== syllabus.id && candidate.seriesId === syllabus.seriesId && comparable(candidate.templateId, syllabus.templateId));
  const [otherId, setOtherId] = useState(options[0]?.id ?? "");
  const [changesOnly, setChangesOnly] = useState(false);
  const comparison = useQuery({
    queryKey: ["syllabus-comparison", syllabus.id, otherId],
    queryFn: () => compareSyllabi(syllabus.id, otherId),
    enabled: Boolean(otherId),
  });
  const fields = comparison.data?.rows ?? [];
  const visible = changesOnly ? fields.filter((field) => field.status !== "mapped" || field.kind === "changed") : fields;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-[#d9dee7] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="mt-1 rounded-md p-2 hover:bg-[#e8edf3]" aria-label="Back to syllabus">
            <ArrowLeft size={19} />
          </button>
          <div>
            <p className="text-sm font-medium text-[#a6292f]">Year-over-year review</p>
            <h2 className="text-xl font-semibold text-[#171717]">Compare syllabus versions</h2>
            <p className="text-sm text-[#667085]">Text changes are highlighted word by word.</p>
          </div>
        </div>
        <label className="grid gap-1 text-sm font-medium text-[#344054]">
          Compare with
          <SelectMenu label="Compare with" value={otherId} onChange={setOtherId} placeholder="Choose a syllabus version" options={options.map((option) => ({ value: option.id, label: `${option.academicYear} — ${option.courseTitle}` }))} />
        </label>
      </div>

      {options.length === 0 ? <div className="mt-6 rounded-lg border border-[#d9dee7] bg-white p-8 text-center text-sm text-[#667085]">Duplicate this syllabus into a new academic year to compare it here.</div> : null}
      {comparison.isLoading ? <div className="mt-6 flex justify-center gap-2 text-sm text-[#667085]"><Loader2 size={18} className="animate-spin" /> Loading comparison</div> : null}
      {comparison.error instanceof Error ? <p role="alert" className="mt-6 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">{comparison.error.message}</p> : null}
      {comparison.data ? (
        <section className="mt-6 rounded-lg border border-[#d9dee7] bg-white">
          <div className="flex flex-col justify-between gap-3 border-b border-[#d9dee7] p-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 font-semibold text-[#171717]"><GitCompareArrows size={18} className="text-[#1f4e79]" /> {comparison.data.changes.length} changed mapped field{comparison.data.changes.length === 1 ? "" : "s"}</div>
              <DiffLegend />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#475467]"><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /> Changes only</label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#f7f8fa]">
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">Field</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">{versionLabel(comparison.data.left)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">{versionLabel(comparison.data.right)}</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">Result</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((field) => {
                  const change = comparisonChange(field);
                  return (
                    <tr key={field.id} className={field.kind === "changed" ? "bg-[#fff8eb]" : ""}>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 font-medium text-[#344054]">{field.label}</td>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 whitespace-pre-wrap text-[#475467]"><DiffValue change={change} value={field.left} side="left" /></td>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 whitespace-pre-wrap text-[#475467]"><DiffValue change={change} value={field.right} side="right" /></td>
                      <td className="border-t border-[#e5e7eb] px-4 py-3"><ComparisonStatus row={field} leftTemplate={templateLabel(comparison.data.left.templateId)} rightTemplate={templateLabel(comparison.data.right.templateId)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function comparable(left: string, right: string) { return left === right || (left === "scen-en-v1" && right === "fys-2025-26") || (left === "fys-2025-26" && right === "scen-en-v1"); }
function comparisonChange(row: SyllabusComparisonRow): SyllabusChange | undefined { return row.kind === "changed" ? { path: row.id, label: row.label, left: row.left, right: row.right, kind: "changed", operations: row.operations } : undefined; }
function templateLabel(templateId: string) { return templateId === "scen-en-v1" ? "SCEN" : templateId === "fys-2025-26" ? "Foundation Year" : templateId; }
function versionLabel(syllabus: Syllabus) { return `${syllabus.academicYear} · ${templateLabel(syllabus.templateId)}`; }

export function ComparisonStatus({ row, leftTemplate, rightTemplate }: { row: SyllabusComparisonRow; leftTemplate: string; rightTemplate: string }) {
  if (row.status === "mapped" && row.kind === "unchanged") return <span className="inline-flex rounded-md bg-[#e8edf3] px-2 py-1 text-xs font-semibold text-[#1f4e79]">Kept</span>;
  if (row.status === "mapped") return <span className="inline-flex rounded-md bg-[#fef0c7] px-2 py-1 text-xs font-semibold text-[#92400e]">Changed</span>;
  const template = row.status === "left-only" ? leftTemplate : rightTemplate;
  return <span className="inline-flex rounded-md bg-[#f2f4f7] px-2 py-1 text-xs font-semibold text-[#475467]">Only in {template}</span>;
}

function DiffLegend() {
  return (
    <p className="mt-1 text-xs text-[#667085]">
      <span className="mr-2 rounded bg-[#fee4e2] px-1 text-[#b42318] line-through">Deleted</span>
      <span className="mr-2 rounded bg-[#dcfae6] px-1 text-[#067647]">Inserted</span>
      <span className="rounded bg-[#fef0c7] px-1 text-[#92400e]">Substitution: old → new</span>
      <span className="mt-1 block">Kept means mapped content carried over unchanged. “Only in” identifies template-specific fields.</span>
    </p>
  );
}

export function DiffValue({ change, value, side }: { change?: SyllabusChange; value: unknown; side: "left" | "right" }) {
  if (!change?.operations || side === "left") return renderValue(value);
  return (
    <>
      {change.operations.map((operation, index) => <DiffOperation key={index} operation={operation} />)}
    </>
  );
}

function DiffOperation({ operation }: { operation: WordDiffOperation }) {
  if (operation.type === "equal") return <>{operation.text}</>;
  if (operation.type === "delete") return <mark className="rounded bg-[#fee4e2] px-0.5 text-[#b42318] line-through" aria-label="Deleted text">{operation.text}</mark>;
  if (operation.type === "insert") return <mark className="rounded bg-[#dcfae6] px-0.5 text-[#067647]" aria-label="Inserted text">{operation.text}</mark>;
  if (operation.type === "substitute") {
    return <mark className="rounded bg-[#fef0c7] px-0.5 text-[#92400e]" aria-label={`Substitution: ${operation.left} replaced with ${operation.right}`}><span className="line-through">{operation.left}</span><span aria-hidden="true"> → </span><span className="font-semibold">{operation.right}</span></mark>;
  }
  return null;
}

function renderValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return <div className="grid gap-2">{value.map((item, index) => <div key={index}>{renderStructuredValue(item)}</div>)}</div>;
  }
  return renderStructuredValue(value);
}

function renderStructuredValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length ? <div className="grid gap-1">{value.map((item, index) => <div key={index}>{renderStructuredValue(item)}</div>)}</div> : "—";
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(([key, item]) => key !== "id" && item !== undefined && item !== null && item !== "" && (!Array.isArray(item) || item.length > 0));
    if (!entries.length) return "—";
    return <dl className="grid gap-1">{entries.map(([key, item]) => <div key={key} className="grid gap-1 sm:grid-cols-[minmax(7rem,auto)_1fr]"><dt className="font-medium text-[#667085]">{fieldLabel(key)}</dt><dd>{renderStructuredValue(item)}</dd></div>)}</dl>;
  }
  return String(value);
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = { clo: "CLO", clos: "CLOs", plos: "PLOs", url: "URL", aiPolicy: "AI policy", faceToFacePercent: "Face-to-face (%)", onlinePercent: "Online (%)" };
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (character) => character.toUpperCase());
}
