import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  CircleUserRound,
  Download,
  FilePlus2,
  Folder,
  FolderPlus,
  Pencil,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { FormEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  AutoSaveStatus,
  type AutoSaveState,
} from "@/components/AutoSaveStatus";
import { AutoResizeTextarea } from "@/components/AutoResizeTextarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScreenLoading } from "@/components/ScreenLoading";
import {
  CountryCodeCombobox,
  parsePhoneValue,
} from "@/components/CountryCodeCombobox";
import { DateField } from "@/components/DateField";
import { InfoTip } from "@/components/InfoTip";
import { FolderMoveMenu } from "@/components/FolderMoveMenu";
import { FormFieldLabel } from "@/components/FormFieldLabel";
import { FieldInfoProvider } from "@/components/FieldInfo";
import {
  GoogleDocumentSyncButton,
  documentsConfigured,
} from "@/components/GoogleDocumentSyncButton";
import { Modal } from "@/components/Modal";
import { RequisitionCourseEditor } from "@/components/RequisitionCourseEditor";
import { TeacherBulkActions } from "@/components/TeacherBulkActions";
import { TableFilterBar } from "@/components/TableFilterBar";
import {
  NewRequisitionDialog,
  TeacherHoursFigures,
  TeacherPaperwork,
  TeacherRowActions,
} from "@/components/TeacherRowDetail";
import { TeacherProfileTimetable } from "@/components/TeacherProfileTimetable";
import { TimeSheetsCard } from "@/components/TeacherTimeSheets";
import { SelectMenu, type SelectOption } from "@/components/SelectMenu";
import { TaskPanel } from "@/components/TaskPanel";
import { TasksOverview } from "@/components/TasksOverview";
import {
  TaskProgressBadge,
} from "@/components/TaskVisuals";
import { taskUrgency } from "@/components/taskPresentation";
import { saveFailureState } from "@/components/syllabusSaveState";
import { usePageState } from "@/components/usePageState";
import { fetchActiveTeachers } from "@/services/portalLists";
import { optionsFor } from "@/services/studentColumns";
import { applyFilters, type FilterModel } from "@/services/tableFilter";
import { TEACHER_COLUMNS, type TeacherFilterRow } from "@/services/teacherFilters";
import {
  formatTeachingHours,
  lastIncompleteRequisitionStep,
  missingRequisitionFields,
  RequisitionContent,
  totalAdminHours,
  totalTeachingHours,
} from "@/services/requisitions";
import {
  type RequisitionInput,
  Teacher,
  TeacherFolder,
  type TeacherInput,
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
  listCourseCatalogue,
  listTeacherFolders,
  listTeacherDocumentIssues,
  fetchTeacherSummary,
  listTeacherRequisitions,
  listTeachers,
  moveTeacherToFolder,
  restoreTeacher,
  syncTeacherDocuments,
  updateTeacher,
  updateTeacherRequisition,
} from "@/services/teachers";
import {
  ScopedTask,
  TaskTemplate,
  listTaskTemplates,
  listTasks,
} from "@/services/workflow";

const UNFILED = "unfiled";
const ALL_FOLDERS = "all";
const PROGRAMS = [
  "Foundation year in Sciences",
  "Bachelor in Mathematics, Specialization in Data Science for Artificial Intelligence",
  "Bachelor in Physics",
];
const JOB_TITLES = [
  "Part Time Lecturer",
  "Researcher",
  "Research Assistant",
  "Teaching Assistant",
  "Research Support Assistant",
  "Administrative Role - PT",
];
const EMPLOYEE_TYPES = [
  { value: "FT", label: "Full Time Employee" },
  { value: "PT", label: "Part Time Employee" },
];
const CLASS_TYPES = ["TD", "TP", "CM", "Coach", "Not Applicable"];

