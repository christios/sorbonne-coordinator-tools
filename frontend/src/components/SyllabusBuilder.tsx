import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useEffect, useState } from "react";

import { SyllabusComparison } from "@/components/SyllabusComparison";
import { SyllabusCatalogues } from "@/components/SyllabusCatalogues";
import { SyllabusEditor } from "@/components/SyllabusEditor";
import { SyllabusLibrary } from "@/components/SyllabusLibrary";
import {
  CreateSyllabusInput,
  CreateFolderInput,
  Syllabus,
  createFolder,
  createSyllabus,
  deleteFolder,
  deleteSyllabus,
  getSyllabus,
  listSyllabusFolders,
  listSyllabi,
  listSyllabusTemplates,
  moveSyllabusToFolder,
  updateSyllabus,
} from "@/services/syllabi";

type Props = {
  onEditorHeaderCollapseChange?: (collapsed: boolean) => void;
  compactHeaderActions?: ReactNode;
};

export function SyllabusBuilder({ onEditorHeaderCollapseChange, compactHeaderActions }: Props) {
  const client = useQueryClient();
  const [screen, setScreen] = useState<{ view: "library" | "catalogues" } | { view: "editor" | "comparison"; id: string }>({ view: "library" });
  const list = useQuery({ queryKey: ["syllabi"], queryFn: listSyllabi });
  const folders = useQuery({ queryKey: ["syllabus-folders"], queryFn: listSyllabusFolders });
  const templates = useQuery({ queryKey: ["syllabus-templates"], queryFn: listSyllabusTemplates });
  const detail = useQuery({ queryKey: ["syllabus", screen.view === "editor" || screen.view === "comparison" ? screen.id : ""], queryFn: () => getSyllabus((screen as { id: string }).id), enabled: screen.view === "editor" || screen.view === "comparison" });
  const create = useMutation({ mutationFn: createSyllabus, onSuccess: (syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); setScreen({ view: "editor", id: syllabus.id }); } });
  const createFolderMutation = useMutation({ mutationFn: createFolder, onSuccess: () => client.invalidateQueries({ queryKey: ["syllabus-folders"] }) });
  const removeFolder = useMutation({ mutationFn: deleteFolder, onSuccess: () => client.invalidateQueries({ queryKey: ["syllabus-folders"] }) });
  const move = useMutation({ mutationFn: ({ syllabusId, folderId }: { syllabusId: string; folderId: string | null }) => moveSyllabusToFolder(syllabusId, folderId), onSuccess: (syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); } });
  const remove = useMutation({ mutationFn: deleteSyllabus, onSuccess: (_, syllabusId) => { client.removeQueries({ queryKey: ["syllabus", syllabusId] }); client.invalidateQueries({ queryKey: ["syllabi"] }); } });
  const rename = useMutation({
    mutationFn: async ({ syllabusId, courseTitle }: { syllabusId: string; courseTitle: string }) => {
      const current = await getSyllabus(syllabusId);
      return updateSyllabus(syllabusId, {
        expectedRevision: current.revision,
        content: current.content,
        courseTitle,
        courseCode: current.courseCode,
        academicYear: current.academicYear,
      });
    },
    onSuccess: (syllabus) => {
      client.setQueryData(["syllabus", syllabus.id], syllabus);
      client.invalidateQueries({ queryKey: ["syllabi"] });
    },
  });
  useEffect(() => {
    if (screen.view !== "editor") onEditorHeaderCollapseChange?.(false);
  }, [onEditorHeaderCollapseChange, screen.view]);
  const saved = (syllabus: Syllabus) => { client.setQueryData(["syllabus", syllabus.id], syllabus); client.invalidateQueries({ queryKey: ["syllabi"] }); };
  const libraryError = [list.error, folders.error, templates.error, create.error, createFolderMutation.error, removeFolder.error, move.error, remove.error].find(
    (error): error is Error => error instanceof Error,
  );
  if (screen.view === "library") return <div className="h-full overflow-y-auto"><SyllabusLibrary syllabi={list.data ?? []} folders={folders.data ?? []} templates={templates.data ?? []} isLoading={list.isLoading || folders.isLoading || templates.isLoading} isCreating={create.isPending} isCreatingFolder={createFolderMutation.isPending} deletingId={remove.isPending ? remove.variables ?? null : null} deletingFolderId={removeFolder.isPending ? removeFolder.variables ?? null : null} movingId={move.isPending ? move.variables?.syllabusId ?? null : null} renamingId={rename.isPending ? rename.variables?.syllabusId ?? null : null} error={libraryError?.message} onOpen={(id) => setScreen({ view: "editor", id})} onCreate={(input: CreateSyllabusInput) => create.mutate(input)} onCreateFolder={(input: CreateFolderInput) => createFolderMutation.mutate(input)} onMove={(syllabusId, folderId) => move.mutate({ syllabusId, folderId })} onRename={(syllabusId, courseTitle) => rename.mutateAsync({ syllabusId, courseTitle })} onDelete={(syllabusId) => remove.mutate(syllabusId)} onDeleteFolder={(folderId) => removeFolder.mutate(folderId)} onManageCatalogues={() => setScreen({ view: "catalogues" })} /></div>;
  if (screen.view === "catalogues") return <SyllabusCatalogues onBack={() => setScreen({ view: "library" })} />;
  if (detail.isLoading || templates.isLoading || !detail.data) return <div className="p-8 text-center text-sm text-[#667085]">Loading syllabus…</div>;
  const template = templates.data?.find((item) => item.id === detail.data.templateId);
  if (!template) return <div role="alert" className="p-8 text-center text-sm text-[#a6292f]">This syllabus refers to a template that is no longer available.</div>;
  if (screen.view === "comparison") return <div className="h-full overflow-y-auto"><SyllabusComparison syllabus={detail.data} candidates={list.data ?? []} onBack={() => setScreen({ view: "editor", id: detail.data.id })} /></div>;
  return <SyllabusEditor syllabus={detail.data} template={template} onBack={() => setScreen({ view: "library" })} onSaved={saved} onCompare={() => setScreen({ view: "comparison", id: detail.data.id })} onHeaderCollapseChange={onEditorHeaderCollapseChange} compactHeaderActions={compactHeaderActions} />;
}
