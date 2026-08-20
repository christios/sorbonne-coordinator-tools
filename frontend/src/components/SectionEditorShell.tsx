import { ArrowLeft } from "lucide-react";
import { ReactNode, RefObject, UIEvent, useEffect, useRef, useState } from "react";

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
}: Props) {
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const headerCollapsedRef = useRef(false);
  const lastScrollTop = useRef(0);

  useEffect(() => () => onHeaderCollapseChange?.(false), [onHeaderCollapseChange]);

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

  return <div ref={containerRef} className="mx-auto h-full max-w-[98rem] overflow-y-auto px-4 py-5 sm:px-6 lg:flex lg:flex-col lg:overflow-hidden lg:px-8">
    <div data-testid="editor-header" className={`sticky top-0 z-20 shrink-0 border-b border-[#d9dee7] bg-[#f7f8fa] transition-[padding,gap] duration-200 ${headerCollapsed ? "py-2" : "pb-4"}`}>
      <div className={`flex min-w-0 flex-col gap-3 transition-[gap] duration-200 lg:flex-row lg:items-center lg:justify-between ${headerCollapsed ? "lg:gap-2" : "lg:gap-4"}`}>
        <div className="flex min-w-0 items-start gap-3"><button type="button" onClick={onBack} className={`rounded-md p-2 text-[#344054] hover:bg-[#e8edf3] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${headerCollapsed ? "mt-0" : "mt-1"}`} aria-label={backLabel}><ArrowLeft size={19} /></button><div className="min-w-0"><p className={`text-sm font-medium text-[#a6292f] ${headerCollapsed ? "hidden" : ""}`}>{eyebrow}</p>{titleControl ?? <h2 title={title} className={`truncate font-semibold text-[#171717] transition-[font-size] duration-200 ${headerCollapsed ? "text-lg" : "text-xl"}`}>{title}</h2>}<p className={`text-sm text-[#667085] ${headerCollapsed ? "hidden" : ""}`}>{subtitle}</p><div className={headerCollapsed ? "hidden" : ""}>{titleMeta}</div></div></div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}{headerCollapsed ? compactHeaderActions : null}</div>
      </div>
    </div>
    {notice}
    <div className="mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[245px_minmax(0,1fr)]">
      <nav aria-label={`${subtitle} sections`} className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit">{sections.map((section) => <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} className={`block w-full rounded-md px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${activeSection === section.id ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}>{section.label}</button>)}</nav>
      <div data-testid="editor-workspace" onScroll={handleScroll} className={`min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2 ${headerCollapsed ? "lg:pb-36" : ""}`}>{children}</div>
    </div>
  </div>;
}
