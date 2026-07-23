import { Copy, FilePlus2, FolderOpen, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";

import { CreateSyllabusInput, SyllabusSummary } from "@/services/syllabi";
import { SelectMenu } from "@/components/SelectMenu";

type Props = {
  syllabi: SyllabusSummary[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onCreate: (input: CreateSyllabusInput) => void;
  isCreating: boolean;
};

export function SyllabusLibrary({ syllabi, isLoading, onOpen, onCreate, isCreating }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [year, setYear] = useState("2026-2027");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreate({ courseTitle: title.trim(), courseCode: code.trim(), academicYear: year.trim(), sourceSyllabusId: sourceId || undefined });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-4 border-b border-[#d9dee7] pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-[#a6292f]">SCEN workspace</p>
          <h2 className="mt-1 text-2xl font-semibold text-[#171717]">Syllabus library</h2>
          <p className="mt-1 text-sm text-[#667085]">Create, revisit, and compare course syllabi across academic years.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((value) => !value)}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#183f63]"
        >
          <FilePlus2 size={17} aria-hidden="true" /> New syllabus
        </button>
      </div>

      {showForm ? (
        <form onSubmit={submit} className="mt-6 grid gap-4 rounded-lg border border-[#cbd5e1] bg-white p-5 md:grid-cols-2">
          <div className="md:col-span-2">
            <h3 className="text-base font-semibold text-[#171717]">Start a syllabus</h3>
            <p className="mt-1 text-sm text-[#667085]">Start blank or carry an existing syllabus into a new academic year.</p>
          </div>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            Course title
            <input required value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            Academic year
            <input required value={year} onChange={(event) => setYear(event.target.value)} placeholder="2026-2027" className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            Course code <span className="font-normal text-[#667085]">(optional)</span>
            <input value={code} onChange={(event) => setCode(event.target.value)} className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-[#344054]">
            Starting point
            <SelectMenu label="Starting point" value={sourceId} onChange={setSourceId} placeholder="Blank syllabus" options={[{ value: "", label: "Blank syllabus" }, ...syllabi.map((syllabus) => ({ value: syllabus.id, label: `${syllabus.courseTitle} — ${syllabus.academicYear}` }))]} />
          </label>
          <div className="flex gap-3 md:col-span-2">
            <button disabled={isCreating} className="inline-flex items-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]">
              {isCreating ? <Loader2 className="animate-spin" size={16} /> : sourceId ? <Copy size={16} /> : <FilePlus2 size={16} />}
              {sourceId ? "Duplicate and edit" : "Create blank syllabus"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="rounded-md border border-[#b7bec8] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button>
          </div>
        </form>
      ) : null}

      <section className="mt-6 overflow-hidden rounded-lg border border-[#d9dee7] bg-white">
        {isLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-[#667085]"><Loader2 size={18} className="animate-spin" /> Loading syllabi</div> : null}
        {!isLoading && syllabi.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
            <div className="rounded-md bg-[#e8edf3] p-3 text-[#1f4e79]"><FolderOpen size={28} /></div>
            <h3 className="mt-4 text-lg font-semibold text-[#171717]">No syllabi yet</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[#667085]">Create the first shared SCEN syllabus. Its full template will be available in the section workspace.</p>
          </div>
        ) : null}
        {!isLoading && syllabi.length > 0 ? (
          <div className="divide-y divide-[#e5e7eb]" role="list">
            {syllabi.map((syllabus) => (
              <button key={syllabus.id} type="button" onClick={() => onOpen(syllabus.id)} className="grid w-full gap-2 px-5 py-4 text-left hover:bg-[#f8fafc] sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-6" role="listitem">
                <span><span className="block font-semibold text-[#171717]">{syllabus.courseTitle}</span><span className="mt-1 block text-sm text-[#667085]">{syllabus.courseCode || "Course code not set"}</span></span>
                <span className="text-sm font-medium text-[#344054]">{syllabus.academicYear}</span>
                <span className="text-sm text-[#667085]">Revision {syllabus.revision}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
