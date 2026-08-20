import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, CircleUserRound, Download, FilePlus2, FileUp, Folder, FolderPlus, Pencil, RotateCcw, Search, Trash2, UserPlus } from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { AutoSaveStatus, type AutoSaveState } from "@/components/AutoSaveStatus";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CountryCodeCombobox, parsePhoneValue } from "@/components/CountryCodeCombobox";
import { DateField } from "@/components/DateField";
import { FolderMoveMenu } from "@/components/FolderMoveMenu";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { GoogleDocumentSignInButton, GoogleDocumentSyncButton } from "@/components/GoogleDocumentSignInButton";
import { LibraryRecordTimestamps } from "@/components/LibraryRecordTimestamps";
import { RequisitionCourseEditor } from "@/components/RequisitionCourseEditor";
import { SectionEditorShell } from "@/components/SectionEditorShell";
import { SelectMenu } from "@/components/SelectMenu";
import { saveFailureState } from "@/components/syllabusSaveState";
import { formatTeachingHours, lastIncompleteRequisitionStep, missingRequisitionFields, RequisitionContent, totalTeachingHours } from "@/services/requisitions";
import {
  Teacher,
  TeacherFolder,
  TeacherRequisition,
  TeacherRequisitionSummary,
  archiveTeacher,
  createTeacher,
  createTeacherFolder,
  createTeacherRequisition,
  deleteTeacherFolder,
  deleteTeacherRequisition,
  downloadTeacherRequisitionExport,
  downloadTeacherDocuments,
  getTeacher,
  getTeacherDocuments,
  getTeacherRequisition,
  importCourseCatalogue,
  listCourseCatalogue,
  listTeacherFolders,
  listTeacherDocumentIssues,
  listTeacherRequisitions,
  listTeachers,
  moveTeacherToFolder,
  restoreTeacher,
  syncTeacherDocuments,
  updateTeacher,
  updateTeacherRequisition,
} from "@/services/teachers";

const UNFILED = "unfiled";
const PROGRAMS = ["Foundation year in Sciences", "Bachelor in Mathematics, Specialization in Data Science for Artificial Intelligence", "Bachelor in Physics"];
const JOB_TITLES = ["Part Time Lecturer", "Researcher", "Research Assistant", "Teaching Assistant", "Research Support Assistant", "Administrative Role - PT"];
const EMPLOYEE_TYPES = [{ value: "FT", label: "Full Time Employee" }, { value: "PT", label: "Part Time Employee" }];
const CLASS_TYPES = ["TD", "TP", "CM", "Coach", "Not Applicable"];

export function TeacherDatabase() {
  const client = useQueryClient();
  const [screen, setScreen] = useState<{ view: "library" } | { view: "profile"; teacherId: string } | { view: "requisition"; teacherId: string; requisitionId: string }>({ view: "library" });
  const [documentCredential, setDocumentCredential] = useState("");
  const teachers = useQuery({ queryKey: ["teachers"], queryFn: () => listTeachers(true) });
  const folders = useQuery({ queryKey: ["teacher-folders"], queryFn: listTeacherFolders });
  const refreshLibrary = () => { client.invalidateQueries({ queryKey: ["teachers"] }); client.invalidateQueries({ queryKey: ["teacher-folders"] }); };
  const create = useMutation({ mutationFn: createTeacher, onSuccess: (teacher) => { refreshLibrary(); setScreen({ view: "profile", teacherId: teacher.id }); } });
  const createFolder = useMutation({ mutationFn: createTeacherFolder, onSuccess: refreshLibrary });
  const move = useMutation({ mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => moveTeacherToFolder(id, folderId), onSuccess: refreshLibrary });
  const removeFolder = useMutation({ mutationFn: deleteTeacherFolder, onSuccess: refreshLibrary });
  const [catalogueMessage, setCatalogueMessage] = useState("");
  const importCatalogue = useMutation({
    mutationFn: importCourseCatalogue,
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ["course-catalogue"] });
      setCatalogueMessage(`Imported ${result.imported} course${result.imported === 1 ? "" : "s"}; ${result.retained} unchanged and ${result.obsoleted} older entr${result.obsoleted === 1 ? "y" : "ies"} marked obsolete.`);
    },
    onError: (error) => setCatalogueMessage(error instanceof Error ? error.message : "The course list could not be imported."),
  });

  if (screen.view === "library") return <TeacherLibrary teachers={teachers.data ?? []} folders={folders.data ?? []} isLoading={teachers.isLoading || folders.isLoading} error={(teachers.error ?? folders.error ?? create.error ?? createFolder.error ?? move.error ?? removeFolder.error)?.message} creating={create.isPending} creatingFolder={createFolder.isPending} movingId={move.isPending ? move.variables.id : null} deletingFolderId={removeFolder.isPending ? removeFolder.variables : null} catalogueMessage={catalogueMessage} importingCatalogue={importCatalogue.isPending} catalogueImportFailed={importCatalogue.isError} documentCredential={documentCredential} onDocumentCredential={setDocumentCredential} onOpen={(teacherId) => setScreen({ view: "profile", teacherId })} onCreate={create.mutate} onCreateFolder={createFolder.mutate} onMove={(id, folderId) => move.mutate({ id, folderId })} onDeleteFolder={removeFolder.mutate} onImportCatalogue={importCatalogue.mutate} />;
  if (screen.view === "profile") return <TeacherProfile teacherId={screen.teacherId} documentCredential={documentCredential} onDocumentCredential={setDocumentCredential} onBack={() => setScreen({ view: "library" })} onOpenRequisition={(requisitionId) => setScreen({ view: "requisition", teacherId: screen.teacherId, requisitionId })} onChanged={refreshLibrary} />;
  return <TeacherRequisitionEditor requisitionId={screen.requisitionId} teacherId={screen.teacherId} onBack={() => setScreen({ view: "profile", teacherId: screen.teacherId })} />;
}

