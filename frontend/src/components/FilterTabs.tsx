import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Modal } from "@/components/Modal";
import { fitTab, loadTabs, matchesTab, newTabId, saveTabs, type FilterTab, type TabSort } from "@/services/filterTabs";
import type { FilterModel } from "@/services/tableFilter";

/**
 * A strip of named ways of looking at the Students table.
 *
 * "All students" is the table with nothing narrowed, and cannot be changed. Every tab
 * after it is one a coordinator made, and works the way a tab works anywhere: open it
 * and its filters and sort come back; change them while it is open and it keeps the
 * change. There is no separate "save" — the first version of this had one, greyed out
 * until a filter existed, and the one control that made a tab looked dead.
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

  // The open tab follows the table: whatever is narrowed or sorted while it is open is
  // what it holds from then on. Written only when something actually differs, so a
  // render is not a write.
  useEffect(() => {
    if (!open || matchesTab(open, filters, sort)) return;
    keep(tabs.map((tab) => (tab.id === open.id ? { ...tab, filters, sort } : tab)));
  }, [filters, sort]); // eslint-disable-line react-hooks/exhaustive-deps

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
          aria-selected={!open}
          onClick={() => apply(null)}
          className={tabClass(!open)}
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
                {tab.filters.length ? (
                  <span className="text-xs font-normal text-[#98a2b3]">{tab.filters.length}</span>
                ) : null}
              </button>
              {active ? (
                <span className="mb-1 flex items-center gap-0.5 pl-0.5">
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
          title="A new tab, starting from what the table shows now"
          className="mb-1 ml-1 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
        >
          <Plus size={13} aria-hidden="true" /> New tab
        </button>
      </div>

      <Modal
        open={naming !== null}
        title={naming?.id ? "Rename this tab" : "New tab"}
        description={
          naming?.id
            ? undefined
            : filters.length
              ? `Starts with the ${filters.length} filter${filters.length === 1 ? "" : "s"} and the sort on screen now, and keeps whatever you change while it is open. Tabs are kept in this browser.`
              : "Starts with everyone, and keeps whatever you filter or sort while it is open. Tabs are kept in this browser."
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
              {naming?.id ? "Rename" : "Create tab"}
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
