export type CourseInfo = {
  term: string | null;
  crn: string | null;
  course_code: string | null;
  course_title: string | null;
  department: string | null;
  contact_hours: string | null;
  teacher: string | null;
  major: string | null;
  printed_on: string | null;
  source_filename: string | null;
};

export type RosterRow = {
  number: number;
  student_id: string;
  student_name: string;
  status: string;
  major: string;
  department: string;
  level: string;
  hours_of_absences: number;
  absence_percent: string;
};

export type RosterPreview = {
  courseInfo: CourseInfo;
  rows: RosterRow[];
  pageCount: number;
  rowCount: number;
  excelFilename: string;
};

export type BatchRosterPreviewItem = {
  filename: string;
  ok: boolean;
  preview?: RosterPreview;
  error?: string;
};

export type BatchRosterPreview = {
  files: BatchRosterPreviewItem[];
  successCount: number;
  failureCount: number;
};

export type LocalExportResult = {
  filename: string;
  path: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function parseError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}

export async function previewRoster(file: File): Promise<RosterPreview> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/v1/rosters/preview`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<RosterPreview>;
}

export async function previewRosterBatch(files: File[]): Promise<BatchRosterPreview> {
  const formData = filesToFormData(files);

  const response = await fetch(`${API_BASE_URL}/api/v1/rosters/preview-batch`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<BatchRosterPreview>;
}

export async function downloadRosterWorkbook(file: File): Promise<void> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/v1/rosters/convert`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition");
  const filename = filenameFromDisposition(contentDisposition) ?? "course-roster.xlsx";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadRosterWorkbooks(files: File[]): Promise<void> {
  const formData = filesToFormData(files);

  const response = await fetch(`${API_BASE_URL}/api/v1/rosters/convert-batch`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition");
  const filename = filenameFromDisposition(contentDisposition) ?? "course-rosters.zip";
  downloadBlob(blob, filename);
}

export async function exportRosterWorkbooks(files: File[]): Promise<LocalExportResult> {
  const formData = filesToFormData(files);

  const response = await fetch(`${API_BASE_URL}/api/v1/rosters/export-batch`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<LocalExportResult>;
}

function filesToFormData(files: File[]): FormData {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  return formData;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const utfMatch = header.match(/filename\*=UTF-8''([^;]+)/);
  if (utfMatch?.[1]) {
    return decodeURIComponent(utfMatch[1]);
  }
  const asciiMatch = header.match(/filename="([^"]+)"/);
  return asciiMatch?.[1] ?? null;
}