function TeacherLibrary({ teachers, folders, isLoading, error, creating, creatingFolder, movingId, deletingFolderId, catalogueMessage, importingCatalogue, catalogueImportFailed, documentCredential, onDocumentCredential, onOpen, onCreate, onCreateFolder, onMove, onDeleteFolder, onImportCatalogue }: { teachers: Teacher[]; folders: TeacherFolder[]; isLoading: boolean; error?: string; creating: boolean; creatingFolder: boolean; movingId: string | null; deletingFolderId: string | null; catalogueMessage: string; importingCatalogue: boolean; catalogueImportFailed: boolean; documentCredential: string; onDocumentCredential: (credential: string) => void; onOpen: (id: string) => void; onCreate: (teacher: Pick<Teacher, "fullName" | "email" | "phone" | "notes">) => void; onCreateFolder: (input: { name: string; parentId?: string | null }) => void; onMove: (id: string, folderId: string | null) => void; onDeleteFolder: (id: string) => void; onImportCatalogue: (file: File) => void }) {
  const [showTeacherForm, setShowTeacherForm] = useState(false); const [showFolderForm, setShowFolderForm] = useState(false); const [activeFolder, setActiveFolder] = useState("all"); const [showArchived, setShowArchived] = useState(false); const [query, setQuery] = useState(""); const [folderName, setFolderName] = useState(""); const [draft, setDraft] = useState({ fullName: "", email: "", phone: "", notes: "" }); const [pendingFolder, setPendingFolder] = useState<TeacherFolder | null>(null);
  const visible = teachers.filter((teacher) => Boolean(teacher.archivedAt) === showArchived).filter((teacher) => activeFolder === "all" ? true : activeFolder === UNFILED ? teacher.folderId === null : teacher.folderId === activeFolder).filter((teacher) => `${teacher.fullName} ${teacher.email}`.toLowerCase().includes(query.toLowerCase()));
  const selectedFolder = folders.find((folder) => folder.id === activeFolder); const activeTeachers = teachers.filter((teacher) => !teacher.archivedAt); const folderTree = flattenFolders(folders); const paths = new Map(folderTree.map(({ folder, path }) => [folder.id, path]));
  function submitTeacher(event: FormEvent) { event.preventDefault(); onCreate(draft); }
  function submitFolder(event: FormEvent) { event.preventDefault(); if (!folderName.trim()) return; onCreateFolder({ name: folderName.trim(), parentId: selectedFolder?.id ?? null }); setFolderName(""); setShowFolderForm(false); }
  return <div className="mx-auto max-w-7xl px-1 py-6 sm:px-1.5 lg:px-2"><div className="flex flex-col justify-between gap-4 border-b border-[#d9dee7] pb-5 sm:flex-row sm:items-end"><div><p className="text-sm font-medium text-[#a6292f]">SCEN workspace</p><h2 className="mt-1 text-2xl font-semibold text-[#171717]">Part-time Teacher Database</h2><p className="mt-1 text-sm text-[#667085]">Keep teacher profiles, contacts, notes, and recruitment requests in one place.</p></div><div className="flex flex-wrap gap-3"><label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-4 py-2.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"><FileUp size={17} /> {importingCatalogue ? "Importing…" : "Import course list"}<input aria-label="Import course list" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={importingCatalogue} className="sr-only" onChange={(event) => { const [file] = Array.from(event.target.files ?? []); if (file) onImportCatalogue(file); event.currentTarget.value = ""; }} /></label><button type="button" onClick={() => setShowFolderForm((value) => !value)} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-4 py-2.5 text-sm font-semibold text-[#1f4e79]"><FolderPlus size={17} /> New folder</button><button type="button" onClick={() => setShowTeacherForm((value) => !value)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white"><UserPlus size={17} /> New teacher</button></div></div><TeacherDocumentSyncPanel credential={documentCredential} onCredential={onDocumentCredential} />{error ? <p role="alert" className="mt-4 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">{error}</p> : null}{catalogueMessage ? <p role="status" className={`mt-4 rounded-md border px-3 py-2 text-sm ${catalogueImportFailed ? "border-[#efc9cb] bg-[#fff5f5] text-[#8f1f25]" : "border-[#c9dfcf] bg-[#f4fbf5] text-[#256237]"}`}>{catalogueMessage}</p> : null}
    {showTeacherForm ? <form onSubmit={submitTeacher} className="mt-5 grid items-start gap-4 rounded-lg border border-[#cbd5e1] bg-white p-5 md:grid-cols-2"><h3 className="md:col-span-2 text-base font-semibold">New part-time teacher</h3><InputField label="Full name" value={draft.fullName} required autoFocus onChange={(fullName) => setDraft({ ...draft, fullName })} /><InputField label="Email" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} /><PhoneField value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} /><label className="grid gap-1 text-sm font-medium text-[#344054]">Notes<AutoResizeTextarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} minRows={2} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label><div className="flex gap-3 md:col-span-2"><button disabled={creating} className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{creating ? "Creating…" : "Create teacher"}</button><button type="button" onClick={() => setShowTeacherForm(false)} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold">Cancel</button></div></form> : null}
    {showFolderForm ? <form onSubmit={submitFolder} className="mt-5 flex max-w-lg gap-3 rounded-lg border border-[#cbd5e1] bg-white p-4"><label className="grid flex-1 gap-1 text-sm font-medium">Folder name<input autoFocus required value={folderName} onChange={(event) => setFolderName(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label><button disabled={creatingFolder} className="self-end rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white">Create</button></form> : null}
    <div className="mt-6 grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]"><aside className="rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-fit"><p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase text-[#667085]">Teachers</p><button type="button" onClick={() => setShowArchived(false)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${!showArchived ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "hover:bg-[#f7f8fa]"}`}>Active ({activeTeachers.length})</button><button type="button" onClick={() => setShowArchived(true)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${showArchived ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "hover:bg-[#f7f8fa]"}`}>Archived ({teachers.length - activeTeachers.length})</button><p className="px-3 pb-2 pt-4 text-xs font-semibold uppercase text-[#667085]">Folders</p><button type="button" onClick={() => setActiveFolder("all")} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${activeFolder === "all" ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "hover:bg-[#f7f8fa]"}`}>All teachers</button>{activeTeachers.some((teacher) => teacher.folderId === null) ? <button type="button" onClick={() => setActiveFolder(UNFILED)} className={`block w-full rounded-md px-3 py-2 text-left text-sm ${activeFolder === UNFILED ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "hover:bg-[#f7f8fa]"}`}>Unfiled</button> : null}{folderTree.map(({ folder, depth }) => <div key={folder.id} style={{ marginInlineStart: `${depth * 0.75}rem` }} className="flex items-center"><button type="button" onClick={() => setActiveFolder(folder.id)} className={`min-w-0 flex-1 rounded-md px-3 py-2 text-left text-sm ${activeFolder === folder.id ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "hover:bg-[#f7f8fa]"}`}>{folder.name}</button><button type="button" disabled={deletingFolderId === folder.id} onClick={() => setPendingFolder(folder)} aria-label={`Delete folder ${folder.name}`} className="p-2 text-[#a6292f] disabled:opacity-50"><Trash2 size={15} /></button></div>)}</aside>
      <section className="rounded-lg border border-[#d9dee7] bg-white"><div className="border-b border-[#e5e7eb] p-4"><label className="relative block"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" /><input aria-label="Search teachers" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search teachers" className="w-full rounded-md border border-[#cbd5e1] py-2 pl-10 pr-3 text-sm" /></label></div>{isLoading ? <p className="p-8 text-center text-sm text-[#667085]">Loading teachers…</p> : visible.length ? <div role="list" className="divide-y divide-[#e5e7eb]">{visible.map((teacher) => <div key={teacher.id} role="listitem" className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><button type="button" onClick={() => onOpen(teacher.id)} className="min-w-0 text-left"><span className="flex min-w-0 items-center gap-3"><TeacherAvatar fullName={teacher.fullName} /><span className="min-w-0"><span className="block truncate font-semibold text-[#171717]">{teacher.fullName}</span><span className="mt-1 block text-sm text-[#667085]">{teacher.email || "No email"}{teacher.archivedAt ? " · Archived" : ""}</span>{teacher.folderId ? <span className="mt-2 inline-flex items-center gap-1 text-xs text-[#667085]"><Folder size={14} />{paths.get(teacher.folderId)?.map((folder) => folder.name).join(" › ")}</span> : null}</span></span></button><FolderMoveMenu compact label={`Move ${teacher.fullName} to folder`} value={teacher.folderId} folders={folders} isMoving={movingId === teacher.id} onChange={(folderId) => onMove(teacher.id, folderId)} /></div>)}</div> : <p className="p-12 text-center text-sm text-[#667085]">No {showArchived ? "archived" : "active"} teachers found.</p>}</section></div><ConfirmDialog open={Boolean(pendingFolder)} title="Delete folder?" description={`Delete the empty folder ${pendingFolder?.name ?? ""}? This cannot be undone.`} confirmLabel="Delete folder" onClose={() => setPendingFolder(null)} onConfirm={() => { if (pendingFolder) onDeleteFolder(pendingFolder.id); setPendingFolder(null); }} /></div>;
}

function TeacherProfile({ teacherId, documentCredential, onDocumentCredential, onBack, onOpenRequisition, onChanged }: { teacherId: string; documentCredential: string; onDocumentCredential: (credential: string) => void; onBack: () => void; onOpenRequisition: (id: string) => void; onChanged: () => void }) {
  const client = useQueryClient(); const teacher = useQuery({ queryKey: ["teacher", teacherId], queryFn: () => getTeacher(teacherId) }); const requisitions = useQuery({ queryKey: ["teacher-requisitions", teacherId], queryFn: () => listTeacherRequisitions(teacherId) }); const [showRequest, setShowRequest] = useState(false); const [label, setLabel] = useState(""); const [academicYear, setAcademicYear] = useState("2026-2027"); const [sourceId, setSourceId] = useState("");
  const refresh = () => { client.invalidateQueries({ queryKey: ["teacher", teacherId] }); client.invalidateQueries({ queryKey: ["teacher-requisitions", teacherId] }); onChanged(); };
  const save = useMutation({ mutationFn: (input: Pick<Teacher, "fullName" | "email" | "phone" | "notes">) => updateTeacher(teacherId, input), onSuccess: refresh }); const archive = useMutation({ mutationFn: () => archiveTeacher(teacherId), onSuccess: refresh }); const restore = useMutation({ mutationFn: () => restoreTeacher(teacherId), onSuccess: refresh }); const createRequest = useMutation({ mutationFn: () => createTeacherRequisition(teacherId, { label, academicYear, sourceRequisitionId: sourceId || undefined }), onSuccess: (requisition) => { refresh(); onOpenRequisition(requisition.id); } }); const removeRequest = useMutation({ mutationFn: deleteTeacherRequisition, onSuccess: refresh });
  const renameRequest = useMutation({ mutationFn: async ({ id, label: nextLabel }: { id: string; label: string }) => updateTeacherRequisition({ ...await getTeacherRequisition(id), label: nextLabel }), onSuccess: refresh });
  if (!teacher.data) return <p className="p-8 text-center text-sm text-[#667085]">Loading teacher…</p>;
  const profile = teacher.data;
  return <div className="mx-auto max-w-6xl px-1 py-6 sm:px-1.5 lg:px-2"><button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#1f4e79]"><ArrowLeft size={17} /> Back to teachers</button><div className="mt-4 flex flex-col justify-between gap-4 border-b border-[#d9dee7] pb-5 sm:flex-row sm:items-end"><div className="flex items-center gap-3"><TeacherAvatar fullName={profile.fullName} size="large" /><div><p className="text-sm font-medium text-[#a6292f]">Teacher profile</p><h2 className="mt-1 text-2xl font-semibold">{profile.fullName}</h2></div></div><div className="flex gap-3">{profile.archivedAt ? <button type="button" onClick={() => restore.mutate()} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"><RotateCcw size={16} /> Restore</button> : <button type="button" onClick={() => archive.mutate()} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#a6292f]"><Archive size={16} /> Archive</button>}</div></div><ProfileOverview teacher={profile} onSave={save.mutateAsync} saving={save.isPending} /><TeacherDocumentsCard teacherId={teacherId} credential={documentCredential} onCredential={onDocumentCredential} /><section className="mt-6 rounded-lg border border-[#d9dee7] bg-white p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-lg font-semibold">Requisitions</h3><p className="mt-1 text-sm text-[#667085]">Create labelled requests for this teacher without limiting the number per year.</p></div><button type="button" onClick={() => setShowRequest((value) => !value)} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white"><FilePlus2 size={16} /> New requisition</button></div>{showRequest ? <div className="mt-4 grid gap-3 rounded-md bg-[#f8fafc] p-4 md:grid-cols-3"><InputField label="Request label" value={label} required onChange={(nextLabel) => setLabel(nextLabel)} /><InputField label="Academic year" value={academicYear} required onChange={setAcademicYear} /><div className="grid gap-1 text-sm font-medium"><span>Starting point</span><SelectMenu label="Starting point" value={sourceId} onChange={setSourceId} placeholder="Blank requisition" options={[{ value: "", label: "Blank requisition" }, ...(requisitions.data ?? []).map((item) => ({ value: item.id, label: `${item.label} — ${item.academicYear}` }))]} /></div><button type="button" disabled={createRequest.isPending || !label.trim()} onClick={() => createRequest.mutate()} className="w-fit rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white">Create and edit</button></div> : null}<RequisitionHistory requisitions={requisitions.data ?? []} onOpen={onOpenRequisition} onDelete={removeRequest.mutate} deleting={removeRequest.isPending} onRename={(id, nextLabel) => renameRequest.mutateAsync({ id, label: nextLabel })} renaming={renameRequest.isPending} /></section></div>;
}

export function RequisitionHistory({ requisitions, onOpen, onDelete, deleting, onRename, renaming = false }: { requisitions: TeacherRequisitionSummary[]; onOpen: (id: string) => void; onDelete: (id: string) => void; deleting: boolean; onRename: (id: string, label: string) => Promise<unknown> | void; renaming?: boolean }) {
  const [query, setQuery] = useState(""); const [editingId, setEditingId] = useState<string | null>(null); const [titleDraft, setTitleDraft] = useState(""); const [pendingDeletion, setPendingDeletion] = useState<TeacherRequisitionSummary | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRequisitions = requisitions.filter((requisition) => `${requisition.label} ${requisition.academicYear}`.toLowerCase().includes(normalizedQuery));
  async function submitTitle(id: string) { const label = titleDraft.trim(); if (!label) return; await onRename(id, label); setEditingId(null); }

  return <div className="mt-4"><label className="relative block max-w-md"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" /><input aria-label="Search requisitions" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search requisitions" className="w-full rounded-md border border-[#cbd5e1] py-2 pl-10 pr-3 text-sm" /></label><div role="list" className="mt-4 grid gap-3">{visibleRequisitions.map((requisition) => <article key={requisition.id} role="listitem" className="relative flex flex-col gap-3 rounded-lg border border-[#d9dee7] bg-white p-4 transition-colors hover:border-[#b9d0e5] hover:bg-[#f8fafc] sm:flex-row sm:items-center"><button type="button" onClick={() => onOpen(requisition.id)} aria-label={`Open ${requisition.label}`} className="absolute inset-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1f4e79] focus:ring-offset-2"><span className="sr-only">Open {requisition.label}</span></button><div className="relative z-10 min-w-0 flex-1 pointer-events-none">{editingId === requisition.id ? <form onSubmit={(event) => { event.preventDefault(); void submitTitle(requisition.id); }} className="pointer-events-auto"><label className="sr-only" htmlFor={`requisition-title-${requisition.id}`}>Requisition title</label><div className="flex flex-wrap items-center gap-2"><input id={`requisition-title-${requisition.id}`} aria-label="Requisition title" required autoFocus value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => { void submitTitle(requisition.id); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { setTitleDraft(requisition.label); setEditingId(null); } }} className="min-w-0 flex-1 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold" />{renaming ? <span className="text-sm text-[#667085]">Saving…</span> : null}</div></form> : <><button type="button" onClick={() => { setEditingId(requisition.id); setTitleDraft(requisition.label); }} aria-description="Click to edit requisition title" className="pointer-events-auto block max-w-full truncate rounded-sm text-left font-semibold text-[#171717] hover:text-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]">{requisition.label}</button><span className="mt-1 block text-sm text-[#667085]">{requisition.academicYear}</span><LibraryRecordTimestamps createdAt={requisition.createdAt} updatedAt={requisition.updatedAt} /></>}</div><div className="relative z-10 flex items-center gap-2 pointer-events-auto"><button type="button" disabled={deleting} onClick={() => setPendingDeletion(requisition)} aria-label={`Delete ${requisition.label}`} className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50"><Trash2 size={17} /></button></div></article>)}</div>{!visibleRequisitions.length ? <p className="py-6 text-sm text-[#667085]">{requisitions.length ? "No requisitions match your search." : "No requisitions yet."}</p> : null}<ConfirmDialog open={Boolean(pendingDeletion)} title="Delete requisition?" description={`Delete ${pendingDeletion?.label ?? "this requisition"}? This cannot be undone.`} confirmLabel="Delete requisition" onClose={() => setPendingDeletion(null)} onConfirm={() => { if (pendingDeletion) onDelete(pendingDeletion.id); setPendingDeletion(null); }} /></div>;
}

export function TeacherAvatar({ fullName, size = "small" }: { fullName: string; size?: "small" | "large" }) {
  const dimensions = size === "large" ? "h-14 w-14" : "h-10 w-10"; const iconSize = size === "large" ? 34 : 24;
  return <span role="img" aria-label={`Profile photo placeholder for ${fullName}`} className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#e8edf3] text-[#1f4e79] ${dimensions}`}><CircleUserRound aria-hidden size={iconSize} strokeWidth={1.5} /></span>;
}

function TeacherDocumentSyncPanel({ credential, onCredential }: { credential: string; onCredential: (credential: string) => void }) {
  const issues = useQuery({ queryKey: ["teacher-document-issues", credential], queryFn: () => listTeacherDocumentIssues(credential), enabled: Boolean(credential) });
  const sync = useMutation({ mutationFn: (driveAccessToken: string) => syncTeacherDocuments(credential, driveAccessToken), onSuccess: () => issues.refetch() });
  return <section className="mt-5 rounded-lg border border-[#d9dee7] bg-white p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-base font-semibold">Google Form documents</h3><p className="mt-1 text-sm text-[#667085]">Copy the latest response for each matched teacher into their managed Google Drive folder.</p></div>{credential ? <GoogleDocumentSyncButton disabled={sync.isPending} onAccessToken={(driveAccessToken) => sync.mutate(driveAccessToken)} /> : <GoogleDocumentSignInButton onCredential={onCredential} />}</div>{sync.isSuccess ? <p role="status" className="mt-3 text-sm text-[#256237]">Synced {sync.data.updated}; {sync.data.skipped} unchanged; {sync.data.needsReview} need review.</p> : null}{sync.error || issues.error ? <p role="alert" className="mt-3 text-sm text-[#8f1f25]">{(sync.error ?? issues.error)?.message}</p> : null}{credential && issues.data?.length ? <p className="mt-3 text-sm text-[#8f1f25]">{issues.data.length} response{issues.data.length === 1 ? "" : "s"} need review.</p> : null}</section>;
}

function TeacherDocumentsCard({ teacherId, credential, onCredential }: { teacherId: string; credential: string; onCredential: (credential: string) => void }) {
  const documents = useQuery({ queryKey: ["teacher-documents", teacherId, credential], queryFn: () => getTeacherDocuments(teacherId, credential), enabled: Boolean(credential) });
  const download = useMutation({ mutationFn: () => downloadTeacherDocuments(teacherId, credential) });
  return <section className="mt-6 rounded-lg border border-[#d9dee7] bg-white p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h3 className="text-lg font-semibold">Documents</h3><p className="mt-1 text-sm text-[#667085]">Latest Google Form documents, stored in the managed Google Drive folder.</p></div>{credential ? null : <GoogleDocumentSignInButton onCredential={onCredential} />}</div>{credential && documents.isLoading ? <p className="mt-4 text-sm text-[#667085]">Loading documents…</p> : null}{credential && documents.error ? <p role="alert" className="mt-4 text-sm text-[#8f1f25]">{documents.error.message}</p> : null}{credential && documents.data ? <div className="mt-4 flex flex-wrap items-center gap-3"><a href={documents.data.driveFolderUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"><Folder size={16} /> Open Google Drive folder</a><button type="button" disabled={download.isPending} onClick={() => download.mutate()} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Download size={16} /> {download.isPending ? "Preparing ZIP…" : "Download ZIP"}</button>{download.error ? <p role="alert" className="text-sm text-[#8f1f25]">{download.error.message}</p> : null}</div> : null}{credential && documents.isSuccess && !documents.data ? <p className="mt-4 text-sm text-[#667085]">No Google Form response has been matched to this profile yet.</p> : null}</section>;
}

export function ProfileOverview({ teacher, onSave, saving = false }: { teacher: Teacher; onSave: (input: Pick<Teacher, "fullName" | "email" | "phone" | "notes">) => Promise<unknown>; saving?: boolean }) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState<Pick<Teacher, "fullName" | "email" | "phone" | "notes">>({ fullName: teacher.fullName, email: teacher.email, phone: teacher.phone, notes: teacher.notes });
  useEffect(() => { setDraft({ fullName: teacher.fullName, email: teacher.email, phone: teacher.phone, notes: teacher.notes }); }, [teacher]);
  async function submit(event: FormEvent) { event.preventDefault(); await onSave(draft); setEditing(false); }
  function cancel() { setDraft({ fullName: teacher.fullName, email: teacher.email, phone: teacher.phone, notes: teacher.notes }); setEditing(false); }
  return <section className="mt-6 rounded-lg border border-[#d9dee7] bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="text-lg font-semibold">Profile overview</h3>{editing ? null : <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"><Pencil size={16} /> Edit profile</button>}</div>{editing ? <form onSubmit={submit} className="mt-5 grid items-start gap-4 md:grid-cols-2"><InputField label="Full name" value={draft.fullName} required autoFocus onChange={(fullName) => setDraft({ ...draft, fullName })} /><InputField label="Email" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} /><PhoneField value={draft.phone} onChange={(phone) => setDraft({ ...draft, phone })} /><label className="grid gap-1 text-sm font-medium">Notes<AutoResizeTextarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} minRows={3} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label><div className="flex gap-3 md:col-span-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Pencil size={16} /> {saving ? "Saving…" : "Save profile"}</button><button type="button" disabled={saving} onClick={cancel} className="rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold">Cancel</button></div></form> : <dl className="mt-5 grid gap-5 md:grid-cols-2"><ProfileDetail label="Email" value={teacher.email} emptyLabel="No email provided" /><ProfileDetail label="Phone" value={teacher.phone} emptyLabel="No phone number provided" /><ProfileDetail label="Notes" value={teacher.notes} emptyLabel="No notes added" className="md:col-span-2" /></dl>}</section>;
}

function ProfileDetail({ label, value, emptyLabel, className = "" }: { label: string; value: string; emptyLabel: string; className?: string }) { return <div className={className}><dt className="text-sm font-medium text-[#667085]">{label}</dt><dd className={`mt-1 whitespace-pre-wrap text-sm ${value ? "text-[#171717]" : "text-[#667085]"}`}>{value || emptyLabel}</dd></div>; }

export function TeacherRequisitionEditor({ requisitionId, teacherId, onBack }: { requisitionId: string; teacherId: string; onBack: () => void }) {
  const requisition = useQuery({ queryKey: ["teacher-requisition", requisitionId], queryFn: () => getTeacherRequisition(requisitionId) });
  const teacher = useQuery({ queryKey: ["teacher", teacherId], queryFn: () => getTeacher(teacherId) });
  const catalogue = useQuery({ queryKey: ["course-catalogue"], queryFn: () => listCourseCatalogue() });
  const [draft, setDraft] = useState<TeacherRequisition | null>(null);
  const [active, setActive] = useState<"details" | "courses" | "review">("details");
  const [editingTitle, setEditingTitle] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<AutoSaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef<TeacherRequisition | null>(null);
  const dirtyRef = useRef(false);
  const saveInFlight = useRef(false);
  const saveConflict = useRef(false);
  const inFlightSave = useRef<Promise<TeacherRequisition | null> | null>(null);
  useEffect(() => {
    if (!requisition.data || draftRef.current?.id === requisition.data.id) return;
    draftRef.current = requisition.data;
    setDraft(requisition.data);
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setSaveError(null);
    saveConflict.current = false;
    setValidationMessage("");
  }, [requisition.data]);
  const exportDocx = useMutation({ mutationFn: downloadTeacherRequisitionExport });
  function edit(updater: (current: TeacherRequisition) => TeacherRequisition) {
    setDraft((current) => {
      if (!current) return current;
      const next = updater(current);
      draftRef.current = next;
      return next;
    });
    dirtyRef.current = true;
    setDirty(true);
    setValidationMessage("");
    if (saveState === "error") { setSaveState("saved"); setSaveError(null); }
  }
  async function persistCurrentDraft(): Promise<TeacherRequisition | null> {
    if (!dirtyRef.current) return draftRef.current;
    if (saveInFlight.current) return inFlightSave.current ?? draftRef.current;
    const snapshot = draftRef.current;
    if (!snapshot) return null;
    saveInFlight.current = true;
    setSaveState("saving");
    setSaveError(null);
    const request = (async () => {
      try {
        const saved = await updateTeacherRequisition(snapshot);
        if (draftRef.current === snapshot) {
          draftRef.current = saved;
          setDraft(saved);
          dirtyRef.current = false;
          setDirty(false);
        } else {
          setDraft((current) => {
            if (!current) return current;
            const rebased = { ...current, revision: saved.revision, updatedAt: saved.updatedAt };
            draftRef.current = rebased;
            return rebased;
          });
        }
        setSaveState("saved");
        saveConflict.current = false;
        return saved;
      } catch (error) {
        const failure = saveFailureState(error);
        saveConflict.current = failure === "conflict";
        setSaveState(failure);
        setSaveError(error instanceof Error ? error.message : "Save failed. Please try again.");
        return null;
      } finally {
        saveInFlight.current = false;
        inFlightSave.current = null;
      }
    })();
    inFlightSave.current = request;
    return request;
  }
  useEffect(() => {
    if (!dirty || saveConflict.current) return;
    const timer = window.setTimeout(() => { void persistCurrentDraft(); }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);
  useEffect(() => {
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = Array.from(document.querySelectorAll<HTMLElement>("[data-requisition-field]")).find((element) => element.dataset.requisitionField === focusTarget);
      const control = anchor?.querySelector<HTMLElement>("input, button, [tabindex]");
      anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
      control?.focus({ preventScroll: true });
      setFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, draft, focusTarget]);
  if (!draft) return <p className="p-8 text-center text-sm text-[#667085]">Loading requisition…</p>;
  const updateContent = (patch: Partial<RequisitionContent>) => edit((current) => ({ ...current, content: { ...current.content, ...patch } }));
  const total = totalTeachingHours(draft.content.courses);
  const teacherName = teacher.data?.fullName ?? "Loading teacher…";
  function validate() {
    if (!draft) return false;
    const missing = missingRequisitionFields(draft);
    if (!missing.length) return true;
    setValidationMessage(`Complete all required fields before saving or exporting: ${missing.join(", ")}.`);
    const lastStep = lastIncompleteRequisitionStep(draft);
    if (lastStep) {
      setActive(lastStep.section);
      if (lastStep.focusTarget === "requisition-title") setEditingTitle(true);
      setFocusTarget(lastStep.focusTarget);
    }
    return false;
  }
  async function exportCurrentDraft() {
    if (!validate()) return;
    const saved = await persistCurrentDraft();
    if (!saved) return;
    const latest = dirtyRef.current ? await persistCurrentDraft() : saved;
    if (latest) exportDocx.mutate(latest.id);
  }
  async function reloadLatest() {
    const result = await requisition.refetch();
    if (!result.data) return;
    draftRef.current = result.data;
    setDraft(result.data);
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setSaveError(null);
    saveConflict.current = false;
  }
  const titleControl = <InlineRequisitionTitle value={draft.label} editing={editingTitle} onEdit={() => setEditingTitle(true)} onChange={(label) => edit((current) => ({ ...current, label }))} onDone={() => setEditingTitle(false)} />;
  const teacherBadge = <div className="inline-flex items-center gap-2 rounded-md border border-[#b9d0e5] bg-[#f2f7fb] px-2.5 py-2 text-left"><TeacherAvatar fullName={teacherName} /><span><span className="block text-xs font-medium uppercase tracking-wide text-[#667085]">Teacher</span><span className="block text-sm font-semibold text-[#1f4e79]">{teacherName}</span></span></div>;
  return <SectionEditorShell backLabel="Back to teacher profile" onBack={onBack} eyebrow={draft.academicYear} title={draft.label || "Untitled requisition"} titleControl={titleControl} subtitle="Teaching-recruitment request" titleMeta={<div className="mt-3">{teacherBadge}</div>} sections={[{ id: "details", label: "1. Request details" }, { id: "courses", label: "2. Teaching load" }, { id: "review", label: "3. Review" }]} activeSection={active} onSectionChange={(section) => setActive(section as typeof active)} notice={validationMessage ? <p role="alert" className="rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">{validationMessage}</p> : undefined} actions={<><AutoSaveStatus state={saveState} error={saveError} resourceName="This requisition" onReload={() => { void reloadLatest(); }} /><button type="button" disabled={exportDocx.isPending} onClick={() => { void exportCurrentDraft(); }} className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79]"><Download size={16} /> Export DOCX</button></>}><section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5">{active === "details" ? <><div data-requisition-field="academic-year"><InputField label="Academic year" value={draft.academicYear} required onChange={(academicYear) => edit((current) => ({ ...current, academicYear }))} /></div><RequisitionDetails content={draft.content} onChange={updateContent} /></> : null}{active === "courses" ? <><p className="rounded-md bg-[#eaf1f8] px-3 py-2 text-sm font-semibold text-[#1f4e79]">Total: {formatTeachingHours(total)} hours</p><div className="mt-4"><RequisitionCourseEditor courses={draft.content.courses} onChange={(courses) => updateContent({ courses })} catalogueCourses={catalogue.data ?? []} /></div></> : null}{active === "review" ? <RequisitionReview teacherName={teacherName} requisition={draft} totalHours={total} /> : null}</section></SectionEditorShell>;
}

function InlineRequisitionTitle({ value, editing, onEdit, onChange, onDone }: { value: string; editing: boolean; onEdit: () => void; onChange: (value: string) => void; onDone: () => void }) {
  if (editing) return <div data-requisition-field="requisition-title" className="max-w-md"><label className="sr-only" htmlFor="requisition-title">Requisition title</label><input id="requisition-title" aria-label="Requisition title" required autoFocus value={value} onChange={(event) => onChange(event.target.value)} onBlur={onDone} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") onDone(); }} className="h-10 w-full rounded-md border border-[#1f4e79] bg-white px-3 text-xl font-semibold text-[#171717] outline-none ring-2 ring-[#d7e5f3]" /></div>;
  return <h2 title={value || "Untitled requisition"} className="truncate font-semibold text-[#171717] transition-[font-size] duration-200 text-xl"><button type="button" onClick={onEdit} aria-description="Click to edit requisition title" className="max-w-full truncate rounded-sm text-left hover:text-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]">{value || "Untitled requisition"}</button></h2>;
}

export function RequisitionDetails({ content, onChange }: { content: RequisitionContent; onChange: (patch: Partial<RequisitionContent>) => void }) { return <div className="mt-5 grid gap-4 md:grid-cols-2"><RequisitionFieldAnchor target="department"><InputField label="Hiring department" value={content.department} required onChange={(department) => onChange({ department })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="program"><SelectField label="Programme" value={content.program} options={PROGRAMS} required onChange={(program) => onChange({ program })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="job-title"><SelectField label="Job title" value={content.jobTitle} options={JOB_TITLES} required onChange={(jobTitle) => onChange({ jobTitle })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="employee-type"><SelectField label="Employee type" value={content.employeeType} options={EMPLOYEE_TYPES} required onChange={(employeeType) => onChange({ employeeType: employeeType as RequisitionContent["employeeType"] })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="class-type"><SelectField label="Type of class" value={content.classType} options={CLASS_TYPES} required onChange={(classType) => onChange({ classType })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="contract-from"><DateField label="Contract from" value={content.contractFrom} required onChange={(contractFrom) => onChange({ contractFrom })} /></RequisitionFieldAnchor><RequisitionFieldAnchor target="contract-to"><DateField label="Contract to" value={content.contractTo} required onChange={(contractTo) => onChange({ contractTo })} /></RequisitionFieldAnchor></div>; }

function RequisitionFieldAnchor({ target, children }: { target: string; children: ReactNode }) { return <div data-requisition-field={target}>{children}</div>; }

export function RequisitionReview({ teacherName, requisition, totalHours }: { teacherName: string; requisition: TeacherRequisition; totalHours: number }) {
  const missing = missingRequisitionFields(requisition);
  const courseCount = requisition.content.courses.length;
  return <div><div><h3 className="text-lg font-semibold">Review</h3><p className="mt-1 text-sm text-[#667085]">Confirm the request details below before exporting the institutional form.</p></div><dl className="mt-5 grid gap-4 sm:grid-cols-2"><ReviewDetail label="Teacher" value={teacherName} /><ReviewDetail label="Requisition" value={requisition.label || "Not set"} /><ReviewDetail label="Academic year" value={requisition.academicYear || "Not set"} /><ReviewDetail label="Hiring department" value={requisition.content.department || "Not set"} /><ReviewDetail label="Programme" value={requisition.content.program || "Not set"} /><ReviewDetail label="Job title" value={requisition.content.jobTitle || "Not set"} /><ReviewDetail label="Employee type" value={requisition.content.employeeType === "FT" ? "Full Time Employee" : "Part Time Employee"} /><ReviewDetail label="Type of class" value={requisition.content.classType || "Not set"} /><ReviewDetail label="Contract period" value={requisition.content.contractFrom && requisition.content.contractTo ? `${requisition.content.contractFrom} to ${requisition.content.contractTo}` : "Not set"} /><ReviewDetail label="Teaching load" value={`${courseCount} ${courseCount === 1 ? "course" : "courses"} · ${formatTeachingHours(totalHours)} hours`} /></dl>{missing.length ? <div role="alert" className="mt-5 rounded-md border border-[#efc9cb] bg-[#fff5f5] p-4 text-sm text-[#8f1f25]"><p className="font-semibold">{missing.length} required {missing.length === 1 ? "field remains" : "fields remain"} before export.</p><ul className="mt-2 list-disc space-y-1 pl-5">{missing.map((field) => <li key={field}>{field}</li>)}</ul></div> : <p role="status" className="mt-5 rounded-md border border-[#c9dfcf] bg-[#f4fbf5] px-3 py-2 text-sm font-medium text-[#256237]">Ready to export.</p>}</div>;
}

function ReviewDetail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#1f4e79]">{label}</dt><dd className="mt-1 text-sm text-[#171717]">{value}</dd></div>; }
export function PhoneField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const parsed = parsePhoneValue(value);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);

  useEffect(() => {
    if (value) setCountryCode(parsed.countryCode);
  }, [parsed.countryCode, value]);

  function updateNumber(number: string, code = countryCode) {
    onChange(number.trim() ? `${code} ${number}` : "");
  }

  return <label className="grid self-start gap-1 text-sm font-medium text-[#344054]"><span>Phone</span><span className="flex gap-2"><CountryCodeCombobox value={countryCode} onChange={(code) => { setCountryCode(code); if (parsed.localNumber.trim()) updateNumber(parsed.localNumber, code); }} /><input aria-label="Phone number" type="tel" inputMode="tel" autoComplete="tel-national" value={parsed.localNumber} onChange={(event) => updateNumber(event.target.value)} placeholder="555 123 4567" className="h-10 min-w-0 flex-1 rounded-md border border-[#b7bec8] px-3 text-sm font-normal" /></span></label>;
}
function InputField({ label, value, onChange, required = false, autoFocus = false, type = "text" }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; autoFocus?: boolean; type?: string }) { return <label className="grid gap-1 text-sm font-medium text-[#344054]"><FormFieldLabel required={required}>{label}</FormFieldLabel><input required={required} autoFocus={autoFocus} type={type} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" /></label>; }
function SelectField({ label, value, options, onChange, required = false }: { label: string; value: string; options: Array<string | { value: string; label: string }>; onChange: (value: string) => void; required?: boolean }) { return <div className="grid gap-1 text-sm font-medium"><FormFieldLabel required={required}>{label}</FormFieldLabel><SelectMenu label={label} value={value} onChange={onChange} required={required} placeholder={`Select ${label.toLowerCase()}`} options={options.map((option) => typeof option === "string" ? { value: option, label: option } : option)} /></div>; }
function flattenFolders(folders: TeacherFolder[]): Array<{ folder: TeacherFolder; depth: number; path: TeacherFolder[] }> { const byParent = new Map<string | null, TeacherFolder[]>(); for (const folder of folders) { const parent = folder.parentId && folders.some((candidate) => candidate.id === folder.parentId) ? folder.parentId : null; byParent.set(parent, [...(byParent.get(parent) ?? []), folder]); } for (const children of byParent.values()) children.sort((a, b) => a.name.localeCompare(b.name)); const output: Array<{ folder: TeacherFolder; depth: number; path: TeacherFolder[] }> = []; const visit = (parent: string | null, depth: number, path: TeacherFolder[]) => { for (const folder of byParent.get(parent) ?? []) { const next = [...path, folder]; output.push({ folder, depth, path: next }); visit(folder.id, depth + 1, next); } }; visit(null, 0, []); return output; }
