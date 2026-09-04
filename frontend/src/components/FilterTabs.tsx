import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { fitTab, loadTabs, matchesTab, newTabId, saveTabs, type FilterTab, type TabSort } from "@/services/filterTabs";
import type { FilterModel } from "@/services/tableFilter";

/**
 * A strip of named ways of looking at the Students table.
 *
 * "All students" is the table with nothing narrowed. Each tab after it is a set of
 * filters and a sort a coordinator saved; opening one puts them back, and the strip
 * shows which tab the table currently matches. Narrow the table further and the tab
 * stays lit but marked, with the choice of updating it to what is on screen.
 */
export function FilterTabs({
  filters,
  sort,
  columnIds,
  onApply,
}: {
  filters: FilterModel[];
  sort: TabSort;
  /** The columns this table actually has, so a tab from another day cannot name a ghost. */
  columnIds: Set<string>;
  onApply: (filters: FilterModel[], sort: TabSort) => void;
}) {
  const [tabs, setTabs] = useState<FilterTab[]>([]);
  const [openId, setOpenId] = useState("");
  const [naming, setNaming] = useState<null | { id: string; name: string }>(null);
  const [deleting, setDeleting] = useState<FilterTab | null>(null);

  useEffect(() => setTabs(loadTabs()), []);

  const keep = (next: FilterTab[]) => {
    setTabs(next);
    saveTabs(next);
  };

  const open = tabs.find((tab) => tab.id === openId) ?? null;
  const onAll = filters.length === 0;
  // Changed since it was opened: the table no longer matches what the tab holds.
  const drifted = open ? !matchesTab(fitTab(open, columnIds), filters, sort) : false;

  const apply = (tab: FilterTab | null) => {
    setOpenId(tab?.id ?? "");
    if (!tab) return onApply([], { key: "studentId", ascending: true });
    const fitted = fitTab(tab, columnIds);
    onApply(fitted.filters, fitted.sort);
  };

  const save = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (naming?.id) {
      keep(tabs.map((tab) => (tab.id === naming.id ? { ...tab, name: trimmed } : tab)));
    } else {
      const made: FilterTab = { id: newTabId(tabs), name: trimmed, filters, sort };
      keep([...tabs, made]);
      setOpenId(made.id);
    }
    setNaming(null);
  };

  const updateOpen = () => {
    if (!open) return;
    keep(tabs.map((tab) => (tab.id === open.id ? { ...tab, filters, sort } : tab)));
  };

  const tabClass = (active: boolean) =>
    `inline-flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
      active
        ? "border-[#d9dee7] bg-white font-semibold text-[#1f4e79]"
        : "border-transparent font-medium text-[#667085] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
    }`;

  return (
    <>
      <div
        role="tablist"
        aria-label="Ways of looking at the students"
        className="flex items-end gap-1 overflow-x-auto border-b border-[#d9dee7]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={onAll && !open}
          onClick={() => apply(null)}
          className={tabClass(onAll && !open)}
        >
          All students
        </button>

        {tabs.map((tab) => {
          const active = tab.id === openId;
          return (
            <span key={tab.id} className="flex shrink-0 items-end">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => apply(tab)}
                className={tabClass(active)}
              >
                {tab.name}
                {active && drifted ? (
                  <span className="text-[#8a6d00]" title="Changed since this tab was opened">
                    •
                  </span>
                ) : null}
                <span className="text-xs font-normal text-[#98a2b3]">{tab.filters.length}</span>
              </button>
              {active ? (
                <span className="mb-1 flex items-center gap-0.5 pl-0.5">
                  {drifted ? (
                    <button
                      type="button"
                      aria-label={`Update ${tab.name} to the current filters`}
                      title="Save what is on screen into this tab"
                      onClick={updateOpen}
                      className="rounded p-1 text-[#8a6d00] hover:bg-[#fff6e5]"
                    >
                      <Check size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Rename ${tab.name}`}
                    onClick={() => setNaming({ id: tab.id, name: tab.name })}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
                  >
                    <Pencil size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${tab.name}`}
                    onClick={() => setDeleting(tab)}
                    className="rounded p-1 text-[#98a2b3] hover:bg-[#fdf3f3] hover:text-[#a6292f]"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </span>
          );
        })}

        <button
          type="button"
          onClick={() => setNaming({ id: "", name: "" })}
          disabled={onAll}
          title={onAll ? "Narrow the table first, then save that as a tab" : "Save the current filters as a tab"}
          className="mb-1 ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:text-[#98a2b3] disabled:hover:bg-transparent"
        >
          <Plus size={13} aria-hidden="true" /> Save as tab
        </button>
      </div>

      <Modal
        open={naming !== null}
        title={naming?.id ? "Rename this tab" : "Save these filters as a tab"}
        description={
          naming?.id
            ? undefined
            : `${filters.length} filter${filters.length === 1 ? "" : "s"} and the current sort. Tabs are kept in this browser.`
        }
        onClose={() => setNaming(null)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setNaming(null)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              disabled={!naming?.name.trim()}
              onClick={() => naming && save(naming.name)}
              className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
            >
              {naming?.id ? "Rename" : "Save tab"}
            </button>
          </div>
        }
      >
        <label className="block text-sm font-semibold text-[#344054]">
          Name
          <input
            aria-label="Tab name"
            autoFocus
            value={naming?.name ?? ""}
            onChange={(event) => setNaming((current) => (current ? { ...current, name: event.target.value } : current))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && naming?.name.trim()) save(naming.name);
            }}
            placeholder="First years with no group"
            className="mt-1.5 block w-full rounded-md border border-[#cbd5e1] px-3 py-2 text-sm font-normal"
          />
        </label>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Delete this tab?"
        description={deleting ? `“${deleting.name}” will be removed from this browser. The students are not affected.` : undefined}
        onClose={() => setDeleting(null)}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setDeleting(null)} className="text-sm font-semibold text-[#667085]">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!deleting) return;
                keep(tabs.filter((tab) => tab.id !== deleting.id));
                if (openId === deleting.id) apply(null);
                setDeleting(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#a6292f] px-4 py-2 text-sm font-semibold text-white"
            >
              <X size={14} aria-hidden="true" /> Delete tab
            </button>
          </div>
        }
      >
        <p className="text-sm text-[#667085]">Filters and sort only — nothing about any student is stored in a tab.</p>
      </Modal>
    </>
  );
}
