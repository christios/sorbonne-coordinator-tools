import { AlertTriangle, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

/**
 * What needs attention, as one band across the page.
 *
 * A warning that recites itself is not a warning: twenty-six clashes written out in full
 * is a paragraph nobody finishes, and the page under it is lost behind them. So the band
 * says how many there are of each kind — which is what a coordinator decides on — and
 * opens the one kind being dealt with, inside itself, a few lines at a time.
 *
 * It still has to look like a warning, though, or it reads as a filter bar: the whole
 * band is coloured, and its colour is the worst thing in it. Serious is the red the rest
 * of the application uses for a section with no CRN or a group over its seats; caution is
 * the amber it uses for something that can wait until Tuesday.
 */
export type WarningKind = {
  id: string;
  /** "22 timetable clashes" — the count first, because the count is the decision. */
  label: string;
  severity: "serious" | "caution";
  /** What opens when this kind is chosen. Rendered inside the band. */
  detail: ReactNode;
  /**
   * A qualification on the count, shown whenever this kind is open — the error bar on the
   * number in the pill, not another thing that has gone wrong.
   *
   * A clash count is the clearest case: it counts overlaps among the sections somebody has
   * hours for and says nothing about the rest, so a count with no note beside it reads as
   * the whole truth about the semester when it may be a tenth of it.
   */
  note?: string;
};

const SKIN = {
  serious: {
    band: "border-[#e5b7b9] bg-[#fdf3f3]",
    ink: "text-[#a6292f]",
    pill: "border-[#efc9cb] bg-white/70 text-[#a6292f] hover:bg-white",
    chosen: "border-[#a6292f] bg-[#a6292f] text-white hover:bg-[#8f2429]",
    panel: "border-[#f0d7d9]",
  },
  caution: {
    band: "border-[#e8d9ac] bg-[#fdf9ee]",
    ink: "text-[#8a6116]",
    pill: "border-[#e8d9ac] bg-white/70 text-[#8a6116] hover:bg-white",
    chosen: "border-[#8a6116] bg-[#8a6116] text-white hover:bg-[#73510f]",
    panel: "border-[#eadfc2]",
  },
} as const;

export function WarningBanner({ title, kinds }: { title: string; kinds: WarningKind[] }) {
  const [openId, setOpenId] = useState("");
  if (!kinds.length) return null;

  // The band takes the colour of the worst thing in it: one section with no CRN makes the
  // whole band serious, because that is the thing to look at.
  const skin = SKIN[kinds.some((kind) => kind.severity === "serious") ? "serious" : "caution"];
  const open = kinds.find((kind) => kind.id === openId) ?? null;

  return (
    <section role="status" className={`mb-4 rounded-lg border px-4 py-3 ${skin.band}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className={`inline-flex items-center gap-2 text-sm font-semibold ${skin.ink}`}>
          <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />
          {title}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((kind) => {
            const chosen = kind.id === openId;
            return (
              <button
                key={kind.id}
                type="button"
                aria-expanded={chosen}
                onClick={() => setOpenId(chosen ? "" : kind.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${chosen ? skin.chosen : skin.pill}`}
              >
                {kind.label}
                <ChevronRight size={12} className={chosen ? "rotate-90" : ""} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>

      {open ? (
        <div className={`mt-3 overflow-hidden rounded-md border bg-white ${skin.panel}`}>
          {open.note ? (
            <p className="border-b border-[#f2f4f7] px-4 py-2 text-xs text-[#667085]">{open.note}</p>
          ) : null}
          {open.detail}
        </div>
      ) : null}
    </section>
  );
}

/** The rows inside an opened kind: one line each, and a plain count of the rest. */
export function WarningRows({ children, more }: { children: ReactNode; more?: number }) {
  return (
    <ul className="divide-y divide-[#f2f4f7] text-sm">
      {children}
      {more ? <li className="px-4 py-2 text-xs text-[#98a2b3]">and {more} more</li> : null}
    </ul>
  );
}