/** The buttons along the tops of these screens, all one height so a row of them lines up. */
const PRIMARY_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#1f4e79] px-4 text-sm font-semibold text-white hover:bg-[#1a4368] disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50";
const DANGER_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-[#b7bec8] bg-white px-3 text-sm font-semibold text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50";
const BACK_BUTTON =
  "shrink-0 rounded-md p-2 text-[#344054] hover:bg-[#e8edf3] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";

type Screen =
  | { view: "library" }
  | { view: "profile"; teacherId: string }
  | { view: "requisition"; teacherId: string; requisitionId: string };

/**
 * The Part-time Teachers page: the list, one teacher's profile, and one requisition.
 *
 * Each screen fills the height the page is given and scrolls inside its own panes, so a
 * top bar, a header or a steps rail stays where it is while the long part moves.
 */
export function TeacherDatabase({ header }: { header?: HTMLElement | null } = {}) {
  const client = useQueryClient();
  const [screen, setScreen] = useState<Screen>({ view: "library" });
  // Same reason as the shell: move to the top of the new screen before it paints.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screen]);
  const refreshLibrary = () => {
    client.invalidateQueries({ queryKey: ["teachers"] });
    client.invalidateQueries({ queryKey: ["teacher-folders"] });
    client.invalidateQueries({ queryKey: ["teacher-summary"] });
  };
  if (screen.view === "library")
    return (
      <TeacherLibrary
        header={header}
        onOpen={(teacherId) => setScreen({ view: "profile", teacherId })}
        onOpenRequisition={(teacherId, requisitionId) =>
          setScreen({ view: "requisition", teacherId, requisitionId })
        }
        onChanged={refreshLibrary}
      />
    );
  if (screen.view === "profile")
    return (
      <TeacherProfile
        teacherId={screen.teacherId}
        onBack={() => setScreen({ view: "library" })}
        onOpenRequisition={(requisitionId) =>
          setScreen({
            view: "requisition",
            teacherId: screen.teacherId,
            requisitionId,
          })
        }
        onChanged={refreshLibrary}
      />
    );
  return (
    <TeacherRequisitionEditor
      requisitionId={screen.requisitionId}
      teacherId={screen.teacherId}
      onBack={() => setScreen({ view: "profile", teacherId: screen.teacherId })}
    />
  );
}

/** A row of two or three choices, one of them on: the view, active or archived. */
const SEGMENTS =
  "inline-flex h-10 shrink-0 items-center gap-0.5 rounded-md border border-[#d0d5dd] bg-white p-1";
function segment(on: boolean) {
  return `inline-flex h-full items-center gap-1.5 rounded px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d7e5f3] ${
    on ? "bg-[#e8edf3] text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa] hover:text-[#344054]"
  }`;
}
function SegmentCount({ value, on }: { value: number; on: boolean }) {
  return (
    <span
      className={`rounded-full px-1.5 py-px text-xs tabular-nums ${
        on ? "bg-white text-[#1f4e79]" : "bg-[#f2f4f7] text-[#667085]"
      }`}
    >
      {value}
    </span>
  );
}

export function TeacherLibrary({
  header,
  onOpen,
  onOpenRequisition,
  onChanged,
}: {
  /** The page's own heading row, where the Google Form documents sync sits beside the title. */
  header?: HTMLElement | null;
  onOpen: (id: string) => void;
  onOpenRequisition: (teacherId: string, requisitionId: string) => void;
  onChanged: () => void;
}) {
  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: () => listTeachers(true),
  });
  const foldersQuery = useQuery({
    queryKey: ["teacher-folders"],
    queryFn: listTeacherFolders,
  });
  const templatesQuery = useQuery({
    queryKey: ["task-templates", "teacher"],
    queryFn: () => listTaskTemplates("teacher"),
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "teacher"],
    queryFn: () => listTasks("teacher"),
  });
  /*
   * What every row shows, asked once. Each fact on a row lives in a different table, so
   * asking per teacher would be fifty requests to paint a page of two dozen people.
   */
  const summary = useQuery({
    queryKey: ["teacher-summary"],
    queryFn: fetchTeacherSummary,
  });
  const teachers = teachersQuery.data ?? [];
  const folders = foldersQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const taskTemplates: TaskTemplate[] = templatesQuery.data ?? [];

  /*
   * Where the list was left, kept ten minutes like every page's: the view, the folder,
   * active or archived, the search and the filters. A step into a profile and back used to
   * land on "Teachers, all folders" whatever had been open.
   */
  const [libraryView, setLibraryView] = usePageState<"teachers" | "tasks">(
    "teacher-database:view",
    "teachers",
  );
  const [activeFolder, setActiveFolder] = usePageState<string>("teacher-database:folder", ALL_FOLDERS);
  const [showArchived, setShowArchived] = usePageState("teacher-database:archived", false);
  const [query, setQuery] = usePageState("teacher-database:search", "");
  const [filters, setFilters] = usePageState<FilterModel[]>("teacher-database:filters", []);
  const [teacherDialogOpen, setTeacherDialogOpen] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [pendingFolder, setPendingFolder] = useState<TeacherFolder | null>(null);
  /*
   * Who is ticked, for the things that are done to several people at once. Kept as ids
   * rather than rows so that narrowing the search does not silently drop somebody from
   * the selection: what you ticked stays ticked until you clear it.
   */
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const create = useMutation({
    mutationFn: createTeacher,
    onSuccess: (teacher) => {
      onChanged();
      onOpen(teacher.id);
    },
  });
  const createFolder = useMutation({
    mutationFn: createTeacherFolder,
    onSuccess: () => {
      onChanged();
      setFolderDialogOpen(false);
    },
  });
  const move = useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) =>
      moveTeacherToFolder(id, folderId),
    onSuccess: onChanged,
  });
  const removeFolder = useMutation({
    mutationFn: deleteTeacherFolder,
    onSuccess: onChanged,
  });

  const toggleChosen = (id: string) =>
    setChosen((held) => {
      const next = new Set(held);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const folderTree = flattenFolders(folders);
  const paths = new Map(
    folderTree.map(({ folder, path }) => [folder.id, path]),
  );
  const pathName = (id: string | null) =>
    id ? (paths.get(id) ?? []).map((folder) => folder.name).join(" › ") : "";
  // A folder remembered from last time that has since been deleted is "All teachers".
  const knownFolder = paths.has(activeFolder);
  const folderChoice =
    activeFolder === ALL_FOLDERS || activeFolder === UNFILED || knownFolder || !foldersQuery.isSuccess
      ? activeFolder
      : ALL_FOLDERS;
  const selectedFolder = knownFolder ? (folders.find((folder) => folder.id === activeFolder) ?? null) : null;
  const activeTeachers = teachers.filter((teacher) => !teacher.archivedAt);
  const byStatus = teachers.filter((teacher) => Boolean(teacher.archivedAt) === showArchived);
  const inView = byStatus
    .filter((teacher) =>
      folderChoice === ALL_FOLDERS
        ? true
        : folderChoice === UNFILED
          ? teacher.folderId === null
          : teacher.folderId === folderChoice,
    )
    .filter((teacher) =>
      `${teacher.fullName} ${teacher.email}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const picked = [...chosen];
  const anyChosen = picked.length > 0;
  const tasksByTeacher = new Map<string, ScopedTask[]>();
  for (const task of tasks) {
    const teacherTasks = tasksByTeacher.get(task.resourceId) ?? [];
    teacherTasks.push(task);
    tasksByTeacher.set(task.resourceId, teacherTasks);
  }
  /*
   * The tables' own filters, over what a row says: the hours, the paperwork, the tasks.
   */
  const filterRows: TeacherFilterRow[] = inView.map((teacher) => ({
    teacher,
    summary: summary.data?.[teacher.id],
    tasks: tasksByTeacher.get(teacher.id) ?? [],
    folder: pathName(teacher.folderId),
  }));
  const visible = applyFilters(filterRows, TEACHER_COLUMNS, filters).map((row) => row.teacher);
  const countIn = (folderId: string | null) =>
    String(byStatus.filter((teacher) => teacher.folderId === folderId).length);
  /*
   * The folders were a list down the side of the page that ended a third of the way down
   * while the teachers ran on to the bottom. One picker, with each folder's count beside
   * it, does the same job in the top bar and gives the list the whole width.
   */
  const folderOptions: SelectOption[] = [
    { value: ALL_FOLDERS, label: "All teachers", badge: String(byStatus.length), badgeTone: "muted" },
    ...(byStatus.some((teacher) => teacher.folderId === null) || folderChoice === UNFILED
      ? [{ value: UNFILED, label: "Unfiled", badge: countIn(null), badgeTone: "muted" as const }]
      : []),
    ...folderTree.map(({ folder, path }) => ({
      value: folder.id,
      label: path.map((step) => step.name).join(" › "),
      badge: countIn(folder.id),
      badgeTone: "muted" as const,
    })),
  ];
  const isLoading = teachersQuery.isLoading || foldersQuery.isLoading || tasksQuery.isLoading;
  const error = (
    teachersQuery.error ??
    foldersQuery.error ??
    tasksQuery.error ??
    move.error ??
    removeFolder.error
  )?.message;
  const tabId = useId();
  const panelId = `${tabId}-panel`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        * Nothing at all where the Google sign-in has not been configured: a line saying a
        * feature is absent is a line the list does not get. Where it is, it sits in the
        * page's own heading row beside the title rather than taking a row of its own.
        */}
      {documentsConfigured ? (
        header ? (
          createPortal(<TeacherDocumentSync heading />, header)
        ) : (
          <div className="pb-2">
            <TeacherDocumentSync heading />
          </div>
        )
      ) : null}
      {/*
        * One bar across the top: which list, which teachers, which folder, the search, and
        * the two things to make. It replaces a panel down the left that stopped a third of
        * the way down the page while the list beside it ran to the bottom.
        */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-3">
        <div role="tablist" aria-label="Part-time teachers view" className={SEGMENTS}>
          {(["teachers", "tasks"] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              id={`${tabId}-${view}`}
              aria-selected={libraryView === view}
              aria-controls={panelId}
              onClick={() => setLibraryView(view)}
              className={segment(libraryView === view)}
            >
              {view === "teachers" ? "Teachers" : "Tasks"}
            </button>
          ))}
        </div>
        {libraryView === "teachers" ? (
          <>
            <div role="group" aria-label="Which teachers" className={SEGMENTS}>
              <button
                type="button"
                aria-pressed={!showArchived}
                onClick={() => setShowArchived(false)}
                className={segment(!showArchived)}
              >
                Active <SegmentCount value={activeTeachers.length} on={!showArchived} />
              </button>
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived(true)}
                className={segment(showArchived)}
              >
                Archived <SegmentCount value={teachers.length - activeTeachers.length} on={showArchived} />
              </button>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-52">
                <SelectMenu
                  label="Folder"
                  value={folderChoice}
                  onChange={setActiveFolder}
                  options={folderOptions}
                  align="start"
                />
              </div>
              {selectedFolder ? (
                <button
                  type="button"
                  disabled={removeFolder.isPending && removeFolder.variables === selectedFolder.id}
                  onClick={() => setPendingFolder(selectedFolder)}
                  aria-label={`Delete folder ${selectedFolder.name}`}
                  title="Delete this folder"
                  className="inline-flex size-10 items-center justify-center rounded-md text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50"
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
            {/* Takes what the row has left, up to its own width, so the bar stays one line. */}
            <label className="relative block min-w-40 flex-1 sm:max-w-64">
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]"
              />
              <input
                aria-label="Search teachers"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search teachers"
                className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white pl-10 pr-3 text-sm"
              />
            </label>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              createFolder.reset();
              setFolderDialogOpen(true);
            }}
            className={SECONDARY_BUTTON}
          >
            <FolderPlus size={16} /> New folder
          </button>
          <button
            type="button"
            onClick={() => {
              create.reset();
              setTeacherDialogOpen(true);
            }}
            className={PRIMARY_BUTTON}
          >
            <UserPlus size={16} /> New teacher
          </button>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]"
        >
          {error}
        </p>
      ) : null}
      {/*
        * The list takes the width and the rest of the height, and scrolls inside itself
        * under a heading row that stays put. Below `lg` the page scrolls instead, and the
        * heading sticks to the top of the page.
        */}
      <section
        id={panelId}
        role="tabpanel"
        aria-labelledby={`${tabId}-${libraryView}`}
        className="flex min-h-0 flex-1 flex-col rounded-lg border border-[#d9dee7] bg-white lg:overflow-hidden"
      >
        {libraryView === "teachers" ? (
          <>
            <div className="group/toolbar flex shrink-0 items-center gap-3 border-b border-[#e5e7eb] px-4 py-2">
              {/*
                * Choosing everybody the search has narrowed to, which is how a payroll
                * run starts: filter to who you want, tick once, download.
                */}
              <label
                className={`flex shrink-0 items-center gap-2 text-sm text-[#667085] transition-opacity focus-within:opacity-100 group-hover/toolbar:opacity-100 ${
                  anyChosen ? "opacity-100" : "opacity-0"
                }`}
              >
                <input
                  type="checkbox"
                  aria-label={`Choose all ${visible.length} shown`}
                  checked={visible.length > 0 && visible.every((teacher) => chosen.has(teacher.id))}
                  onChange={(event) =>
                    setChosen((held) => {
                      const next = new Set(held);
                      for (const teacher of visible) {
                        if (event.target.checked) next.add(teacher.id);
                        else next.delete(teacher.id);
                      }
                      return next;
                    })
                  }
                />
                All
              </label>
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <TableFilterBar
                  columns={TEACHER_COLUMNS}
                  filters={filters}
                  optionsFor={(column) => optionsFor(filterRows, column)}
                  onChange={setFilters}
                />
              </div>
              <span className="shrink-0 text-xs tabular-nums text-[#98a2b3]">
                {visible.length === inView.length ? `${inView.length}` : `${visible.length} of ${inView.length}`}
              </span>
            </div>
            {isLoading ? (
              <p className="grid min-h-60 flex-1 place-items-center p-8 text-center text-sm text-[#667085]">
                Loading teachers…
              </p>
            ) : visible.length ? (
              <div role="list" aria-label="Teachers" className="min-h-0 flex-1 lg:overflow-y-auto">
                {/*
                  * Columns that line up down the list, under a quiet heading: who, what
                  * the requisitions pay for, the paperwork, and what can be done.
                  */}
                <div aria-hidden="true" className={`${ROW_GRID} sticky top-0 z-10 hidden border-b border-[#e5e7eb] bg-[#f8fafc] py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3] sm:grid`}>
                  <span />
                  <span>Teacher</span>
                  <span>Requisitions</span>
                  <span>Paperwork</span>
                  <span />
                </div>
                {visible.map((teacher) => {
                  const theirTasks = tasksByTeacher.get(teacher.id) ?? [];
                  const folderPath = pathName(teacher.folderId);
                  return (
                    <div
                      key={teacher.id}
                      role="listitem"
                      className={`${ROW_GRID} group grid border-b border-[#eef1f5] py-2.5 transition-colors hover:bg-[#fafbfd] ${
                        chosen.has(teacher.id) ? "bg-[#f5f9fd]" : ""
                      }`}
                    >
                      {/*
                        * Out of the way until it is wanted: it appears under the pointer,
                        * under the keyboard, and stays out once anything is ticked. Kept in
                        * the layout rather than removed, or every row would shift sideways
                        * the moment the pointer crossed it.
                        */}
                      <input
                        type="checkbox"
                        aria-label={`Choose ${teacher.fullName}`}
                        checked={chosen.has(teacher.id)}
                        onChange={() => toggleChosen(teacher.id)}
                        className={`justify-self-start transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
                          anyChosen ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => onOpen(teacher.id)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <TeacherAvatar fullName={teacher.fullName} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-[#171717] group-hover:text-[#1f4e79]">
                            {teacher.fullName}
                            {teacher.archivedAt ? (
                              <span className="ml-2 rounded bg-[#f2f4f7] px-1.5 py-0.5 text-[11px] font-medium text-[#667085]">
                                Archived
                              </span>
                            ) : null}
                          </span>
                          <span className="flex min-w-0 items-center gap-1.5 text-xs text-[#667085]">
                            <span className={`truncate ${teacher.email ? "" : "italic text-[#98a2b3]"}`}>
                              {teacher.email || "No email"}
                            </span>
                            {folderPath ? (
                              <span className="inline-flex shrink-0 items-center gap-1 text-[#98a2b3]">
                                <Folder size={12} aria-hidden="true" />
                                {folderPath}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                      <TeacherHoursFigures summary={summary.data?.[teacher.id]} loading={summary.isLoading} />
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <TeacherPaperwork summary={summary.data?.[teacher.id]} loading={summary.isLoading} />
                        {theirTasks.length ? <TaskProgressBadge tasks={theirTasks} /> : null}
                        <TeacherTaskWarning tasks={theirTasks} />
                      </span>
                      <span className="flex flex-nowrap items-center justify-end gap-1">
                        <TeacherRowActions
                          teacher={teacher}
                          summary={summary.data?.[teacher.id]}
                          onOpenRequisition={onOpenRequisition}
                          onChanged={onChanged}
                        />
                        <FolderMoveMenu
                          compact
                          label={`Move ${teacher.fullName} to folder`}
                          value={teacher.folderId}
                          folders={folders}
                          isMoving={move.isPending && move.variables.id === teacher.id}
                          onChange={(folderId) => move.mutate({ id: teacher.id, folderId })}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="grid min-h-60 flex-1 place-items-center p-12 text-center text-sm text-[#667085]">
                No {showArchived ? "archived" : "active"} teachers found.
              </p>
            )}
            <TeacherBulkActions
              chosen={picked}
              teachers={teachers}
              onClear={() => setChosen(new Set())}
            />
          </>
        ) : (
          <TasksOverview
            tasks={tasks}
            teachers={activeTeachers}
            folders={folders}
            onOpenTeacher={onOpen}
          />
        )}
      </section>
      {teacherDialogOpen ? (
        <NewTeacherDialog
          templates={taskTemplates}
          creating={create.isPending}
          error={create.error?.message ?? null}
          onClose={() => setTeacherDialogOpen(false)}
          onCreate={(input) => create.mutate(input)}
        />
      ) : null}
      {folderDialogOpen ? (
        <NewFolderDialog
          folders={folders}
          defaultParentId={selectedFolder?.id ?? ""}
          creating={createFolder.isPending}
          error={createFolder.error?.message ?? null}
          onClose={() => setFolderDialogOpen(false)}
          onCreate={(input) => createFolder.mutate(input)}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingFolder)}
        title="Delete folder?"
        description={`Delete the empty folder ${pendingFolder?.name ?? ""}? This cannot be undone.`}
        confirmLabel="Delete folder"
        onClose={() => setPendingFolder(null)}
        onConfirm={() => {
          if (pendingFolder) {
            removeFolder.mutate(pendingFolder.id);
            if (activeFolder === pendingFolder.id) setActiveFolder(ALL_FOLDERS);
          }
          setPendingFolder(null);
        }}
      />
    </div>
  );
}

/** The list's columns, shared by its heading and every row so they line up. */
const ROW_GRID =
  "gap-x-5 gap-y-2 px-4 sm:grid-cols-[1rem_minmax(11rem,1fr)_9.5rem_minmax(0,1.1fr)_auto] sm:items-center";

function TeacherTaskWarning({ tasks }: { tasks: ScopedTask[] }) {
  const overdue = tasks.some((task) => taskUrgency(task) === "OVERDUE");
  const dueSoon = tasks.some((task) => taskUrgency(task) === "DUE_SOON");
  if (!overdue && !dueSoon) return null;
  return (
    <span
      className={`text-xs font-semibold ${overdue ? "text-[#a6292f]" : "text-[#9a6700]"}`}
    >
      {overdue ? "Overdue tasks" : "Tasks due soon"}
    </span>
  );
}

/** One label over one field, full width of its cell: the forms in the dialogs below. */
const DIALOG_FIELD = "grid min-w-0 gap-1 text-sm font-medium text-[#344054]";
const DIALOG_INPUT =
  "h-10 w-full min-w-0 rounded-md border border-[#b7bec8] px-3 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]";

function DialogFooter({
  onCancel,
  onConfirm,
  disabled,
  label,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <button type="button" onClick={onCancel} className="text-sm font-semibold text-[#667085]">
        Cancel
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        className="rounded-md bg-[#1f4e79] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#9ba8b5]"
      >
        {label}
      </button>
    </div>
  );
}

function NewTeacherDialog({
  templates,
  creating,
  error,
  onClose,
  onCreate,
}: {
  templates: TaskTemplate[];
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: TeacherInput) => void;
}) {
  // Every checklist ticked to begin with: a new teacher usually needs all of them.
  const [draft, setDraft] = useState<TeacherInput & { taskTemplateIds: string[] }>(() => ({
    fullName: "",
    email: "",
    phone: "",
    notes: "",
    taskTemplateIds: templates.map((template) => template.id),
  }));
  const ready = Boolean(draft.fullName.trim()) && !creating;
  const submit = () => {
    if (ready) onCreate(draft);
  };
  return (
    <Modal
      open
      title="New part-time teacher"
      onClose={onClose}
      footer={
        <DialogFooter
          onCancel={onClose}
          onConfirm={submit}
          disabled={!ready}
          label={creating ? "Creating…" : "Create teacher"}
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid items-start gap-4 sm:grid-cols-2"
      >
        <InputField
          label="Full name"
          value={draft.fullName}
          required
          autoFocus
          onChange={(fullName) => setDraft({ ...draft, fullName })}
        />
        <InputField
          label="Email"
          value={draft.email}
          onChange={(email) => setDraft({ ...draft, email })}
        />
        <PhoneField
          value={draft.phone}
          onChange={(phone) => setDraft({ ...draft, phone })}
        />
        <label className={`${DIALOG_FIELD} sm:col-span-2`}>
          Notes
          <AutoResizeTextarea
            value={draft.notes}
            onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            minRows={2}
            className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal"
          />
        </label>
        {templates.length ? (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-[#344054]">Starting tasks</legend>
            {templates.map((template) => (
              <label
                key={template.id}
                className="flex items-start gap-2 rounded-md border border-[#d9dee7] p-3 text-sm text-[#344054]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.taskTemplateIds.includes(template.id)}
                  onChange={() =>
                    setDraft({
                      ...draft,
                      taskTemplateIds: draft.taskTemplateIds.includes(template.id)
                        ? draft.taskTemplateIds.filter((id) => id !== template.id)
                        : [...draft.taskTemplateIds, template.id],
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="font-semibold">{template.title}</span>
                  <span className="mt-1 block text-[#667085]">
                    {template.items.map((item) => item.title).join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#8f1f25]">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

function NewFolderDialog({
  folders,
  defaultParentId,
  creating,
  error,
  onClose,
  onCreate,
}: {
  folders: TeacherFolder[];
  /** The folder open in the list, which a new folder goes inside unless told otherwise. */
  defaultParentId: string;
  creating: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: { name: string; parentId: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(defaultParentId);
  const tree = flattenFolders(folders);
  const ready = Boolean(name.trim()) && !creating;
  const submit = () => {
    if (ready) onCreate({ name: name.trim(), parentId: parentId || null });
  };
  return (
    <Modal
      open
      title="New folder"
      onClose={onClose}
      footer={
        <DialogFooter
          onCancel={onClose}
          onConfirm={submit}
          disabled={!ready}
          label={creating ? "Creating…" : "Create folder"}
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="grid items-start gap-4 sm:grid-cols-2"
      >
        <label className={DIALOG_FIELD}>
          Folder name
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={DIALOG_INPUT}
          />
        </label>
        {tree.length ? (
          <div className={DIALOG_FIELD}>
            <span>Inside</span>
            <SelectMenu
              label="Inside"
              value={parentId}
              onChange={setParentId}
              options={[
                { value: "", label: "Top level" },
                ...tree.map(({ folder, path }) => ({
                  value: folder.id,
                  label: path.map((step) => step.name).join(" › "),
                })),
              ]}
            />
          </div>
        ) : null}
      </form>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[#8f1f25]">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}

type ProfileTab = "requisitions" | "time-sheets" | "timetable";
type RequisitionTotals = { teaching: number; admin: number };

/**
 * One teacher: a summary rail down the left, and their paperwork in tabs on the right.
 *
 * The rail holds what is read at a glance and changed now and then — how to reach them,
 * the notes, the hours, the documents, the tasks. The tabs hold the long lists. Both run
 * the full height and scroll on their own, so neither ends partway down the page.
 */
export function TeacherProfile({
  teacherId,
  onBack,
  onOpenRequisition,
  onChanged,
}: {
  teacherId: string;
  onBack: () => void;
  onOpenRequisition: (id: string) => void;
  onChanged: () => void;
}) {
  const client = useQueryClient();
  const teacher = useQuery({
    queryKey: ["teacher", teacherId],
    queryFn: () => getTeacher(teacherId),
    initialData: () =>
      client.getQueryData<Teacher[]>(["teachers"])?.find((row) => row.id === teacherId),
    initialDataUpdatedAt: () => client.getQueryState(["teachers"])?.dataUpdatedAt,
  });
  const requisitions = useQuery({
    queryKey: ["teacher-requisitions", teacherId],
    queryFn: () => listTeacherRequisitions(teacherId),
  });
  const summary = useQuery({
    queryKey: ["teacher-summary"],
    queryFn: fetchTeacherSummary,
  });
  const folders = useQuery({
    queryKey: ["teacher-folders"],
    queryFn: listTeacherFolders,
  });
  /*
   * The join to an Active teacher, made on the Active teachers page. It is what says which
   * sections are theirs — the time sheets read it the same way — so the Timetable tab is
   * offered only when there is one. Without it there is no week to draw.
   */
  const actives = useQuery({
    queryKey: ["active-teachers"],
    queryFn: fetchActiveTeachers,
    retry: false,
  });
  const linked = (actives.data ?? []).find((row) => row.partTimeTeacherId === teacherId) ?? null;
  /*
   * Each requisition's hours, for its row. The list the server gives carries only the
   * label and year; a teacher has a handful, and the editor reads the same entries, so
   * opening one after this asks for nothing new.
   */
  const totals = useQueries({
    queries: (requisitions.data ?? []).map((item) => ({
      queryKey: ["teacher-requisition", item.id],
      queryFn: () => getTeacherRequisition(item.id),
      retry: false,
    })),
    combine: (reads) =>
      Object.fromEntries(
        reads.flatMap((read) =>
          read.data
            ? [[read.data.id, { teaching: totalTeachingHours(read.data.content.courses), admin: totalAdminHours(read.data.content) }]]
            : [],
        ),
      ) as Record<string, RequisitionTotals>,
  });
  const [tab, setTab] = usePageState<ProfileTab>(`teacher-profile:${teacherId}:tab`, "requisitions");
  const shownTab: ProfileTab = tab === "timetable" && !linked ? "requisitions" : tab;
  const [editing, setEditing] = useState(false);
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const tabId = useId();
  const panelId = `${tabId}-panel`;
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["teacher", teacherId] });
    client.invalidateQueries({ queryKey: ["teacher-requisitions", teacherId] });
    onChanged();
  };
  const save = useMutation({
    mutationFn: (
      input: Pick<Teacher, "fullName" | "email" | "phone" | "notes">,
    ) => updateTeacher(teacherId, input),
    onSuccess: refresh,
  });
  const archive = useMutation({
    mutationFn: () => archiveTeacher(teacherId),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: () => restoreTeacher(teacherId),
    onSuccess: refresh,
  });
  const createRequest = useMutation({
    mutationFn: (input: RequisitionInput) => createTeacherRequisition(teacherId, input),
    onSuccess: (requisition) => {
      setNewRequestOpen(false);
      refresh();
      onOpenRequisition(requisition.id);
    },
  });
  const removeRequest = useMutation({
    mutationFn: deleteTeacherRequisition,
    onSuccess: refresh,
  });
  const renameRequest = useMutation({
    mutationFn: async ({
      id,
      label: nextLabel,
    }: {
      id: string;
      label: string;
    }) =>
      updateTeacherRequisition({
        ...(await getTeacherRequisition(id)),
        label: nextLabel,
      }),
    onSuccess: (saved) => {
      client.setQueryData(["teacher-requisition", saved.id], saved);
      refresh();
    },
  });
  if (!teacher.data) return <ScreenLoading label="Loading teacher…" />;
  const profile = teacher.data;
  const folderPath = profile.folderId
    ? flattenFolders(folders.data ?? [])
        .find(({ folder }) => folder.id === profile.folderId)
        ?.path.map((folder) => folder.name)
        .join(" › ")
    : "";
  const tabs: { id: ProfileTab; label: string; count?: number }[] = [
    { id: "requisitions", label: "Requisitions", count: requisitions.data?.length },
    { id: "time-sheets", label: "Time sheets", count: summary.data?.[teacherId]?.timeSheets },
    ...(linked ? [{ id: "timetable" as const, label: "Timetable" }] : []),
  ];
  const actionError = (archive.error ?? restore.error ?? removeRequest.error)?.message;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to teachers"
            title="Back to teachers"
            className={BACK_BUTTON}
          >
            <ArrowLeft size={19} />
          </button>
          <TeacherAvatar fullName={profile.fullName} />
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold text-[#171717]">{profile.fullName}</h2>
            {folderPath || profile.archivedAt ? (
              <p className="flex flex-wrap items-center gap-2 text-xs text-[#667085]">
                {folderPath ? (
                  <span className="inline-flex items-center gap-1">
                    <Folder size={12} aria-hidden="true" /> {folderPath}
                  </span>
                ) : null}
                {profile.archivedAt ? (
                  <span className="rounded bg-[#f2f4f7] px-1.5 py-0.5 font-medium text-[#667085]">Archived</span>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className={SECONDARY_BUTTON}>
            <Pencil size={16} /> Edit profile
          </button>
          {profile.archivedAt ? (
            <button
              type="button"
              disabled={restore.isPending}
              onClick={() => restore.mutate()}
              className={SECONDARY_BUTTON}
            >
              <RotateCcw size={16} /> Restore
            </button>
          ) : (
            <button
              type="button"
              disabled={archive.isPending}
              onClick={() => archive.mutate()}
              className={DANGER_BUTTON}
            >
              <Archive size={16} /> Archive
            </button>
          )}
        </div>
      </header>
      {actionError ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]"
        >
          {actionError}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <aside
          aria-label="Teacher summary"
          className="divide-y divide-[#eef1f5] rounded-lg border border-[#d9dee7] bg-white lg:w-[340px] lg:shrink-0 lg:overflow-y-auto"
        >
          <ProfileOverview
            teacher={profile}
            onSave={save.mutateAsync}
            saving={save.isPending}
            error={save.error?.message ?? null}
            editing={editing}
            onEditingChange={setEditing}
          />
          <RailSection
            title="Hours"
            info="What their requisitions pay for: teaching and admin hours, and how many requisitions are filed."
          >
            <TeacherHoursFigures summary={summary.data?.[teacherId]} loading={summary.isLoading} />
          </RailSection>
          <TeacherDocumentsSection teacherId={teacherId} />
          <TaskPanel
            variant="rail"
            resourceType="teacher"
            resourceId={teacherId}
            className="px-4 py-4"
          />
        </aside>
        <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-[#d9dee7] bg-white lg:min-h-0">
          <div
            role="tablist"
            aria-label={`${profile.fullName}'s records`}
            className="flex shrink-0 flex-wrap gap-1 border-b border-[#d9dee7] px-3"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`${tabId}-${item.id}`}
                aria-selected={shownTab === item.id}
                aria-controls={panelId}
                onClick={() => setTab(item.id)}
                className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                  shownTab === item.id
                    ? "border-[#1f4e79] text-[#1f4e79]"
                    : "border-transparent text-[#667085] hover:border-[#b7bec8] hover:text-[#344054]"
                }`}
              >
                {item.label}
                {item.count ? (
                  <span className="rounded-full bg-[#eef1f5] px-1.5 py-px text-xs tabular-nums text-[#667085]">
                    {item.count}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${tabId}-${shownTab}`}
            className="min-h-0 flex-1 p-4 lg:overflow-y-auto"
          >
            {shownTab === "requisitions" ? (
              <RequisitionHistory
                requisitions={requisitions.data ?? []}
                loading={requisitions.isLoading}
                totals={totals}
                onOpen={onOpenRequisition}
                onDelete={removeRequest.mutate}
                deleting={removeRequest.isPending}
                onRename={(id, nextLabel) =>
                  renameRequest.mutateAsync({ id, label: nextLabel })
                }
                renaming={renameRequest.isPending}
                actions={
                  <button
                    type="button"
                    onClick={() => {
                      createRequest.reset();
                      setNewRequestOpen(true);
                    }}
                    className={PRIMARY_BUTTON}
                  >
                    <FilePlus2 size={16} /> New requisition
                  </button>
                }
              />
            ) : null}
            {shownTab === "time-sheets" ? <TimeSheetsCard teacherId={teacherId} bare /> : null}
            {shownTab === "timetable" && linked ? <TeacherProfileTimetable teacher={linked} /> : null}
          </div>
        </section>
      </div>
      <NewRequisitionDialog
        open={newRequestOpen}
        teacherName={profile.fullName}
        sources={requisitions.data ?? []}
        creating={createRequest.isPending}
        error={createRequest.error?.message ?? null}
        onClose={() => setNewRequestOpen(false)}
        onCreate={(input) => createRequest.mutate(input)}
      />
    </div>
  );
}

/** One section of the profile's rail: a small heading, an ⓘ if it needs one, a button. */
function RailSection({
  title,
  info,
  action,
  children,
}: {
  title: string;
  info?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="px-4 py-4">
      <div className="mb-2 flex min-h-7 items-center justify-between gap-2">
        <h3
          id={headingId}
          className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[#667085]"
        >
          {title}
          {info ? <InfoTip label={`About ${title.toLowerCase()}`}>{info}</InfoTip> : null}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** "3 min ago", then the date: when a requisition was last changed, at a glance. */
function updatedWords(value: string, now = new Date()): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(at);
}

function fullDate(value: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
}

/** The requisitions' columns, shared by the heading and every row so they line up. */
const REQUISITION_GRID =
  "grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4 sm:grid-cols-[minmax(0,1fr)_6.5rem_5rem_5rem_7.5rem_2.25rem]";

export function RequisitionHistory({
  requisitions,
  onOpen,
  onDelete,
  deleting,
  onRename,
  renaming = false,
  totals,
  loading = false,
  actions,
}: {
  requisitions: TeacherRequisitionSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  deleting: boolean;
  onRename: (id: string, label: string) => Promise<unknown> | void;
  renaming?: boolean;
  /** Each requisition's teaching and admin hours, as far as they have been read. */
  totals?: Record<string, RequisitionTotals>;
  loading?: boolean;
  /** Beside the search: the button that starts a new one. */
  actions?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingDeletion, setPendingDeletion] =
    useState<TeacherRequisitionSummary | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRequisitions = requisitions.filter((requisition) =>
    `${requisition.label} ${requisition.academicYear}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  async function submitTitle(id: string) {
    const label = titleDraft.trim();
    if (!label) return;
    await onRename(id, label);
    setEditingId(null);
  }
  const hours = (id: string, kind: keyof RequisitionTotals) => {
    const held = totals?.[id];
    if (!held) return totals ? "…" : "—";
    return held[kind] ? `${formatTeachingHours(held[kind])} h` : "—";
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full sm:w-72">
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]"
          />
          <input
            aria-label="Search requisitions"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search requisitions"
            className="h-10 w-full rounded-md border border-[#cbd5e1] pl-10 pr-3 text-sm"
          />
        </label>
        <InfoTip label="What requisitions are">
          Labelled requests for this teacher — as many a year as are needed. Press a title to rename it; press
          anywhere else on the row to open it.
        </InfoTip>
        {actions ? <div className="ml-auto">{actions}</div> : null}
      </div>
      {visibleRequisitions.length ? (
        <div className="mt-3 rounded-lg border border-[#e4e8ef]">
          <div
            aria-hidden="true"
            className={`${REQUISITION_GRID} hidden rounded-t-lg border-b border-[#e4e8ef] bg-[#f8fafc] py-1.5 text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3] sm:grid`}
          >
            <span>Requisition</span>
            <span>Year</span>
            <span className="text-right">Teaching</span>
            <span className="text-right">Admin</span>
            <span>Updated</span>
            <span />
          </div>
          <div role="list" aria-label="Requisitions">
            {visibleRequisitions.map((requisition) => (
              <article
                key={requisition.id}
                role="listitem"
                className={`${REQUISITION_GRID} group relative grid items-center border-b border-[#eef1f5] py-3 transition-colors last:rounded-b-lg last:border-b-0 hover:bg-[#f8fafc]`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(requisition.id)}
                  aria-label={`Open ${requisition.label}`}
                  className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1f4e79]"
                >
                  <span className="sr-only">Open {requisition.label}</span>
                </button>
                <div className="pointer-events-none relative z-10 min-w-0">
                  {editingId === requisition.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void submitTitle(requisition.id);
                      }}
                      className="pointer-events-auto"
                    >
                      <label
                        className="sr-only"
                        htmlFor={`requisition-title-${requisition.id}`}
                      >
                        Requisition title
                      </label>
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id={`requisition-title-${requisition.id}`}
                          aria-label="Requisition title"
                          required
                          autoFocus
                          value={titleDraft}
                          onChange={(event) => setTitleDraft(event.target.value)}
                          onBlur={() => {
                            void submitTitle(requisition.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                            if (event.key === "Escape") {
                              setTitleDraft(requisition.label);
                              setEditingId(null);
                            }
                          }}
                          className="h-9 min-w-0 flex-1 rounded-md border border-[#b7bec8] px-3 text-sm font-semibold"
                        />
                        {renaming ? (
                          <span className="text-sm text-[#667085]">Saving…</span>
                        ) : null}
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(requisition.id);
                          setTitleDraft(requisition.label);
                        }}
                        aria-description="Click to edit requisition title"
                        className="pointer-events-auto block max-w-full truncate rounded-sm text-left font-semibold text-[#171717] hover:text-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
                      >
                        {requisition.label}
                      </button>
                      {/* Below `sm` the columns fold into one line under the title. */}
                      <span className="mt-0.5 block text-xs text-[#667085] sm:hidden">
                        {[
                          requisition.academicYear,
                          `${hours(requisition.id, "teaching")} teaching`,
                          `${hours(requisition.id, "admin")} admin`,
                        ].join(" · ")}
                      </span>
                    </>
                  )}
                </div>
                <span className="pointer-events-none relative hidden text-sm text-[#475467] sm:block">
                  {requisition.academicYear}
                </span>
                <span className="pointer-events-none relative hidden text-right text-sm font-semibold tabular-nums text-[#1f4e79] sm:block">
                  {hours(requisition.id, "teaching")}
                </span>
                <span className="pointer-events-none relative hidden text-right text-sm font-semibold tabular-nums text-[#7a5a1d] sm:block">
                  {hours(requisition.id, "admin")}
                </span>
                <span
                  className="pointer-events-none relative hidden text-xs text-[#667085] sm:block"
                  title={`Created ${fullDate(requisition.createdAt)} · Updated ${fullDate(requisition.updatedAt)}`}
                >
                  {updatedWords(requisition.updatedAt)}
                </span>
                <div className="relative z-10 flex justify-end">
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => setPendingDeletion(requisition)}
                    aria-label={`Delete ${requisition.label}`}
                    title="Delete requisition"
                    className="rounded p-2 text-[#a6292f] hover:bg-[#fff1f2] disabled:opacity-50"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-[#d0d5dd] px-4 py-8 text-center text-sm text-[#667085]">
          {loading
            ? "Reading the requisitions…"
            : requisitions.length
              ? "No requisitions match your search."
              : "No requisitions yet."}
        </p>
      )}
      <ConfirmDialog
        open={Boolean(pendingDeletion)}
        title="Delete requisition?"
        description={`Delete ${pendingDeletion?.label ?? "this requisition"}? This cannot be undone.`}
        confirmLabel="Delete requisition"
        onClose={() => setPendingDeletion(null)}
        onConfirm={() => {
          if (pendingDeletion) onDelete(pendingDeletion.id);
          setPendingDeletion(null);
        }}
      />
    </div>
  );
}

export function TeacherAvatar({
  fullName,
  size = "small",
}: {
  fullName: string;
  size?: "tiny" | "small" | "large";
}) {
  const dimensions = size === "large" ? "h-14 w-14" : size === "tiny" ? "h-7 w-7" : "h-10 w-10";
  const iconSize = size === "large" ? 34 : size === "tiny" ? 18 : 24;
  return (
    <span
      role="img"
      aria-label={`Profile photo placeholder for ${fullName}`}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#e8edf3] text-[#1f4e79] ${dimensions}`}
    >
      <CircleUserRound aria-hidden size={iconSize} strokeWidth={1.5} />
    </span>
  );
}

/**
 * Copying the latest Google Form response for each matched teacher into their Drive
 * folder. One sync covers everybody, so it is offered on the list and on each profile.
 *
 * No sign-in of its own. The application's already says who is asking, and the server
 * keeps teachers' documents to its own list of people; only the sync needs Google's
 * permission to write Drive folders, and that is asked for when Sync is pressed.
 */
function TeacherDocumentSync({ heading = false, teacherId }: { heading?: boolean; teacherId?: string }) {
  const client = useQueryClient();
  const issues = useQuery({
    queryKey: ["teacher-document-issues"],
    queryFn: () => listTeacherDocumentIssues(),
    retry: false,
  });
  const sync = useMutation({
    mutationFn: (driveAccessToken: string) => syncTeacherDocuments(driveAccessToken),
    onSuccess: () => {
      void issues.refetch();
      void client.invalidateQueries({ queryKey: ["teacher-summary"] });
      if (teacherId) void client.invalidateQueries({ queryKey: ["teacher-documents", teacherId] });
    },
  });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {heading ? (
        <span className="flex items-center gap-1.5 font-semibold text-[#344054]">
          Google Form documents
          <InfoTip label="What syncing the Google Form documents does">
            Copies the latest response for each matched teacher into their managed Google Drive folder.
          </InfoTip>
        </span>
      ) : null}
      <GoogleDocumentSyncButton
        disabled={sync.isPending}
        onAccessToken={(driveAccessToken) => sync.mutate(driveAccessToken)}
      />
      {sync.isSuccess ? (
        <span role="status" className="basis-full text-[#256237]">
          Synced {sync.data.updated}; {sync.data.skipped} unchanged;{" "}
          {sync.data.needsReview} need review.
        </span>
      ) : null}
      {sync.error || issues.error ? (
        <span role="alert" className="basis-full text-[#8f1f25]">
          {(sync.error ?? issues.error)?.message}
        </span>
      ) : null}
      {issues.data?.length ? (
        <span className="basis-full text-[#8f1f25]">
          {issues.data.length} response{issues.data.length === 1 ? "" : "s"}{" "}
          need review.
        </span>
      ) : null}
    </div>
  );
}

function TeacherDocumentsSection({ teacherId }: { teacherId: string }) {
  const documents = useQuery({
    queryKey: ["teacher-documents", teacherId],
    queryFn: () => getTeacherDocuments(teacherId),
    retry: false,
  });
  const download = useMutation({
    mutationFn: () => downloadTeacherDocuments(teacherId),
  });
  return (
    <RailSection
      title="Documents"
      info="The latest Google Form documents, stored in the managed Google Drive folder."
    >
      {documents.isLoading ? (
        <p className="text-sm text-[#667085]">Loading documents…</p>
      ) : null}
      {documents.error ? (
        <p role="alert" className="text-sm text-[#8f1f25]">
          {documents.error.message}
        </p>
      ) : null}
      {documents.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={documents.data.driveFolderUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
          >
            <Folder size={16} /> Open Drive folder
          </a>
          <button
            type="button"
            disabled={download.isPending}
            onClick={() => download.mutate()}
            className="inline-flex items-center gap-2 rounded-md border border-[#b7bec8] px-3 py-2 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb] disabled:opacity-50"
          >
            <Download size={16} />{" "}
            {download.isPending ? "Preparing ZIP…" : "Download ZIP"}
          </button>
          {download.error ? (
            <p role="alert" className="basis-full text-sm text-[#8f1f25]">
              {download.error.message}
            </p>
          ) : null}
        </div>
      ) : null}
      {documents.isSuccess && !documents.data ? (
        <p className="text-sm text-[#667085]">
          No Google Form response has been matched to this profile yet.
        </p>
      ) : null}
      {documentsConfigured ? (
        <div className="mt-3">
          <TeacherDocumentSync teacherId={teacherId} />
        </div>
      ) : null}
    </RailSection>
  );
}

type ProfileFields = Pick<Teacher, "fullName" | "email" | "phone" | "notes">;
const profileFields = (teacher: Teacher): ProfileFields => ({
  fullName: teacher.fullName,
  email: teacher.email,
  phone: teacher.phone,
  notes: teacher.notes,
});

/**
 * How to reach them and what to know, as two sections of the profile's rail, with the
 * form to change them in a dialog.
 *
 * On the profile the Edit profile button is in the header, beside Archive, and the dialog
 * is opened from there (`editing` / `onEditingChange`); on its own it shows a button of
 * its own on the Contact section.
 */
export function ProfileOverview({
  teacher,
  onSave,
  saving = false,
  error = null,
  editing: editingProp,
  onEditingChange,
}: {
  teacher: Teacher;
  onSave: (input: ProfileFields) => Promise<unknown>;
  saving?: boolean;
  error?: string | null;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [ownEditing, setOwnEditing] = useState(false);
  const controlled = onEditingChange !== undefined;
  const editing = controlled ? Boolean(editingProp) : ownEditing;
  const setEditing = (next: boolean) => (onEditingChange ? onEditingChange(next) : setOwnEditing(next));
  const [draft, setDraft] = useState<ProfileFields>(() => profileFields(teacher));
  useEffect(() => {
    setDraft(profileFields(teacher));
  }, [teacher]);
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!draft.fullName.trim() || saving) return;
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // The failure is said in the dialog, which stays open with what was typed.
    }
  }
  function cancel() {
    setDraft(profileFields(teacher));
    setEditing(false);
  }
  /*
   * Guidance belongs to the FIELD, not to the record on screen. "What goes in Phone" is
   * the same answer on every teacher, and scoping it to one teacher's id meant a sentence
   * written once appeared on exactly one profile and nowhere else. The syllabus side has
   * always used a shared scope; this is the teachers side catching up with it.
   */
  return (
    <FieldInfoProvider
      source={{ resourceType: "teacher-field", resourceId: "shared", app: "database" }}
    >
      <RailSection
        title="Contact"
        action={
          controlled ? null : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-[#1f4e79] hover:bg-[#f2f7fb]"
            >
              <Pencil size={14} /> Edit profile
            </button>
          )
        }
      >
        <dl className="grid gap-3">
          <ProfileDetail
            label="Email"
            value={teacher.email}
            emptyLabel="No email provided"
            href={teacher.email ? `mailto:${teacher.email}` : undefined}
          />
          <ProfileDetail
            label="Phone"
            value={teacher.phone}
            emptyLabel="No phone number provided"
          />
        </dl>
      </RailSection>
      <RailSection title="Notes">
        <p
          className={`whitespace-pre-wrap text-sm ${teacher.notes ? "text-[#171717]" : "text-[#667085]"}`}
        >
          {teacher.notes || "No notes added"}
        </p>
      </RailSection>
      <Modal
        open={editing}
        title="Edit profile"
        onClose={cancel}
        footer={
          <DialogFooter
            onCancel={cancel}
            onConfirm={() => void submit()}
            disabled={saving || !draft.fullName.trim()}
            label={saving ? "Saving…" : "Save profile"}
          />
        }
      >
        <form
          onSubmit={(event) => void submit(event)}
          className="grid items-start gap-4 sm:grid-cols-2"
        >
          <InputField
            label="Full name"
            fieldKey="fullName"
            value={draft.fullName}
            required
            autoFocus
            onChange={(fullName) => setDraft({ ...draft, fullName })}
          />
          <InputField
            label="Email"
            fieldKey="email"
            value={draft.email}
            onChange={(email) => setDraft({ ...draft, email })}
          />
          <PhoneField
            fieldKey="phone"
            value={draft.phone}
            onChange={(phone) => setDraft({ ...draft, phone })}
          />
          <label className={`${DIALOG_FIELD} sm:col-span-2`}>
            <FormFieldLabel fieldKey="notes">Notes</FormFieldLabel>
            <AutoResizeTextarea
              value={draft.notes}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
              minRows={3}
              className="rounded-md border border-[#b7bec8] px-3 py-2 font-normal"
            />
          </label>
        </form>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-[#8f1f25]">
            {error}
          </p>
        ) : null}
      </Modal>
    </FieldInfoProvider>
  );
}

