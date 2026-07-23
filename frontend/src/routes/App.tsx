import { useMutation } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, Download, FileText, Loader2, RotateCcw, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { CourseSummary } from "@/components/CourseSummary";
import { FileDropzone } from "@/components/FileDropzone";
import { RosterTable } from "@/components/RosterTable";
import { SyllabusBuilder } from "@/components/SyllabusBuilder";
import { ToolId, toolFromLocation } from "@/routes/toolRoute";
import {
  BatchRosterPreview,
  BatchRosterPreviewItem,
  downloadRosterWorkbook,
  downloadRosterWorkbooks,
  exportRosterWorkbooks,
  LocalExportResult,
  previewRosterBatch,
} from "@/services/rosters";

export function App() {
  const [activeTool, setActiveTool] = useState<ToolId | null>(() => toolFromLocation(window.location.pathname, window.location.hash));
  const [appSearch, setAppSearch] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<BatchRosterPreview | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [exportResult, setExportResult] = useState<LocalExportResult | null>(null);

  const previewMutation = useMutation({
    mutationFn: previewRosterBatch,
    onSuccess: (result) => {
      setBatch(result);
      const firstSuccess = result.files.findIndex((item) => item.ok);
      setActiveIndex(firstSuccess >= 0 ? firstSuccess : 0);
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (selectedFiles: File[]) => {
      if (selectedFiles.length === 1) {
        await downloadRosterWorkbook(selectedFiles[0]);
        return;
      }
      await downloadRosterWorkbooks(selectedFiles);
    },
  });
  const exportMutation = useMutation({
    mutationFn: exportRosterWorkbooks,
    onSuccess: setExportResult,
  });

  function handleFiles(nextFiles: File[]) {
    setFiles(nextFiles);
    setBatch(null);
    setActiveIndex(0);
    setExportResult(null);
    previewMutation.mutate(nextFiles);
  }

  function reset() {
    setFiles([]);
    setBatch(null);
    setActiveIndex(0);
    setExportResult(null);
    previewMutation.reset();
    downloadMutation.reset();
    exportMutation.reset();
  }

  const busy = previewMutation.isPending || downloadMutation.isPending || exportMutation.isPending;
  const error = previewMutation.error?.message ?? downloadMutation.error?.message ?? exportMutation.error?.message;
  const activeItem = batch?.files[activeIndex] ?? null;
  const activePreview = activeItem?.ok ? activeItem.preview ?? null : null;
  const successCount = batch?.successCount ?? 0;
  const downloadLabel = files.length > 1 ? "Download ZIP" : "Download Excel";

  useEffect(() => {
    const handleLocationChange = () => setActiveTool(toolFromLocation(window.location.pathname, window.location.hash));
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("hashchange", handleLocationChange);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("hashchange", handleLocationChange);
    };
  }, []);

  function openTool(tool: ToolId) {
    window.location.hash = `/${tool}`;
  }

  function openApp(app: ToolId | "handbook") {
    if (app === "handbook") {
      window.location.assign("/handbook/");
      return;
    }
    openTool(app);
  }

  function showAllApps() {
    window.history.pushState({}, "", "/");
    setActiveTool(null);
  }

  return (
    <main className="min-h-screen bg-[#f7f8fa]">
      <header className="border-b border-[#d9dee7] bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#a6292f]">Sorbonne University Abu Dhabi</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal text-[#171717]">Academic Coordinator Tools</h1>
          </div>
          {activeTool ? (
            <button
              type="button"
              onClick={showAllApps}
              className="inline-flex items-center gap-2 rounded-md border border-[#d9dee7] bg-white px-3 py-2 text-sm font-semibold text-[#1f4e79] shadow-sm hover:bg-[#f2f7fb]"
            >
              <span aria-hidden="true">←</span> All apps
            </button>
          ) : null}
        </div>
      </header>

      {activeTool === null ? (
        <AppWelcome search={appSearch} onSearch={setAppSearch} onOpen={openApp} />
      ) : activeTool === "roster" ? <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[360px_1fr] lg:px-8">
        <aside className="space-y-4">
          <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#171717]">Roster Converter</h2>
              <button
                type="button"
                onClick={reset}
                disabled={busy && files.length === 0}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d9dee7] text-[#424956] hover:bg-[#f2f4f7] disabled:opacity-40"
                title="Reset"
                aria-label="Reset"
              >
                <RotateCcw size={16} aria-hidden="true" />
              </button>
            </div>

            <FileDropzone files={files} onFiles={handleFiles} disabled={busy} />

            <button
              type="button"
              disabled={files.length === 0 || successCount === 0 || busy}
              onClick={() => downloadMutation.mutate(files)}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#1f4e79] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#183f63] disabled:bg-[#9ba8b5]"
            >
              {downloadMutation.isPending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
              {downloadLabel}
            </button>
            <button
              type="button"
              disabled={files.length === 0 || successCount === 0 || busy}
              onClick={() => exportMutation.mutate(files)}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#b7bec8] bg-white px-4 py-2.5 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:text-[#9ba8b5]"
            >
              {exportMutation.isPending ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
              Save Locally
            </button>
          </section>

          <StatusPanel
            busy={busy}
            error={error}
            batch={batch}
            fileCount={files.length}
            isPreviewing={previewMutation.isPending}
            isDownloading={downloadMutation.isPending}
            isExporting={exportMutation.isPending}
            exportResult={exportResult}
          />

          {batch ? (
            <FileQueue
              items={batch.files}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
            />
          ) : null}
        </aside>

        <section className="min-w-0 space-y-5">
          {activePreview ? (
            <>
              <CourseSummary courseInfo={activePreview.courseInfo} rowCount={activePreview.rowCount} pageCount={activePreview.pageCount} />
              <RosterTable rows={activePreview.rows} />
            </>
          ) : activeItem && !activeItem.ok ? (
            <ErrorState item={activeItem} />
          ) : (
            <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-[#d9dee7] bg-white px-6 text-center">
              <div className="max-w-sm">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-[#e8edf3] text-[#1f4e79]">
                  <FileText size={24} aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold text-[#171717]">No roster loaded</h2>
                <p className="mt-2 text-sm leading-6 text-[#667085]">Select one or more generated Course Class Roster PDFs to preview extracted tables.</p>
              </div>
            </div>
          )}
        </section>
      </div> : <SyllabusBuilder />}
    </main>
  );
}

function AppWelcome({
  search,
  onSearch,
  onOpen,
}: {
  search: string;
  onSearch: (value: string) => void;
  onOpen: (app: ToolId | "handbook") => void;
}) {
  const apps: Array<{ id: ToolId | "handbook"; name: string; description: string; icon: typeof FileText; keywords: string }> = [
    {
      id: "roster",
      name: "Course roster",
      description: "Upload generated roster PDFs, review extracted student data, and download Excel workbooks.",
      icon: FileText,
      keywords: "roster pdf excel students attendance",
    },
    {
      id: "syllabus",
      name: "Syllabus builder",
      description: "Create, revise, compare, and maintain SCEN course syllabi across academic years.",
      icon: BookOpen,
      keywords: "syllabus course template academic year comparison",
    },
    {
      id: "handbook",
      name: "Coordinator handbook",
      description: "Browse SCEN procedures, onboarding guidance, reference material, and the annual academic cycle.",
      icon: BookOpen,
      keywords: "handbook documentation procedures onboarding grades transcripts",
    },
  ];
  const normalizedSearch = search.trim().toLowerCase();
  const visibleApps = apps.filter((app) => `${app.name} ${app.description} ${app.keywords}`.toLowerCase().includes(normalizedSearch));

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold text-[#a6292f]">Workspace</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[#171717]">Choose an app</h2>
        <p className="mt-3 text-base leading-7 text-[#667085]">Tools for preparing, checking, and maintaining SCEN academic records.</p>
      </div>

      <label className="relative mt-7 block max-w-xl">
        <span className="sr-only">Search apps</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[#667085]" size={19} aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search apps"
          className="w-full rounded-lg border border-[#c8d0db] bg-white py-3 pl-11 pr-4 text-sm text-[#1f2937] shadow-sm outline-none placeholder:text-[#7d8796] focus:border-[#1f4e79] focus:ring-3 focus:ring-[#dceaf6]"
        />
      </label>

      <div className="mt-7 grid gap-5 md:grid-cols-2">
        {visibleApps.map((app) => {
          const Icon = app.icon;
          return (
            <button
              type="button"
              key={app.id}
              onClick={() => onOpen(app.id)}
              className="group flex min-h-56 flex-col rounded-xl border border-[#d9dee7] bg-white p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9fb5ca] hover:shadow-md focus:outline-none focus:ring-3 focus:ring-[#dceaf6]"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#eaf1f8] text-[#1f4e79]">
                <Icon size={22} aria-hidden="true" />
              </span>
              <span className="mt-5 text-lg font-semibold text-[#171717]">{app.name}</span>
              <span className="mt-2 text-sm leading-6 text-[#667085]">{app.description}</span>
              <span className="mt-auto inline-flex items-center gap-2 pt-6 text-sm font-semibold text-[#1f4e79]">Open app <ArrowRight size={16} aria-hidden="true" /></span>
            </button>
          );
        })}
      </div>

      {visibleApps.length === 0 ? (
        <div className="mt-7 rounded-lg border border-dashed border-[#c8d0db] bg-white px-6 py-10 text-center text-sm text-[#667085]">No apps match “{search}”.</div>
      ) : null}
    </section>
  );
}

function StatusPanel({
  busy,
  error,
  batch,
  fileCount,
  isPreviewing,
  isDownloading,
  isExporting,
  exportResult,
}: {
  busy: boolean;
  error?: string;
  batch: BatchRosterPreview | null;
  fileCount: number;
  isPreviewing: boolean;
  isDownloading: boolean;
  isExporting: boolean;
  exportResult: LocalExportResult | null;
}) {
  const statusText = isPreviewing
    ? "Reading PDF"
    : isDownloading
      ? "Creating workbook"
      : isExporting
        ? "Saving files"
        : batch
          ? "Ready"
          : fileCount > 0
            ? "Waiting"
            : "Idle";
  const fileText = fileCount === 0 ? "No files selected" : fileCount === 1 ? "1 file selected" : `${fileCount} files selected`;

  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#eef1f5] text-[#424956]">
          {busy ? (
            <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          ) : error ? (
            <AlertCircle size={18} className="text-[#a6292f]" aria-hidden="true" />
          ) : batch && batch.failureCount === 0 ? (
            <CheckCircle2 size={18} className="text-[#24805a]" aria-hidden="true" />
          ) : batch ? (
            <AlertCircle size={18} className="text-[#b7791f]" aria-hidden="true" />
          ) : (
            <FileText size={18} aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#171717]">{statusText}</div>
          <div className="truncate text-xs text-[#667085]">{fileText}</div>
        </div>
      </div>
      {error ? (
        <div className="mt-4 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]">{error}</div>
      ) : null}
      {exportResult ? (
        <div className="mt-4 rounded-md border border-[#c8e4d5] bg-[#f3fbf6] px-3 py-2 text-sm text-[#1f6f4a]">
          Saved to <span className="break-all font-medium">{exportResult.path}</span>
        </div>
      ) : null}
      {batch ? (
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Metric label="Converted" value={batch.successCount} />
          <Metric label="Needs review" value={batch.failureCount} />
        </div>
      ) : null}
    </section>
  );
}

function FileQueue({
  items,
  activeIndex,
  onSelect,
}: {
  items: BatchRosterPreviewItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <section className="rounded-lg border border-[#d9dee7] bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-[#171717]">Uploaded Files</h2>
      <div className="space-y-2">
        {items.map((item, index) => (
          <button
            type="button"
            key={`${item.filename}-${index}`}
            onClick={() => onSelect(index)}
            className={[
              "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition",
              activeIndex === index ? "border-[#1f4e79] bg-[#eef5fb]" : "border-[#edf0f4] bg-white hover:bg-[#f7f8fa]",
            ].join(" ")}
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-[#eef1f5]">
              {item.ok ? (
                <CheckCircle2 size={15} className="text-[#24805a]" aria-hidden="true" />
              ) : (
                <AlertCircle size={15} className="text-[#a6292f]" aria-hidden="true" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#171717]">{item.filename}</span>
              <span className="mt-0.5 block text-xs text-[#667085]">
                {item.ok ? `${item.preview?.rowCount ?? 0} rows` : "Could not parse"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ErrorState({ item }: { item: BatchRosterPreviewItem }) {
  return (
    <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-[#efc9cb] bg-white px-6 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-[#fff5f5] text-[#a6292f]">
          <AlertCircle size={24} aria-hidden="true" />
        </div>
        <h2 className="break-words text-lg font-semibold text-[#171717]">{item.filename}</h2>
        <p className="mt-2 text-sm leading-6 text-[#8f1f25]">{item.error ?? "This file could not be converted."}</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[#edf0f4] px-3 py-2">
      <div className="text-xs uppercase tracking-normal text-[#667085]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#171717]">{value}</div>
    </div>
  );
}
