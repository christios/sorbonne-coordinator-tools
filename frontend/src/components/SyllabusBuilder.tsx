import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SyllabusComparison } from "@/components/SyllabusComparison";
import { SyllabusEditor } from "@/components/SyllabusEditor";
import { SyllabusLibrary } from "@/components/SyllabusLibrary";
import { CreateSyllabusInput, Syllabus, createSyllabus, getSyllabus, listSyllabi } from "@/services/syllabi";

export function SyllabusBuilder() {
  const client = useQueryClient();
  const [screen, setScreen] = useState<{ view: "library" } | { view: "editor" | "comparison"; id: string }>({ view: "library" });
  const list = useQuery({ queryKey: ["syllabi"], queryFn: listSyllabi });
  const detail = useQuery({ queryKey: ["syllabus", screen.view === "library" ? "" : screen.id], queryFn: () => getSyllabus((screen as { id: string }).id), enabled: screen.view !== "library" });
  const create = useMutation({ mutationFn: createSyllabus, onSuccess: (syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); setScreen({ view: "editor", id: syllabus.id }); } });
  const saved = (syllabus: Syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); };
  if (screen.view === "library") return <SyllabusLibrary syllabi={list.data ?? []} isLoading={list.isLoading} onOpen={(id) => setScreen({ view: "editor", id })} onCreate={(input: CreateSyllabusInput) => create.mutate(input)} isCreating={create.isPending} />;
  if (detail.isLoading || !detail.data) return <div className="p-8 text-center text-sm text-[#667085]">Loading syllabus…</div>;
  if (screen.view === "comparison") return <SyllabusComparison syllabus={detail.data} candidates={list.data ?? []} onBack={() => setScreen({ view: "editor", id: detail.data.id })} />;
  return <SyllabusEditor syllabus={detail.data} onBack={() => setScreen({ view: "library" })} onSaved={saved} onCompare={() => setScreen({ view: "comparison", id: detail.data.id })} />;
}
