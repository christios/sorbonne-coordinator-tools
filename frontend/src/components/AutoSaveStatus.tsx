import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

export type AutoSaveState = "saved" | "saving" | "error" | "conflict";

/** Shared visual language for editor autosave feedback. */
export function AutoSaveStatus({ state, error, onReload, resourceName = "This record" }: { state: AutoSaveState; error?: string | null; onReload?: () => void; resourceName?: string }) {
  if (state === "saving") return <span className="inline-flex items-center gap-2 text-sm text-[#667085]"><Loader2 className="animate-spin" size={16} /> Saving</span>;
  if (state === "conflict") return <span role="alert" className="inline-flex items-center gap-2 text-sm text-[#a6292f]"><TriangleAlert size={16} /> {resourceName} was updated in another tab.{onReload ? <button type="button" onClick={onReload} className="font-semibold underline underline-offset-2">Reload latest version</button> : null}</span>;
  if (state === "error") return <span role="alert" className="inline-flex items-center gap-2 text-sm text-[#a6292f]" title={error ?? undefined}><TriangleAlert size={16} /> {error || "Save failed. Your changes are still on this page."}</span>;
  return <span className="inline-flex items-center gap-2 text-sm text-[#24805a]"><CheckCircle2 size={16} /> Saved</span>;
}
