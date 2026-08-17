import { ArrowLeft } from "lucide-react";
import { ReactNode, RefObject } from "react";

export type EditorSection = { id: string; label: string };

type Props = {
  backLabel: string;
  onBack: () => void;
  eyebrow: string;
  title: string;
  subtitle: string;
  titleMeta?: ReactNode;
  actions: ReactNode;
  sections: EditorSection[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  children: ReactNode;
  notice?: ReactNode;
  containerRef?: RefObject<HTMLDivElement | null>;
};

export function SectionEditorShell({
  backLabel,
  onBack,
  eyebrow,
  title,
  subtitle,
  titleMeta,
  actions,
  sections,
  activeSection,
  onSectionChange,
  children,
  notice,
  containerRef,
}: Props) {
  return <div ref={containerRef} className="mx-auto h-full max-w-7xl overflow-y-auto px-4 py-5 sm:px-6 lg:flex lg:flex-col lg:overflow-hidden lg:px-8">
    <div className="shrink-0 flex flex-col gap-4 border-b border-[#d9dee7] pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex items-start gap-3"><button type="button" onClick={onBack} className="mt-1 rounded-md p-2 text-[#344054] hover:bg-[#e8edf3] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" aria-label={backLabel}><ArrowLeft size={19} /></button><div><p className="text-sm font-medium text-[#a6292f]">{eyebrow}</p><h2 className="text-xl font-semibold text-[#171717]">{title}</h2><p className="text-sm text-[#667085]">{subtitle}</p>{titleMeta}</div></div>
      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </div>
    {notice}
    <div className="mt-5 grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[245px_minmax(0,1fr)]">
      <nav aria-label={`${subtitle} sections`} className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit">{sections.map((section) => <button key={section.id} type="button" onClick={() => onSectionChange(section.id)} className={`block w-full rounded-md px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${activeSection === section.id ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}>{section.label}</button>)}</nav>
      <div data-testid="editor-workspace" className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-2">{children}</div>
    </div>
  </div>;
}
