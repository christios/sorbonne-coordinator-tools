import { ArrowLeft } from "lucide-react";
import { ReactNode, RefObject, UIEvent, useEffect, useRef, useState } from "react";

import { WORKSPACE_BODY, WORKSPACE_SIDEBAR } from "@/components/workspaceLayout";

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
    <div data-testid="editor-header" className={`sticky top-0 z-20 shrink-0 border-b border-[#d9dee7] bg-[#f7f8fa] transition-[padding,gap] duration-200 ${headerCollapsed ? "py-2" : "pb-4"}`}>
      <div className={`flex min-w-0 flex-col gap-3 transition-[gap] duration-200 lg:flex-row lg:items-center lg:justify-between ${headerCollapsed ? "lg:gap-2" : "lg:gap-4"}`}>
        <div className="flex min-w-0 items-start gap-3 lg:min-w-[14rem] lg:flex-1"><button type="button" onClick={onBack} className={`rounded-md p-2 text-[#344054] hover:bg-[#e8edf3] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${headerCollapsed ? "mt-0" : "mt-1"}`} aria-label={backLabel}><ArrowLeft size={19} /></button><div className="min-w-0"><p className={`text-sm font-medium text-[#a6292f] ${headerCollapsed ? "hidden" : ""}`}>{eyebrow}</p>{titleControl ?? <h2 title={title} className={`truncate font-semibold text-[#171717] transition-[font-size] duration-200 ${headerCollapsed ? "text-lg" : "text-xl"}`}>{title}</h2>}<div className={`flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-[#667085] ${headerCollapsed ? "hidden" : ""}`}><span>{subtitle}</span>{titleMeta ? <><span aria-hidden="true" className="text-[#c0c6cf]">·</span>{titleMeta}</> : null}</div></div></div>
        {actions || (headerCollapsed && compactHeaderActions) ? <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">{actions}{headerCollapsed ? compactHeaderActions : null}</div> : null}
      </div>
    </div>
    {notice}
    <div className={WORKSPACE_BODY}>
      <nav aria-label={`${subtitle} sections`} className={WORKSPACE_SIDEBAR}>{sections.map((section) => {
        const count = sectionCounts[section.id] ?? 0;
        const active = activeSection === section.id;
        return <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} aria-current={active ? "step" : undefined} aria-label={count ? `${section.label}, ${count} to fill in` : undefined} className={`flex w-full items-start justify-between gap-2 rounded-md px-3 py-2 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f4e79] ${active ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}><span className="min-w-0">{section.label}</span>{count ? <span aria-hidden="true" className="mt-px shrink-0 rounded-full bg-[#fef0c7] px-1.5 text-xs font-semibold tabular-nums leading-5 text-[#8a4b00]">{count}</span> : null}</button>;
      })}</nav>
      <div ref={workspaceRef} data-testid="editor-workspace" onScroll={handleScroll} className={`min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2 ${headerCollapsed ? "lg:pb-36" : ""}`}>{children}</div>
    </div>
  </div>;
}
