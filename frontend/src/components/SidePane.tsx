import { PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

export type SidePaneItem = {
  id: string;
  name: string;
  icon: LucideIcon;
  /** Pages that belong together. A new one starts a fresh sub-heading in the pane. */
  group?: string;
  /** A page that lives under another: shown indented beneath it, as a sub-tab. */
  parent?: string;
};

/**
 * The left pane, shared by the app picker and by any tool that has more than one page.
 * One component so the two never drift apart: the same width, the same type, the same
 * hover, and the same footer slot for whatever belongs at the bottom.
 *
 * It hides below `lg`, where the screen belongs to the content instead.
 */
export function SidePane({
  label,
  heading,
  items,
  activeId,
  onSelect,
  footer,
}: {
  label: string;
  heading: string;
  items: SidePaneItem[];
  /** Left undefined by the app picker, which has nothing open yet. */
  activeId?: string;
  onSelect: (id: string) => void;
  footer?: ReactNode;
}) {
  /*
   * Collapsed, the pane keeps its icons and gives up its words.
   *
   * Not hidden altogether: a screen with no navigation on it is a screen you cannot leave
   * without the browser's back button. Sixty-four pixels of icons is enough to move
   * around and little enough to give a wide table or a week-wide timetable the room it
   * was asking for.
   */
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside
      aria-label={label}
      className={`hidden shrink-0 flex-col border-r border-[#d9dee7] bg-white lg:flex ${collapsed ? "w-16" : "w-64"}`}
    >
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} pb-1 pt-2`}>
          {collapsed ? null : (
            <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">{heading}</p>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? "Widen the menu" : "Narrow the menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Widen the menu" : "Narrow the menu to its icons"}
            className="rounded-md p-1.5 text-[#8a94a4] hover:bg-[#f2f7fb] hover:text-[#1f4e79]"
          >
            {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </button>
        </div>
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = item.id === activeId;
          const startsGroup = Boolean(item.group) && item.group !== items[index - 1]?.group;
          return (
            <div key={item.id} className="contents">
            {startsGroup && !collapsed ? (
              <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[#8a94a4]">
                {item.group}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => onSelect(item.id)}
              title={item.name}
              aria-current={active ? "page" : undefined}
              // A sub-page is a smaller line under its parent: tighter, lighter, closer.
              className={`flex items-center rounded-md text-left ${
                collapsed
                  ? "justify-center px-2 py-2"
                  : item.parent
                    ? "ml-7 gap-2 border-l-2 py-1 pl-2.5 pr-3 text-[13px]"
                    : "gap-3 py-2 px-3 text-sm"
              } ${
                active
                  ? `bg-[#e8edf3] font-semibold text-[#1f4e79] ${item.parent ? "border-[#1f4e79]" : ""}`
                  : `font-medium text-[#424956] hover:bg-[#f2f7fb] hover:text-[#1f4e79] ${item.parent ? "border-[#e4e8ef]" : ""}`
              }`}
            >
              <Icon
                size={collapsed ? 17 : item.parent ? 13 : 16}
                className={`shrink-0 ${item.parent && !collapsed ? "text-[#5b7a9a]" : "text-[#1f4e79]"}`}
                aria-hidden="true"
              />
              {collapsed ? <span className="sr-only">{item.name}</span> : <span className="truncate">{item.name}</span>}
            </button>
            </div>
          );
        })}
      </nav>

      {footer && !collapsed ? <div className="shrink-0 border-t border-[#edf0f4] p-3">{footer}</div> : null}
    </aside>
  );
}
