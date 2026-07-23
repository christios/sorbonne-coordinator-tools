import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { SyllabusComparison } from "@/components/SyllabusComparison";
import { SyllabusEditor } from "@/components/SyllabusEditor";
import { SyllabusLibrary } from "@/components/SyllabusLibrary";
import {
  CreateSyllabusInput,
  Syllabus,
  createFolder,
  createSyllabus,
  deleteSyllabus,
  getSyllabus,
  listSyllabusFolders,
  listSyllabi,
  moveSyllabusToFolder,
} from "@/services/syllabi";

export function SyllabusBuilder() {
  const client = useQueryClient();
  const [screen, setScreen] = useState<{ view: "library" } | { view: "editor" | "comparison"; id: string }>({ view: "library" });
  const list = useQuery({ queryKey: ["syllabi"], queryFn: listSyllabi });
  const folders = useQuery({ queryKey: ["syllabus-folders"], queryFn: listSyllabusFolders });
  const detail = useQuery({ queryKey: ["syllabus", screen.view === "library" ? "" : screen.id], queryFn: () => getSyllabus((screen as { id: string }).id), enabled: screen.view !== "library" });
  const create = useMutation({ mutationFn: createSyllabus, onSuccess: (syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); setScreen({ view: "editor", id: syllabus.id }); } });
  const createFolderMutation = useMutation({ mutationFn: createFolder, onSuccess: () => client.invalidateQueries({ queryKey: ["syllabus-folders"] }) });
  const move = useMutation({ mutationFn: ({ syllabusId, folderId }: { syllabusId: string; folderId: string | null }) => moveSyllabusToFolder(syllabusId, folderId), onSuccess: (syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); } });
  const remove = useMutation({ mutationFn: deleteSyllabus, onSuccess: (_, syllabusId) => { client.removeQueries({ queryKey: ["syllabus", syllabusId] }); client.invalidateQueries({ queryKey: ["syllabi"] }); } });
  const saved = (syllabus: Syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); };
  const libraryError = [list.error, folders.error, create.error, createFolderMutation.error, move.error, remove.error].find(
    (error): error is Error => error instanceof Error,
  );
  if (screen.view === "library") return <SyllabusLibrary syllabi={list.data ?? []} folders={folders.data ?? []} isLoading={list.isLoading || folders.isLoading} isCreating={create.isPending} isCreatingFolder={createFolderMutation.isPending} deletingId={remove.isPending ? remove.variables ?? null : null} movingId={move.isPending ? move.variables?.syllabusId ?? null : null} error={libraryError?.message} onOpen={(id) => setScreen({ view: "editor", id })} onCreate={(input: CreateSyllabusInput) => create.mutate(input)} onCreateFolder={(name) => createFolderMutation.mutate(name)} onMove={(syllabusId, folderId) => move.mutate({ syllabusId, folderId })} onDelete={(syllabusId) => remove.mutate(syllabusId)} />;
  if (detail.isLoading || !detail.data) return <div className="p-8 text-center text-sm text-[#667085]">Loading syllabus…</div>;
  if (screen.view === "comparison") return <SyllabusComparison syllabus={detail.data} candidates={list.data ?? []} onBack={() => setScreen({ view: "editor", id: detail.data.id })} />;
  return <SyllabusEditor syllabus={detail.data} onBack={() => setScreen({ view: "library" })} onSaved={saved} onCompare={() => setScreen({ view: "comparison", id: detail.data.id })} />;
}
