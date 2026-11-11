import { ArrowLeft } from "lucide-react";
import { ReactNode, RefObject, UIEvent, useEffect, useRef, useState } from "react";

import { WORKSPACE_BODY, WORKSPACE_BODY_COMPACT_MENU, WORKSPACE_SIDEBAR } from "@/components/workspaceLayout";

export type EditorSection = { id: string; label: string };

type Props = {
  backLabel: string;
  onBack: () => void;
  eyebrow: string;
  title: string;
  titleControl?: ReactNode;
  subtitle: string;
  titleMeta?: ReactNode;
  actions: ReactNode;
  sections: EditorSection[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  children: ReactNode;
  notice?: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
  onHeaderCollapseChange?: (collapsed: boolean) => void;
  compactHeaderActions?: ReactNode;
  /** Shrink the menu to section numbers on 1024–1279px screens, to give the content room. */
  compactMenu?: boolean;
  /**
   * The open section fills the height and scrolls inside its own panes, as Coordinator Tools'
   * other screens do (the learning outcomes' matrices and panel, 11 Nov 2026), rather than
   * the whole section scrolling as one page. From `lg` up; a phone still scrolls as a page.
   */
  fill?: boolean;
  /** How many things each section still lacks, shown beside its name in the menu. */
  sectionCounts?: Partial<Record<string, number>>;
};

export function SectionEditorShell({
  backLabel,
  onBack,
  eyebrow,
  title,
  titleControl,
  subtitle,
  titleMeta,
  actions,
  sections,
  activeSection,
  onSectionChange,
  children,
  notice,
  containerRef,
  onHeaderCollapseChange,
  compactHeaderActions,
  sectionCounts = {},
  compactMenu = false,
  fill = false,
}: Props) {
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const headerCollapsedRef = useRef(false);
  const lastScrollTop = useRef(0);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => onHeaderCollapseChange?.(false), [onHeaderCollapseChange]);

  // A section opens at its top, not wherever the previous one was left scrolled to.
  useEffect(() => {
    if (workspaceRef.current) workspaceRef.current.scrollTop = 0;
  }, [activeSection]);

  function updateHeaderState(collapsed: boolean) {
    if (headerCollapsedRef.current === collapsed) return;
    headerCollapsedRef.current = collapsed;
    setHeaderCollapsed(collapsed);
    onHeaderCollapseChange?.(collapsed);
  }

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const scrollTop = event.currentTarget.scrollTop;
    const distance = scrollTop - lastScrollTop.current;
    lastScrollTop.current = scrollTop;
    if (scrollTop <= 12) updateHeaderState(false);
    else if (distance >= 8 && scrollTop >= 48) updateHeaderState(true);
  }

  return <div ref={containerRef} className="h-full w-full overflow-y-auto page-gutters [--page-cap:98rem] [--page-pad:1rem] sm:[--page-pad:1.5rem] lg:[--page-pad:2rem] py-3 lg:flex lg:flex-col lg:overflow-hidden">
    <div data-testid="editor-header" className={`sticky top-0 z-20 shrink-0 border-b border-[#c3cbd6] bg-[#f7f8fa] transition-[padding,gap] duration-200 ${headerCollapsed ? "py-2" : "pb-4"}`}>
      <div className={`flex min-w-0 flex-col gap-3 transition-[gap] duration-200 lg:flex-row lg:items-center lg:justify-between ${headerCollapsed ? "lg:gap-2" : "lg:gap-4"}`}>
        <div className="flex min-w-0 items-start gap-3 lg:min-w-[14rem] lg:flex-1"><button type="button" onClick={onBack} className={`rounded-md p-2 text-[#344054] hover:bg-[#e8edf3] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${headerCollapsed ? "mt-0" : "mt-1"}`} aria-label={backLabel}><ArrowLeft size={19} /></button><div className="min-w-0"><p className={`text-sm font-medium text-[#a6292f] ${headerCollapsed ? "hidden" : ""}`}>{eyebrow}</p>{titleControl ?? <h2 title={title} className={`truncate font-semibold text-[#171717] transition-[font-size] duration-200 ${headerCollapsed ? "text-lg" : "text-xl"}`}>{title}</h2>}<div className={`flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-[#475467] ${headerCollapsed ? "hidden" : ""}`}><span>{subtitle}</span>{titleMeta ? <><span aria-hidden="true" className="text-[#c0c6cf]">·</span>{titleMeta}</> : null}</div></div></div>
        {actions || (headerCollapsed && compactHeaderActions) ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">{actions}{headerCollapsed ? compactHeaderActions : null}</div> : null}
      </div>
    </div>
    {notice}
    <div className={compactMenu ? WORKSPACE_BODY_COMPACT_MENU : WORKSPACE_BODY}>
      <nav aria-label={`${subtitle} sections`} className={`${WORKSPACE_SIDEBAR} ${compactMenu ? "lg:max-xl:px-1.5" : ""}`}>{sections.map((section) => {
        const count = sectionCounts[section.id] ?? 0;
        const active = activeSection === section.id;
        // Compact, a section is its number ("4" for "4. Learning outcomes"), its name on hover.
        const short = /^(\d+)\./.exec(section.label)?.[1] ?? section.label.slice(0, 1);
        const compact = compactMenu ? "lg:max-xl:relative lg:max-xl:justify-center lg:max-xl:px-0 lg:max-xl:py-2.5" : "";
        return <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} title={compactMenu ? section.label : undefined} aria-current={active ? "step" : undefined} aria-label={count ? `${section.label}, ${count} to fill in` : undefined} className={`flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79] ${compact} ${active ? "bg-[#1f4e79] font-semibold text-white" : "text-[#344054] hover:bg-[#eef2f7]"}`}><span className={`min-w-0 ${compactMenu ? "lg:max-xl:sr-only" : ""}`}>{section.label}</span>{compactMenu ? <span aria-hidden="true" className="hidden text-base tabular-nums lg:max-xl:inline">{short}</span> : null}{count ? <span aria-hidden="true" className={`mt-px shrink-0 rounded-full bg-[#fef0c7] px-1.5 text-xs font-semibold tabular-nums leading-5 text-[#8a4b00] ${compactMenu ? "lg:max-xl:absolute lg:max-xl:-right-0.5 lg:max-xl:-top-1 lg:max-xl:mt-0 lg:max-xl:px-1 lg:max-xl:text-[10px] lg:max-xl:leading-4" : ""}`}>{count}</span> : null}</button>;
      })}</nav>
      <div ref={workspaceRef} data-testid="editor-workspace" onScroll={handleScroll} className={`min-w-0 lg:min-h-0 ${fill ? "lg:flex lg:flex-col lg:overflow-hidden" : `lg:overflow-y-auto lg:pr-2 ${headerCollapsed ? "lg:pb-36" : ""}`}`}>{children}</div>
    </div>
  </div>;
}
