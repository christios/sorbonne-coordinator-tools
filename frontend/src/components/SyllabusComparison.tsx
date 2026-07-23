import { ArrowLeft, GitCompareArrows, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { Syllabus, SyllabusChange, SyllabusSummary, WordDiffOperation, compareSyllabi } from "@/services/syllabi";
import { SelectMenu } from "@/components/SelectMenu";

type Field = { path: string; value: unknown };

export function SyllabusComparison({ syllabus, candidates, onBack }: { syllabus: Syllabus; candidates: SyllabusSummary[]; onBack: () => void }) {
  const options = candidates.filter((candidate) => candidate.id !== syllabus.id && candidate.seriesId === syllabus.seriesId && candidate.templateId === syllabus.templateId);
  const [otherId, setOtherId] = useState(options[0]?.id ?? "");
  const [changesOnly, setChangesOnly] = useState(true);
  const comparison = useQuery({
    queryKey: ["syllabus-comparison", syllabus.id, otherId],
    queryFn: () => compareSyllabi(syllabus.id, otherId),
    enabled: Boolean(otherId),
  });
  const fields = useMemo(() => {
    if (!comparison.data) return [];
    return mergeFields(
      flatten(comparison.data.left.content),
      flatten(comparison.data.right.content),
      comparison.data.changes,
    );
  }, [comparison.data]);
  const changed = new Map(comparison.data?.changes.map((change) => [change.path, change]) ?? []);
  const visible = changesOnly ? fields.filter((field) => changed.has(field.path)) : fields;

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
              <div className="flex items-center gap-2 font-semibold text-[#171717]"><GitCompareArrows size={18} className="text-[#1f4e79]" /> {comparison.data.changes.length} changed field{comparison.data.changes.length === 1 ? "" : "s"}</div>
              <DiffLegend />
            </div>
            <label className="flex items-center gap-2 text-sm text-[#475467]"><input type="checkbox" checked={changesOnly} onChange={(event) => setChangesOnly(event.target.checked)} /> Changes only</label>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#f7f8fa]">
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">Field</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">{comparison.data.left.academicYear}</th>
                  <th className="px-4 py-3 text-left font-semibold text-[#344054]">{comparison.data.right.academicYear}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((field) => {
                  const change = changed.get(field.path);
                  return (
                    <tr key={field.path} className={change ? "bg-[#fff8eb]" : ""}>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 font-medium text-[#344054]">{change?.label ?? humanizePath(field.path)}</td>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 whitespace-pre-wrap text-[#475467]"><DiffValue change={change} value={change?.left ?? field.value} side="left" /></td>
                      <td className="border-t border-[#e5e7eb] px-4 py-3 whitespace-pre-wrap text-[#475467]"><DiffValue change={change} value={change?.right ?? field.value} side="right" /></td>
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

function DiffLegend() {
  return (
    <p className="mt-1 text-xs text-[#667085]">
      <span className="mr-2 rounded bg-[#fee4e2] px-1 text-[#b42318] line-through">Deleted</span>
      <span className="mr-2 rounded bg-[#dcfae6] px-1 text-[#067647]">Inserted</span>
      <span className="rounded bg-[#fef0c7] px-1 text-[#92400e]">Substitution: old → new</span>
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

function flatten(value: unknown, path = ""): Field[] {
  if (Array.isArray(value) && rowsHaveIds(value)) return value.flatMap((row) => flatten(row, `${path}[${row.id}]`));
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, path ? `${path}.${key}` : key));
  return [{ path, value }];
}

function rowsHaveIds(value: unknown[]): value is Array<Record<string, unknown> & { id: string }> {
  return value.every((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string");
}

function mergeFields(left: Field[], right: Field[], changes: SyllabusChange[]) {
  const fields = new Map(left.map((field) => [field.path, field]));
  for (const field of right) if (!fields.has(field.path)) fields.set(field.path, field);
  for (const change of changes) if (!fields.has(change.path)) fields.set(change.path, { path: change.path, value: change.left ?? change.right });
  return [...fields.values()].sort((first, second) => first.path.localeCompare(second.path));
}

function humanizePath(path: string) {
  return path
    .split(".")
    .map((segment) => segment.replace(/\[[^\]]+\]/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" · ");
}

function renderValue(value: unknown) {
  return value === undefined || value === null || value === "" ? "—" : typeof value === "string" ? value : JSON.stringify(value);
}
