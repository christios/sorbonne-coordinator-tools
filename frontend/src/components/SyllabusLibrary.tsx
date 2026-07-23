import { CalendarDays, ChevronRight, Copy, FileCode2, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, History, Loader2, Search, Trash2 } from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import { CreateFolderInput, CreateSyllabusInput, SyllabusFolder, SyllabusSummary, SyllabusTemplate, syllabusTemplateDocumentUrl } from "@/services/syllabi";
import { FolderMoveMenu } from "@/components/FolderMoveMenu";
import { SelectMenu } from "@/components/SelectMenu";

const UNFILED = "unfiled";

type Props = {
  syllabi: SyllabusSummary[];
  folders: SyllabusFolder[];
  templates: SyllabusTemplate[];
  isLoading: boolean;
  isCreating: boolean;
  isCreatingFolder: boolean;
  deletingId: string | null;
  deletingFolderId: string | null;
  movingId: string | null;
  error?: string;
  onOpen: (id: string) => void;
  onCreate: (input: CreateSyllabusInput) => void;
  onCreateFolder: (input: CreateFolderInput) => void;
  onMove: (syllabusId: string, folderId: string | null) => void;
  onDelete: (syllabusId: string) => void;
  onDeleteFolder: (folderId: string) => void;
};

export function SyllabusLibrary({
  syllabi,
  folders,
  templates,
  isLoading,
  isCreating,
  isCreatingFolder,
  deletingId,
  deletingFolderId,
  movingId,
  error,
  onOpen,
  onCreate,
  onCreateFolder,
  onMove,
  onDelete,
  onDeleteFolder,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [showFolderForm, setShowFolderForm] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [year, setYear] = useState("2026-2027");
  const [folderName, setFolderName] = useState("");
  const [activeFolder, setActiveFolder] = useState("all");
  const [folderQuery, setFolderQuery] = useState("");
  const [syllabusQuery, setSyllabusQuery] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<SyllabusSummary | null>(null);
  const [folderDeleteCandidate, setFolderDeleteCandidate] = useState<SyllabusFolder | null>(null);

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);

  const visibleSyllabi = useMemo(
    () => syllabi.filter((syllabus) => activeFolder === "all" ? true : activeFolder === UNFILED ? syllabus.folderId === null : syllabus.folderId === activeFolder),
    [activeFolder, syllabi],
  );
  const filteredSyllabi = useMemo(() => {
    const query = syllabusQuery.trim().toLocaleLowerCase();
    if (!query) return visibleSyllabi;
    return visibleSyllabi.filter((syllabus) => [syllabus.courseTitle, syllabus.courseCode, syllabus.academicYear].some((value) => value.toLocaleLowerCase().includes(query)));
  }, [syllabusQuery, visibleSyllabi]);
  const folderTree = useMemo(() => flattenFolders(folders), [folders]);
  const folderPaths = useMemo(() => new Map(folderTree.map(({ folder, path }) => [folder.id, path])), [folderTree]);
  const filteredFolders = useMemo(() => {
    const query = folderQuery.trim().toLocaleLowerCase();
    if (!query) return folderTree;
    return folderTree.filter(({ path }) => path.some((folder) => folder.name.toLocaleLowerCase().includes(query)));
  }, [folderQuery, folderTree]);
  const activeFolderLabel = activeFolder === "all" ? "All syllabi" : activeFolder === UNFILED ? "Unfiled" : folders.find((folder) => folder.id === activeFolder)?.name ?? "All syllabi";
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const selectedFolder = folders.find((folder) => folder.id === activeFolder);
  const unfiledCount = syllabi.filter((syllabus) => syllabus.folderId === null).length;

  useEffect(() => {
    if (activeFolder === UNFILED && unfiledCount === 0) setActiveFolder("all");
  }, [activeFolder, unfiledCount]);

  function submitSyllabus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({ courseTitle: title.trim(), courseCode: code.trim(), academicYear: year.trim(), sourceSyllabusId: sourceId || undefined, templateId: templateId || undefined });
  }

  function submitFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    onCreateFolder({ name, parentId: selectedFolder?.id ?? null });
    setFolderName("");
    setShowFolderForm(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-[#d9dee7] pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-[#a6292f]">SCEN workspace</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#171717]">Syllabus library</h2>
          <p className="mt-1 text-sm text-[#667085]">Create, organize, and compare course syllabi across academic years.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => setShowFolderForm((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#b7bec8] bg-white px-4 py-2.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><FolderPlus size={17} aria-hidden="true" /> New folder</button>
          <button type="button" onClick={() => setShowForm((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#183f63]"><FilePlus2 size={17} aria-hidden="true" /> New syllabus</button>
        </div>
      </div>

      {error ? <p role="alert" className="mt-4 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">{error}</p> : null}

      {showFolderForm ? (
        <form onSubmit={submitFolder} className="mt-5 flex max-w-lg flex-col gap-3 rounded-lg border border-[#cbd5e1] bg-white p-4 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1 text-sm font-medium text-[#344054]">Folder name<span className="text-xs font-normal text-[#667085]">{selectedFolder ? `Creates inside ${folderPaths.get(selectedFolder.id)?.map((folder) => folder.name).join(" › ") ?? selectedFolder.name}.` : "Creates at the top level."}</span><input autoFocus required value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Bachelor in Public Affairs" className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>
          <div className="flex gap-2"><button disabled={isCreatingFolder} className="rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">{isCreatingFolder ? "Creating…" : "Create folder"}</button><button type="button" onClick={() => setShowFolderForm(false)} className="rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#344054]">Cancel</button></div>
        </form>
      ) : null}

      {showForm ? (
        <form onSubmit={submitSyllabus} className="mt-6 grid gap-4 rounded-lg border border-[#cbd5e1] bg-white p-5 md:grid-cols-2">
          <div className="md:col-span-2"><h3 className="text-base font-semibold text-[#171717]">Start a syllabus</h3><p className="mt-1 text-sm text-[#667085]">Start blank or carry an existing syllabus into a new academic year.</p></div>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">Course title<input required value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">Academic year<input required value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026-2027" className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">Course code <span className="font-normal text-[#667085]">(optional)</span><input value={code} onChange={(event) => setCode(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">Starting point<SelectMenu label="Starting point" value={sourceId} onChange={(nextSourceId) => { setSourceId(nextSourceId); const source = syllabi.find((syllabus) => syllabus.id === nextSourceId); if (source) setTemplateId(source.templateId); }} placeholder="Blank syllabus" options={[{ value: "", label: "Blank syllabus" }, ...syllabi.map((syllabus) => ({ value: syllabus.id, label: `${syllabus.courseTitle} — ${syllabus.academicYear}` }))]} /></label>
          <div className="grid gap-1 text-sm font-medium text-[#344054] md:col-span-2"><span>Template</span><SelectMenu label="Syllabus template" value={templateId} onChange={setTemplateId} placeholder="Choose a template" options={templates.map((template) => ({ value: template.id, label: template.name }))} />{selectedTemplate ? <a href={syllabusTemplateDocumentUrl(selectedTemplate)} className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-[#1f4e79] hover:underline"><FileText size={16} aria-hidden="true" /> View Word template</a> : null}{sourceId ? <p className="text-sm font-normal text-[#667085]">Duplicates retain their source template so yearly comparison remains reliable.</p> : null}</div>
          <div className="flex gap-3 md:col-span-2"><button disabled={isCreating} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">{isCreating ? <Loader2 className="animate-spin" size={16} /> : sourceId ? <Copy size={16} /> : <FilePlus2 size={16} />}{sourceId ? "Duplicate and edit" : "Create blank syllabus"}</button><button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button></div>
        </form>
      ) : null}

      <div className="mt-6 grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit">
          <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-normal text-[#667085]">Folders</p>
          <label className="relative mb-2 block px-1">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
            <input type="search" aria-label="Search folders" value={folderQuery} onChange={(event) => setFolderQuery(event.target.value)} placeholder="Search folders" className="w-full rounded-md border border-[#cbd5e1] py-2 pl-9 pr-3 text-sm text-[#344054] placeholder:text-[#98a2b3] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" />
          </label>
          <FolderButton label="All syllabi" count={syllabi.length} active={activeFolder === "all"} onClick={() => setActiveFolder("all")} />
          {unfiledCount > 0 ? <FolderButton label="Unfiled" count={unfiledCount} active={activeFolder === UNFILED} onClick={() => setActiveFolder(UNFILED)} /> : null}
          {filteredFolders.map(({ folder, depth }) => <FolderButton key={folder.id} label={folder.name} count={syllabi.filter((syllabus) => syllabus.folderId === folder.id).length} depth={depth} active={activeFolder === folder.id} onClick={() => setActiveFolder(folder.id)} hasChildren={folders.some((candidate) => candidate.parentId === folder.id)} onDelete={() => setFolderDeleteCandidate(folder)} />)}
          {folderQuery.trim() && filteredFolders.length === 0 ? <p className="px-3 py-2 text-sm text-[#667085]">No matching folders.</p> : null}
        </aside>

        <section className="relative rounded-lg border border-[#d9dee7] bg-white">
          {isLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[#667085]"><Loader2 size={18} className="animate-spin" /> Loading syllabi</div> : null}
          {!isLoading ? <div className="border-b border-[#e5e7eb] px-5 py-4"><label className="relative block"><Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" /><input type="search" aria-label={`Search syllabi in ${activeFolderLabel}`} value={syllabusQuery} onChange={(event) => setSyllabusQuery(event.target.value)} placeholder={`Search ${activeFolderLabel.toLocaleLowerCase()}`} className="w-full rounded-md border border-[#cbd5e1] py-2 pl-10 pr-3 text-sm text-[#344054] placeholder:text-[#98a2b3] focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]" /></label></div> : null}
          {!isLoading && filteredSyllabi.length === 0 ? <EmptyLibraryState hasSyllabi={syllabi.length > 0} hasSearch={Boolean(syllabusQuery.trim())} /> : null}
          {!isLoading && filteredSyllabi.length > 0 ? <div className="divide-y divide-[#e5e7eb]" role="list">{filteredSyllabi.map((syllabus) => <SyllabusRow key={syllabus.id} syllabus={syllabus} folders={folders} folderPath={syllabus.folderId ? folderPaths.get(syllabus.folderId) ?? [] : []} isMoving={movingId === syllabus.id} isDeleting={deletingId === syllabus.id} onOpen={onOpen} onMove={onMove} onRequestDelete={setDeleteCandidate} />)}</div> : null}
        </section>
      </div>

      {deleteCandidate ? <DeleteDialog syllabus={deleteCandidate} isDeleting={deletingId === deleteCandidate.id} onCancel={() => setDeleteCandidate(null)} onDelete={() => { onDelete(deleteCandidate.id); setDeleteCandidate(null); }} /> : null}
      {folderDeleteCandidate ? <DeleteFolderDialog folder={folderDeleteCandidate} isDeleting={deletingFolderId === folderDeleteCandidate.id} onCancel={() => setFolderDeleteCandidate(null)} onDelete={() => { onDeleteFolder(folderDeleteCandidate.id); setFolderDeleteCandidate(null); if (activeFolder === folderDeleteCandidate.id) setActiveFolder("all"); }} /> : null}
    </div>
  );
}

function FolderButton({ label, count, depth = 0, active, hasChildren = false, onClick, onDelete }: { label: string; count: number; depth?: number; active: boolean; hasChildren?: boolean; onClick: () => void; onDelete?: () => void }) {
  const canDelete = Boolean(onDelete) && count === 0 && !hasChildren;
  return <div style={depth ? { marginInlineStart: `${depth * 0.75}rem` } : undefined} className={`group flex items-center rounded-md ${active ? "bg-[#e8edf3]" : "hover:bg-[#f7f8fa]"}`}><button type="button" onClick={onClick} className={`min-w-0 flex-1 px-3 py-2 text-left text-sm transition ${active ? "font-semibold text-[#1f4e79]" : "text-[#475467]"}`}><span className="flex items-center justify-between"><span className="flex min-w-0 items-center gap-2"><Folder size={15} aria-hidden="true" className="shrink-0 text-[#667085]" /><span className="truncate">{label}</span></span><span aria-hidden="true" className="ml-2 text-xs tabular-nums text-[#667085]">{count}</span></span></button>{onDelete ? <button type="button" disabled={!canDelete} onClick={onDelete} aria-label={`Delete folder ${label}`} title={canDelete ? "Delete empty folder" : "Move all syllabi and subfolders before deleting this folder"} className="mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#b4232d] hover:bg-[#fff1f2] disabled:cursor-not-allowed disabled:text-[#98a2b3] disabled:hover:bg-transparent"><Trash2 size={15} aria-hidden="true" /></button> : null}</div>;
}

function SyllabusRow({ syllabus, folders, folderPath, isMoving, isDeleting, onOpen, onMove, onRequestDelete }: { syllabus: SyllabusSummary; folders: SyllabusFolder[]; folderPath: SyllabusFolder[]; isMoving: boolean; isDeleting: boolean; onOpen: (id: string) => void; onMove: (id: string, folderId: string | null) => void; onRequestDelete: (syllabus: SyllabusSummary) => void }) {
  return <div role="listitem" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center"><button type="button" onClick={() => onOpen(syllabus.id)} className="min-w-0 text-left"><span className="flex min-w-0 flex-wrap items-center gap-2"><span className="min-w-0 truncate font-semibold text-[#171717] hover:text-[#1f4e79]">{syllabus.courseTitle}</span>{folderPath.length ? <FolderPath path={folderPath} syllabusTitle={syllabus.courseTitle} /> : null}</span><span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#667085]"><Metadata icon={FileCode2} label={`Course code: ${syllabus.courseCode || "Not set"}`}>{syllabus.courseCode || "Course code not set"}</Metadata><Metadata icon={CalendarDays} label={`Academic year: ${syllabus.academicYear}`}>{syllabus.academicYear}</Metadata><Metadata icon={History} label={`Revision ${syllabus.revision}`}>Revision {syllabus.revision}</Metadata></span></button><FolderMoveMenu compact label={`Move ${syllabus.courseTitle} to folder`} value={syllabus.folderId} folders={folders} isMoving={isMoving} onChange={(folderId) => onMove(syllabus.id, folderId)} /><button type="button" disabled={isDeleting} onClick={() => onRequestDelete(syllabus)} aria-label={`Delete ${syllabus.courseTitle}`} title="Delete syllabus" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#b4232d] hover:bg-[#fff1f2] disabled:opacity-50"><Trash2 size={18} aria-hidden="true" /></button></div>;
}

function FolderPath({ path, syllabusTitle }: { path: SyllabusFolder[]; syllabusTitle: string }) {
  return <span aria-label={`Folder path for ${syllabusTitle}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-[#eef3f8] px-2 py-1 text-xs font-medium text-[#475467]"><Folder size={14} aria-hidden="true" className="shrink-0 text-[#667085]" />{path.map((folder, index) => <span key={folder.id} className="flex min-w-0 items-center gap-1">{index > 0 ? <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-[#98a2b3]" /> : null}<span className="truncate">{folder.name}</span></span>)}</span>;
}

function Metadata({ icon: Icon, label, children }: { icon: typeof CalendarDays; label: string; children: ReactNode }) {
  return <span aria-label={label} className="inline-flex items-center gap-1.5"><Icon size={15} aria-hidden="true" className="shrink-0 text-[#667085]" />{children}</span>;
}

function flattenFolders(folders: SyllabusFolder[]): Array<{ folder: SyllabusFolder; depth: number; path: SyllabusFolder[] }> {
  const childrenByParent = new Map<string | null, SyllabusFolder[]>();
  for (const folder of folders) {
    const parentId = folder.parentId && folders.some((candidate) => candidate.id === folder.parentId) ? folder.parentId : null;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), folder]);
  }
  for (const children of childrenByParent.values()) children.sort((left, right) => left.name.localeCompare(right.name));
  const flattened: Array<{ folder: SyllabusFolder; depth: number; path: SyllabusFolder[] }> = [];
  const visit = (parentId: string | null, depth: number, path: SyllabusFolder[], seen: Set<string>) => {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      if (seen.has(folder.id)) continue;
      const nextPath = [...path, folder];
      flattened.push({ folder, depth, path: nextPath });
      visit(folder.id, depth + 1, nextPath, new Set([...seen, folder.id]));
    }
  };
  visit(null, 0, [], new Set());
  return flattened;
}

function EmptyLibraryState({ hasSyllabi, hasSearch }: { hasSyllabi: boolean; hasSearch: boolean }) {
  return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><div className="rounded-md bg-[#e8edf3] p-3 text-[#1f4e79]"><FolderOpen size={28} /></div><h3 className="mt-4 text-lg font-semibold text-[#171717]">{hasSearch ? "No matching syllabi" : hasSyllabi ? "No syllabi in this folder" : "No syllabi yet"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[#667085]">{hasSearch ? "Try a different course title, code, or academic year." : hasSyllabi ? "Move a syllabus here from the library list." : "Create the first shared SCEN syllabus. Its full template will be available in the section workspace."}</p></div>;
}

function DeleteDialog({ syllabus, isDeleting, onCancel, onDelete }: { syllabus: SyllabusSummary; isDeleting: boolean; onCancel: () => void; onDelete: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/35 p-4"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-syllabus-title" className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><h3 id="delete-syllabus-title" className="text-lg font-semibold text-[#171717]">Delete syllabus?</h3><p className="mt-2 text-sm leading-6 text-[#667085]">“{syllabus.courseTitle}” and its saved edit history will be permanently removed. This cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} disabled={isDeleting} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button><button type="button" onClick={onDelete} disabled={isDeleting} className="rounded-md bg-[#b4232d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#912018] disabled:bg-[#d0a1a5]">{isDeleting ? "Deleting…" : "Delete syllabus"}</button></div></section></div>;
}

function DeleteFolderDialog({ folder, isDeleting, onCancel, onDelete }: { folder: SyllabusFolder; isDeleting: boolean; onCancel: () => void; onDelete: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/35 p-4"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-folder-title" className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><h3 id="delete-folder-title" className="text-lg font-semibold text-[#171717]">Delete folder?</h3><p className="mt-2 text-sm leading-6 text-[#667085]">“{folder.name}” is empty and will be permanently removed. Syllabi must be moved out of a folder before it can be deleted.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} disabled={isDeleting} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button><button type="button" onClick={onDelete} disabled={isDeleting} className="rounded-md bg-[#b4232d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#912018] disabled:bg-[#d0a1a5]">{isDeleting ? "Deleting…" : "Delete folder"}</button></div></section></div>;
}
