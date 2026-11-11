import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { ScreenLoading } from "@/components/ScreenLoading";
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
import { hashFor, sameScreen, screenFromHash, type SyllabusScreen } from "@/services/syllabusRoute";

type Props = {
  onEditorHeaderCollapseChange?: (collapsed: boolean) => void;
  compactHeaderActions?: ReactNode;
};

export function SyllabusBuilder({ onEditorHeaderCollapseChange, compactHeaderActions }: Props) {
  const client = useQueryClient();
  // Where you are lives in the address, so a refresh or Back keeps you there (11 Nov 2026).
  const [screen, setScreenState] = useState<SyllabusScreen>(() => screenFromHash(window.location.hash));
  const screenRef = useRef(screen);
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);
  useEffect(() => {
    const follow = () => setScreenState(screenFromHash(window.location.hash));
    window.addEventListener("popstate", follow);
    window.addEventListener("hashchange", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("hashchange", follow);
    };
  }, []);
  // Opening another screen is a step Back returns from; another section of the same screen
  // only rewrites the address, or Back would walk through every section glanced at.
  const setScreen = useCallback((next: SyllabusScreen) => {
    const address = hashFor(next);
    if (address === window.location.hash) return;
    if (sameScreen(screenRef.current, next)) window.history.replaceState(null, "", address);
    else window.history.pushState(null, "", address);
    screenRef.current = next;
    setScreenState(next);
  }, []);
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
  if (screen.view === "catalogues") return <SyllabusCatalogues section={screen.section} onSectionChange={(section) => setScreen({ view: "catalogues", section })} onBack={() => setScreen({ view: "library" })} />;
  // An address naming a syllabus that is gone, or not yours to open, says so rather than spinning.
  if (detail.isError) return <div role="alert" className="mx-auto mt-16 max-w-md rounded-lg border border-[#efc9cb] bg-[#fff5f5] p-6 text-center text-sm text-[#8f1f25]"><p>This syllabus could not be opened{detail.error instanceof Error ? `: ${detail.error.message}` : "."}</p><button type="button" onClick={() => setScreen({ view: "library" })} className="mt-4 rounded-md border border-[#b7bec8] bg-white px-3 py-2 font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]">Back to the syllabus library</button></div>;
  if (detail.isLoading || templates.isLoading || !detail.data) return <ScreenLoading label="Loading syllabus…" />;
  const template = templates.data?.find((item) => item.id === detail.data.templateId);
  if (!template) return <div role="alert" className="p-8 text-center text-sm text-[#a6292f]">This syllabus refers to a template that is no longer available.</div>;
  if (screen.view === "comparison") return <div className="h-full overflow-y-auto"><SyllabusComparison syllabus={detail.data} candidates={list.data ?? []} onBack={() => setScreen({ view: "editor", id: detail.data.id })} /></div>;
  const id = detail.data.id;
  return <SyllabusEditor key={id} syllabus={detail.data} template={template} section={screen.view === "editor" ? screen.section : undefined} onSectionChange={(section) => setScreen({ view: "editor", id, section })} onBack={() => setScreen({ view: "library" })} onSaved={saved} onCompare={() => setScreen({ view: "comparison", id })} onHeaderCollapseChange={onEditorHeaderCollapseChange} compactHeaderActions={compactHeaderActions} />;
}