function ProfileDetail({
  label,
  value,
  emptyLabel,
  href,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  href?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[#667085]">{label}</dt>
      <dd
        className={`mt-0.5 break-words text-sm ${value ? "text-[#171717]" : "text-[#667085]"}`}
      >
        {value && href ? (
          <a href={href} className="text-[#1f4e79] hover:underline">
            {value}
          </a>
        ) : (
          value || emptyLabel
        )}
      </dd>
    </div>
  );
}

type RequisitionStep = "details" | "courses" | "admin" | "review";

export function TeacherRequisitionEditor({
  requisitionId,
  teacherId,
  onBack,
}: {
  requisitionId: string;
  teacherId: string;
  onBack: () => void;
}) {
  const client = useQueryClient();
  const requisition = useQuery({
    queryKey: ["teacher-requisition", requisitionId],
    queryFn: () => getTeacherRequisition(requisitionId),
  });
  const teacher = useQuery({
    queryKey: ["teacher", teacherId],
    queryFn: () => getTeacher(teacherId),
  });
  const catalogue = useQuery({
    queryKey: ["course-catalogue"],
    queryFn: () => listCourseCatalogue(),
  });
  const [draft, setDraft] = useState<TeacherRequisition | null>(null);
  const [active, setActive] = useState<RequisitionStep>("details");
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
  const workspaceRef = useRef<HTMLDivElement>(null);
  /*
   * Take what the server has when this is a different requisition, and also when the
   * server is AHEAD of what is on screen with nothing unsaved to lose.
   *
   * The second half is the fix for work appearing to vanish. Opening a requisition a
   * second time seeds the editor from the query cache, which serves the version it read
   * the first time; guarding only on the id meant the fresher copy that arrived a moment
   * later was ignored, so the editor sat there showing an old revision of a document that
   * had been saved perfectly well. Editing from there then sent a revision the server had
   * moved past, which is where "this changed elsewhere" came from, and the work had to be
   * done again. `dirtyRef` is what keeps this from ever overwriting something unsaved.
   */
  useEffect(() => {
    const fresh = requisition.data;
    if (!fresh) return;
    const held = draftRef.current;
    const another = held?.id !== fresh.id;
    const serverIsAhead = !another && !dirtyRef.current && fresh.revision > (held?.revision ?? 0);
    if (!another && !serverIsAhead) return;
    draftRef.current = fresh;
    setDraft(fresh);
    dirtyRef.current = false;
    setDirty(false);
    setSaveState("saved");
    setSaveError(null);
    saveConflict.current = false;
    setValidationMessage("");
  }, [requisition.data]);
  /*
   * What the rest of the app reads about this teacher changes when a requisition is
   * saved: the hours on their row come out of these courses, and the list shows the
   * label. Done on the way out rather than on every keystroke's save.
   */
  useEffect(
    () => () => {
      client.invalidateQueries({ queryKey: ["teacher-requisitions", teacherId] });
      client.invalidateQueries({ queryKey: ["teacher-summary"] });
    },
    [client, teacherId],
  );
  // Each step starts at its top, rather than wherever the last one was scrolled to.
  useEffect(() => {
    workspaceRef.current?.scrollTo?.({ top: 0 });
  }, [active]);
  const exportDocx = useMutation({
    mutationFn: downloadTeacherRequisitionExport,
  });
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
    if (saveState === "error") {
      setSaveState("saved");
      setSaveError(null);
    }
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
        // The cache is what the editor is seeded from next time it opens. Left holding
        // the version this save replaced, it hands back stale work on the way back in.
        client.setQueryData(["teacher-requisition", requisitionId], saved);
        if (draftRef.current === snapshot) {
          draftRef.current = saved;
          setDraft(saved);
          dirtyRef.current = false;
          setDirty(false);
        } else {
          setDraft((current) => {
            if (!current) return current;
            const rebased = {
              ...current,
              revision: saved.revision,
              updatedAt: saved.updatedAt,
            };
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
        setSaveError(
          error instanceof Error
            ? error.message
            : "Save failed. Please try again.",
        );
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
    const timer = window.setTimeout(() => {
      void persistCurrentDraft();
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, dirty]);
  useEffect(() => {
    if (!focusTarget) return;
    const frame = window.requestAnimationFrame(() => {
      const anchor = Array.from(
        document.querySelectorAll<HTMLElement>("[data-requisition-field]"),
      ).find((element) => element.dataset.requisitionField === focusTarget);
      const control = anchor?.querySelector<HTMLElement>(
        "input, button, [tabindex]",
      );
      anchor?.scrollIntoView({ behavior: "smooth", block: "center" });
      control?.focus({ preventScroll: true });
      setFocusTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, draft, focusTarget]);
  if (!draft) return <ScreenLoading label="Loading requisition…" />;
  const updateContent = (patch: Partial<RequisitionContent>) =>
    edit((current) => ({
      ...current,
      content: { ...current.content, ...patch },
    }));
  const total = totalTeachingHours(draft.content.courses);
  const adminTotal = totalAdminHours(draft.content);
  const teacherName = teacher.data?.fullName ?? "Loading teacher…";
  function validate() {
    if (!draft) return false;
    const missing = missingRequisitionFields(draft);
    if (!missing.length) return true;
    setValidationMessage(
      `Complete all required fields before saving or exporting: ${missing.join(", ")}.`,
    );
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
  const steps: { id: RequisitionStep; label: string; aside?: string }[] = [
    { id: "details", label: "Request details" },
    { id: "courses", label: "Teaching load", aside: total ? `${formatTeachingHours(total)} h` : undefined },
    { id: "admin", label: "Admin hours", aside: adminTotal ? `${formatTeachingHours(adminTotal)} h` : undefined },
    { id: "review", label: "Review" },
  ];
  // Shared across every requisition, for the reason given on the profile above.
  return (
    <FieldInfoProvider
      source={{
        resourceType: "teacher-requisition-field",
        resourceId: "shared",
        app: "database",
      }}
    >
      {/*
        * The whole width, and the same frame on every step: one header, the steps down the
        * left for the full height, and a form column that takes the rest and scrolls on
        * its own. It was a column centred at its content's width, so it grew and shifted
        * as a course opened or a step changed, and the header collapsed partway down.
        */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header
          data-testid="editor-header"
          className="flex shrink-0 flex-col gap-3 border-b border-[#d9dee7] pb-4 lg:flex-row lg:items-center lg:justify-between"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={onBack}
                aria-label="Back to teacher profile"
                title="Back to teacher profile"
                className={BACK_BUTTON}
              >
                <ArrowLeft size={19} />
              </button>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#a6292f]">
                  {[draft.academicYear, "Teaching-recruitment request"].filter(Boolean).join(" · ")}
                </p>
                <InlineRequisitionTitle
                  value={draft.label}
                  editing={editingTitle}
                  onEdit={() => setEditingTitle(true)}
                  onChange={(label) => edit((current) => ({ ...current, label }))}
                  onDone={() => setEditingTitle(false)}
                />
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#b9d0e5] bg-[#f2f7fb] py-1 pl-1 pr-3">
              <TeacherAvatar fullName={teacherName} size="tiny" />
              <span className="text-sm font-semibold text-[#1f4e79]">
                <span className="sr-only">Teacher: </span>
                {teacherName}
              </span>
            </span>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <AutoSaveStatus
              state={saveState}
              error={saveError}
              resourceName="This requisition"
              onReload={() => {
                void reloadLatest();
              }}
            />
            <button
              type="button"
              disabled={exportDocx.isPending}
              onClick={() => {
                void exportCurrentDraft();
              }}
              className={SECONDARY_BUTTON}
            >
              <Download size={16} /> Export DOCX
            </button>
          </div>
        </header>
        {validationMessage ? (
          <p
            role="alert"
            className="mt-3 shrink-0 rounded-md border border-[#efc9cb] bg-[#fff5f5] px-3 py-2 text-sm text-[#8f1f25]"
          >
            {validationMessage}
          </p>
        ) : null}
        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <nav aria-label="Requisition steps" className="shrink-0 lg:w-60">
            <ol className="flex gap-1 overflow-x-auto rounded-lg border border-[#d9dee7] bg-white p-2 lg:h-full lg:flex-col lg:overflow-y-auto">
              {steps.map((step, index) => {
                const on = active === step.id;
                return (
                  <li key={step.id} className="shrink-0">
                    <button
                      type="button"
                      aria-current={on ? "step" : undefined}
                      onClick={() => setActive(step.id)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#d7e5f3] ${
                        on ? "bg-[#e8edf3] font-semibold text-[#1f4e79]" : "text-[#475467] hover:bg-[#f7f8fa]"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                          on ? "bg-[#1f4e79] text-white" : "bg-[#eef1f5] text-[#667085]"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-nowrap">{step.label}</span>
                      {step.aside ? (
                        <span className="shrink-0 text-xs font-normal tabular-nums text-[#98a2b3]">{step.aside}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <div
            ref={workspaceRef}
            data-testid="editor-workspace"
            className="min-w-0 flex-1 lg:min-h-0 lg:overflow-y-auto"
          >
            <section className="min-w-0 rounded-lg border border-[#d9dee7] bg-white p-5 lg:p-6">
              {active === "details" ? (
                <>
                  <h3 className="text-lg font-semibold text-[#171717]">Request details</h3>
                  <RequisitionDetails
                    content={draft.content}
                    onChange={updateContent}
                    leading={
                      <div data-requisition-field="academic-year" className="min-w-0">
                        <InputField
                          label="Academic year"
                          fieldKey="academicYear"
                          value={draft.academicYear}
                          required
                          onChange={(academicYear) =>
                            edit((current) => ({ ...current, academicYear }))
                          }
                        />
                      </div>
                    }
                  />
                </>
              ) : null}
              {active === "courses" ? (
                <RequisitionCourseEditor
                  courses={draft.content.courses}
                  onChange={(courses) => updateContent({ courses })}
                  catalogueCourses={catalogue.data ?? []}
                  headingAside={
                    <p className="rounded-md bg-[#eaf1f8] px-3 py-1.5 text-sm font-semibold text-[#1f4e79]">
                      Total: {formatTeachingHours(total)} hours
                    </p>
                  }
                />
              ) : null}
              {active === "admin" ? (
                /* Paid on this requisition, and never taught: counted apart from the teaching everywhere. */
                <RequisitionCourseEditor
                  kind="admin"
                  courses={draft.content.admin ?? []}
                  onChange={(admin) => updateContent({ admin })}
                  catalogueCourses={catalogue.data ?? []}
                  headingAside={
                    <p className="rounded-md bg-[#f4efe6] px-3 py-1.5 text-sm font-semibold text-[#7a5a1d]">
                      Total: {formatTeachingHours(adminTotal)} admin hours
                    </p>
                  }
                />
              ) : null}
              {active === "review" ? (
                <RequisitionReview
                  teacherName={teacherName}
                  requisition={draft}
                  totalHours={total}
                  adminHours={adminTotal}
                />
              ) : null}
            </section>
          </div>
        </div>
      </div>
    </FieldInfoProvider>
  );
}

function InlineRequisitionTitle({
  value,
  editing,
  onEdit,
  onChange,
  onDone,
}: {
  value: string;
  editing: boolean;
  onEdit: () => void;
  onChange: (value: string) => void;
  onDone: () => void;
}) {
  if (editing)
    return (
      <div data-requisition-field="requisition-title" className="w-[min(28rem,70vw)] max-w-full">
        <label className="sr-only" htmlFor="requisition-title">
          Requisition title
        </label>
        <input
          id="requisition-title"
          aria-label="Requisition title"
          required
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onDone}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") onDone();
          }}
          className="h-9 w-full rounded-md border border-[#1f4e79] bg-white px-3 text-xl font-semibold text-[#171717] outline-none ring-2 ring-[#d7e5f3]"
        />
      </div>
    );
  return (
    <h2
      title={value || "Untitled requisition"}
      className="truncate text-xl font-semibold text-[#171717]"
    >
      <button
        type="button"
        onClick={onEdit}
        aria-description="Click to edit requisition title"
        className="max-w-full truncate rounded-sm text-left hover:text-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
      >
        {value || "Untitled requisition"}
      </button>
    </h2>
  );
}

export function RequisitionDetails({
  content,
  onChange,
  leading,
}: {
  content: RequisitionContent;
  onChange: (patch: Partial<RequisitionContent>) => void;
  /** A first cell in the same grid: the editor's academic year, which is not content. */
  leading?: ReactNode;
}) {
  return (
    <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
      {leading}
      <RequisitionFieldAnchor target="department">
        <InputField
          label="Hiring department"
          fieldKey="department"
          value={content.department}
          required
          onChange={(department) => onChange({ department })}
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="program">
        <SelectField
          label="Programme"
          fieldKey="program"
          value={content.program}
          options={PROGRAMS}
          required
          onChange={(program) => onChange({ program })}
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="job-title">
        <SelectField
          label="Job title"
          fieldKey="jobTitle"
          value={content.jobTitle}
          options={JOB_TITLES}
          required
          onChange={(jobTitle) => onChange({ jobTitle })}
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="employee-type">
        <SelectField
          label="Employee type"
          fieldKey="employeeType"
          value={content.employeeType}
          options={EMPLOYEE_TYPES}
          required
          onChange={(employeeType) =>
            onChange({
              employeeType: employeeType as RequisitionContent["employeeType"],
            })
          }
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="class-type">
        <SelectField
          label="Type of class"
          fieldKey="classType"
          value={content.classType}
          options={CLASS_TYPES}
          required
          onChange={(classType) => onChange({ classType })}
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="contract-from">
        <DateField
          label="Requisition from"
          fieldKey="contractFrom"
          value={content.contractFrom}
          required
          onChange={(contractFrom) => onChange({ contractFrom })}
        />
      </RequisitionFieldAnchor>
      <RequisitionFieldAnchor target="contract-to">
        <DateField
          label="Requisition to"
          fieldKey="contractTo"
          value={content.contractTo}
          required
          onChange={(contractTo) => onChange({ contractTo })}
        />
      </RequisitionFieldAnchor>
    </div>
  );
}

function RequisitionFieldAnchor({
  target,
  children,
}: {
  target: string;
  children: ReactNode;
}) {
  return (
    <div data-requisition-field={target} className="min-w-0">
      {children}
    </div>
  );
}

export function RequisitionReview({
  teacherName,
  requisition,
  totalHours,
  adminHours = 0,
}: {
  teacherName: string;
  requisition: TeacherRequisition;
  totalHours: number;
  adminHours?: number;
}) {
  const missing = missingRequisitionFields(requisition);
  const courseCount = requisition.content.courses.length;
  const adminCount = (requisition.content.admin ?? []).length;
  return (
    <div>
      <div>
        <h3 className="text-lg font-semibold">Review</h3>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <ReviewDetail label="Teacher" value={teacherName} />
        <ReviewDetail
          label="Requisition"
          value={requisition.label || "Not set"}
        />
        <ReviewDetail
          label="Academic year"
          value={requisition.academicYear || "Not set"}
        />
        <ReviewDetail
          label="Hiring department"
          value={requisition.content.department || "Not set"}
        />
        <ReviewDetail
          label="Programme"
          value={requisition.content.program || "Not set"}
        />
        <ReviewDetail
          label="Job title"
          value={requisition.content.jobTitle || "Not set"}
        />
        <ReviewDetail
          label="Employee type"
          value={
            requisition.content.employeeType === "FT"
              ? "Full Time Employee"
              : "Part Time Employee"
          }
        />
        <ReviewDetail
          label="Type of class"
          value={requisition.content.classType || "Not set"}
        />
        <ReviewDetail
          label="Requisition period"
          value={
            requisition.content.contractFrom && requisition.content.contractTo
              ? `${requisition.content.contractFrom} to ${requisition.content.contractTo}`
              : "Not set"
          }
        />
        <ReviewDetail
          label="Teaching load"
          value={`${courseCount} ${courseCount === 1 ? "course" : "courses"} · ${formatTeachingHours(totalHours)} hours`}
        />
        <ReviewDetail
          label="Admin hours"
          value={
            adminCount
              ? `${adminCount} ${adminCount === 1 ? "entry" : "entries"} · ${formatTeachingHours(adminHours)} hours`
              : "None"
          }
        />
        <ReviewDetail
          label="Total on the form"
          value={`${formatTeachingHours(Math.round((totalHours + adminHours) * 1000) / 1000)} hours`}
        />
      </dl>
      {missing.length ? (
        <div
          role="alert"
          className="mt-5 rounded-md border border-[#efc9cb] bg-[#fff5f5] p-4 text-sm text-[#8f1f25]"
        >
          <p className="font-semibold">
            {missing.length} required{" "}
            {missing.length === 1 ? "field remains" : "fields remain"} before
            export.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {missing.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p
          role="status"
          className="mt-5 rounded-md border border-[#c9dfcf] bg-[#f4fbf5] px-3 py-2 text-sm font-medium text-[#256237]"
        >
          Ready to export.
        </p>
      )}
    </div>
  );
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-[#1f4e79]">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-[#171717]">{value}</dd>
    </div>
  );
}
export function PhoneField({
  value,
  onChange,
  fieldKey,
}: {
  value: string;
  onChange: (value: string) => void;
  fieldKey?: string;
}) {
  const parsed = parsePhoneValue(value);
  const [countryCode, setCountryCode] = useState(parsed.countryCode);

  useEffect(() => {
    if (value) setCountryCode(parsed.countryCode);
  }, [parsed.countryCode, value]);

  function updateNumber(number: string, code = countryCode) {
    onChange(number.trim() ? `${code} ${number}` : "");
  }

  return (
    <label className="grid min-w-0 self-start gap-1 text-sm font-medium text-[#344054]">
      <FormFieldLabel fieldKey={fieldKey}>Phone</FormFieldLabel>
      <span className="flex min-w-0 gap-2">
        <CountryCodeCombobox
          value={countryCode}
          onChange={(code) => {
            setCountryCode(code);
            if (parsed.localNumber.trim())
              updateNumber(parsed.localNumber, code);
          }}
        />
        <input
          aria-label="Phone number"
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={parsed.localNumber}
          onChange={(event) => updateNumber(event.target.value)}
          placeholder="555 123 4567"
          className="h-10 min-w-0 flex-1 rounded-md border border-[#b7bec8] px-3 text-sm font-normal"
        />
      </span>
    </label>
  );
}
function InputField({
  label,
  value,
  onChange,
  required = false,
  autoFocus = false,
  type = "text",
  fieldKey,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  autoFocus?: boolean;
  type?: string;
  fieldKey?: string;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-sm font-medium text-[#344054]">
      <FormFieldLabel required={required} fieldKey={fieldKey}>
        {label}
      </FormFieldLabel>
      <input
        required={required}
        autoFocus={autoFocus}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-md border border-[#b7bec8] px-3 font-normal focus:border-[#1f4e79] focus:outline-none focus:ring-2 focus:ring-[#d7e5f3]"
      />
    </label>
  );
}
function SelectField({
  label,
  value,
  options,
  onChange,
  required = false,
  fieldKey,
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
  required?: boolean;
  fieldKey?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1 text-sm font-medium text-[#344054]">
      <FormFieldLabel required={required} fieldKey={fieldKey}>
        {label}
      </FormFieldLabel>
      <SelectMenu
        label={label}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={`Select ${label.toLowerCase()}`}
        options={options.map((option) =>
          typeof option === "string"
            ? { value: option, label: option }
            : option,
        )}
      />
    </div>
  );
}
function flattenFolders(
  folders: TeacherFolder[],
): Array<{ folder: TeacherFolder; depth: number; path: TeacherFolder[] }> {
  const byParent = new Map<string | null, TeacherFolder[]>();
  for (const folder of folders) {
    const parent =
      folder.parentId &&
      folders.some((candidate) => candidate.id === folder.parentId)
        ? folder.parentId
        : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), folder]);
  }
  for (const children of byParent.values())
    children.sort((a, b) => a.name.localeCompare(b.name));
  const output: Array<{
    folder: TeacherFolder;
    depth: number;
    path: TeacherFolder[];
  }> = [];
  const visit = (
    parent: string | null,
    depth: number,
    path: TeacherFolder[],
  ) => {
    for (const folder of byParent.get(parent) ?? []) {
      const next = [...path, folder];
      output.push({ folder, depth, path: next });
      visit(folder.id, depth + 1, next);
    }
  };
  visit(null, 0, []);
  return output;
}
