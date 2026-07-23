import { Copy, FilePlus2, FileText, FolderOpen, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { CreateSyllabusInput, SyllabusFolder, SyllabusSummary, SyllabusTemplate, syllabusTemplateDocumentUrl } from "@/services/syllabi";
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
  movingId: string | null;
  error?: string;
  onOpen: (id: string) => void;
  onCreate: (input: CreateSyllabusInput) => void;
  onCreateFolder: (name: string) => void;
  onMove: (syllabusId: string, folderId: string | null) => void;
  onDelete: (syllabusId: string) => void;
};

export function SyllabusLibrary({
  syllabi,
  folders,
  templates,
  isLoading,
  isCreating,
  isCreatingFolder,
  deletingId,
  movingId,
  error,
  onOpen,
  onCreate,
  onCreateFolder,
  onMove,
  onDelete,
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
  const [deleteCandidate, setDeleteCandidate] = useState<SyllabusSummary | null>(null);

  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id);
  }, [templateId, templates]);

  const visibleSyllabi = useMemo(
    () => syllabi.filter((syllabus) => activeFolder === "all" ? true : activeFolder === UNFILED ? syllabus.folderId === null : syllabus.folderId === activeFolder),
    [activeFolder, syllabi],
  );
  const selectedTemplate = templates.find((template) => template.id === templateId);

  function submitSyllabus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({ courseTitle: title.trim(), courseCode: code.trim(), academicYear: year.trim(), sourceSyllabusId: sourceId || undefined, templateId: templateId || undefined });
  }

  function submitFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    onCreateFolder(name);
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
          <label className="grid flex-1 gap-1 text-sm font-medium text-[#344054]">Folder name<input autoFocus required value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Bachelor in Public Affairs" className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>
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
          <FolderButton label="All syllabi" count={syllabi.length} active={activeFolder === "all"} onClick={() => setActiveFolder("all")} />
          <FolderButton label="Unfiled" count={syllabi.filter((syllabus) => syllabus.folderId === null).length} active={activeFolder === UNFILED} onClick={() => setActiveFolder(UNFILED)} />
          {folders.map((folder) => <FolderButton key={folder.id} label={folder.name} count={syllabi.filter((syllabus) => syllabus.folderId === folder.id).length} active={activeFolder === folder.id} onClick={() => setActiveFolder(folder.id)} />)}
        </aside>

        <section className="overflow-hidden rounded-lg border border-[#d9dee7] bg-white">
          {isLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[#667085]"><Loader2 size={18} className="animate-spin" /> Loading syllabi</div> : null}
          {!isLoading && visibleSyllabi.length === 0 ? <EmptyLibraryState hasSyllabi={syllabi.length > 0} /> : null}
          {!isLoading && visibleSyllabi.length > 0 ? <div className="divide-y divide-[#e5e7eb]" role="list">{visibleSyllabi.map((syllabus) => <SyllabusRow key={syllabus.id} syllabus={syllabus} folders={folders} isMoving={movingId === syllabus.id} isDeleting={deletingId === syllabus.id} onOpen={onOpen} onMove={onMove} onRequestDelete={setDeleteCandidate} />)}</div> : null}
        </section>
      </div>

      {deleteCandidate ? <DeleteDialog syllabus={deleteCandidate} isDeleting={deletingId === deleteCandidate.id} onCancel={() => setDeleteCandidate(null)} onDelete={() => { onDelete(deleteCandidate.id); setDeleteCandidate(null); }} /> : null}
    </div>
  );
}

function FolderButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${active ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"}`}><span className="truncate">{label}</span><span aria-hidden="true" className="ml-2 text-xs tabular-nums text-[#667085]">{count}</span></button>;
}

function SyllabusRow({ syllabus, folders, isMoving, isDeleting, onOpen, onMove, onRequestDelete }: { syllabus: SyllabusSummary; folders: SyllabusFolder[]; isMoving: boolean; isDeleting: boolean; onOpen: (id: string) => void; onMove: (id: string, folderId: string | null) => void; onRequestDelete: (syllabus: SyllabusSummary) => void }) {
  return <div role="listitem" className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_150px_190px_auto] lg:items-center"><button type="button" onClick={() => onOpen(syllabus.id)} className="min-w-0 text-left"><span className="block truncate font-semibold text-[#171717] hover:text-[#1f4e79]">{syllabus.courseTitle}</span><span className="mt-1 block text-sm text-[#667085]">{syllabus.courseCode || "Course code not set"} · Revision {syllabus.revision}</span></button><span className="text-sm font-medium text-[#344054]">{syllabus.academicYear}</span><FolderMoveMenu label={`Move ${syllabus.courseTitle} to folder`} value={syllabus.folderId} folders={folders} isMoving={isMoving} onChange={(folderId) => onMove(syllabus.id, folderId)} /><button type="button" disabled={isDeleting} onClick={() => onRequestDelete(syllabus)} aria-label={`Delete ${syllabus.courseTitle}`} title="Delete syllabus" className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[#b4232d] hover:bg-[#fff1f2] disabled:opacity-50"><Trash2 size={18} aria-hidden="true" /></button></div>;
}

function EmptyLibraryState({ hasSyllabi }: { hasSyllabi: boolean }) {
  return <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center"><div className="rounded-md bg-[#e8edf3] p-3 text-[#1f4e79]"><FolderOpen size={28} /></div><h3 className="mt-4 text-lg font-semibold text-[#171717]">{hasSyllabi ? "No syllabi in this folder" : "No syllabi yet"}</h3><p className="mt-2 max-w-sm text-sm leading-6 text-[#667085]">{hasSyllabi ? "Move a syllabus here from the library list." : "Create the first shared SCEN syllabus. Its full template will be available in the section workspace."}</p></div>;
}

function DeleteDialog({ syllabus, isDeleting, onCancel, onDelete }: { syllabus: SyllabusSummary; isDeleting: boolean; onCancel: () => void; onDelete: () => void }) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/35 p-4"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-syllabus-title" className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><h3 id="delete-syllabus-title" className="text-lg font-semibold text-[#171717]">Delete syllabus?</h3><p className="mt-2 text-sm leading-6 text-[#667085]">“{syllabus.courseTitle}” and its saved edit history will be permanently removed. This cannot be undone.</p><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={onCancel} disabled={isDeleting} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button><button type="button" onClick={onDelete} disabled={isDeleting} className="rounded-md bg-[#b4232d] px-4 py-2 text-sm font-semibold text-white hover:bg-[#912018] disabled:bg-[#d0a1a5]">{isDeleting ? "Deleting…" : "Delete syllabus"}</button></div></section></div>;
}
