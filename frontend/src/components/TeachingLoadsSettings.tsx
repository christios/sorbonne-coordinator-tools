import { Modal } from "@/components/Modal";

export type TabChoice = { value: string; label: string };

/**
 * Teaching loads' own settings: which tabs the page shows, this browser's own.
 *
 * Which courses count as which programme is not here: it is the whole application's, in
 * Settings → Programmes, so every page that narrows its courses to a programme agrees.
 */
export function TeachingLoadsSettings({
  open,
  onClose,
  tabChoices,
  hidden,
  onHide,
}: {
  open: boolean;
  onClose: () => void;
  tabChoices: TabChoice[];
  hidden: Set<string>;
  /** The tabs to put away, all of them: "department", or a cohort's id. */
  onHide: (hidden: string[]) => void;
}) {
  const shown = tabChoices.filter((choice) => !hidden.has(choice.value));
  const toggle = (value: string) => {
    const next = new Set(hidden);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onHide(tabChoices.filter((choice) => next.has(choice.value)).map((choice) => choice.value));
  };

  return (
    <Modal open={open} onClose={onClose} title="Teaching loads settings" description="The tabs this page shows.">
      <div className="space-y-5">
        <section>
          <h3 className="text-sm font-semibold text-[#171717]">Tabs shown</h3>
          <p className="mt-1 text-sm text-[#475467]">
            A tab put away is still counted in the department. This browser remembers it; nobody else&apos;s page changes.
          </p>
          <div role="group" aria-label="Tabs shown" className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {tabChoices.map((choice) => {
              const ticked = !hidden.has(choice.value);
              // The last tab shown stays: a page with no tab would show nothing.
              const last = ticked && shown.length === 1;
              return (
                <label key={choice.value} className={`flex items-center gap-2 text-sm ${last ? "text-[#667085]" : "text-[#171717]"}`}>
                  <input
                    type="checkbox"
                    checked={ticked}
                    disabled={last}
                    title={last ? "One tab at least is shown" : undefined}
                    onChange={() => toggle(choice.value)}
                    className="h-4 w-4 accent-[#1f4e79]"
                  />
                  {choice.label}
                </label>
              );
            })}
          </div>
        </section>
        <section className="rounded-lg border border-[#c9d2de] bg-[#f8fafc] p-3 text-sm text-[#344054]">
          Which courses count as which programme is set once for the whole application, in{" "}
          <a href="#/settings/programmes" className="font-semibold text-[#1f4e79] underline">
            Settings → Programmes
          </a>
          .
        </section>
      </div>
    </Modal>
  );
}
