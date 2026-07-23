import { useState } from "react";

import { AssessmentAiPolicyEditor, AssessmentGradingEditor, AssessmentItemsEditor } from "@/components/StructuredEntryEditors";
import { HistoryField } from "@/components/FieldHistory";

type Props = {
  value: Record<string, unknown>;
  outcomes: Array<Record<string, string> & { id: string }>;
  onChange: (value: Record<string, unknown>) => void;
  syllabusId: string;
  revision: number;
  onOpenHistory: (field: HistoryField) => void;
};

const tabs = [
  { key: "activities", label: "Graded activities" },
  { key: "rubrics", label: "Grading criteria" },
  { key: "ai", label: "AI policy" },
] as const;

export function AssessmentTabs({ value, outcomes, onChange, syllabusId, revision, onOpenHistory }: Props) {
  const [tab, setTab] = useState<(typeof tabs)[number]["key"]>("activities");
  const history = { syllabusId, revision, onOpenHistory };

  return <div role="tablist" aria-label="Course assessment editor" className="mt-5 border-b border-[#d9dee7]"><div className="flex gap-1 overflow-x-auto">{tabs.map((item) => <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${tab === item.key ? "border-[#1f4e79] text-[#1f4e79]" : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"}`}>{item.label}</button>)}</div><div role="tabpanel" className="mt-5">{tab === "activities" ? <AssessmentItemsEditor value={value} outcomes={outcomes} onChange={onChange} {...history} /> : null}{tab === "rubrics" ? <AssessmentGradingEditor value={value} onChange={onChange} {...history} /> : null}{tab === "ai" ? <AssessmentAiPolicyEditor value={value} onChange={onChange} {...history} /> : null}</div></div>;
}
