import { FileUp, Upload } from "lucide-react";
import { DragEvent, useRef, useState } from "react";

type Props = {
  files: File[];
  onFiles: (files: File[]) => void;
  disabled?: boolean;
};

export function FileDropzone({ files, onFiles, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function acceptFiles(nextFiles: FileList | File[] | null | undefined) {
    const acceptedFiles = Array.from(nextFiles ?? []).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (acceptedFiles.length === 0 || disabled) {
      return;
    }
    onFiles(acceptedFiles);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    acceptFiles(event.dataTransfer.files);
  }

  const label = files.length === 0 ? "Upload Course Class Roster PDFs" : files.length === 1 ? files[0].name : `${files.length} PDFs selected`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          inputRef.current?.click();
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={[
        "flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed px-5 py-8 text-center transition",
        dragging ? "border-[#1f4e79] bg-[#eef5fb]" : "border-[#b7bec8] bg-white",
        disabled ? "opacity-60" : "hover:border-[#1f4e79] hover:bg-[#f2f7fb]",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(event) => acceptFiles(event.target.files)}
      />
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-md bg-[#e8edf3] text-[#1f4e79]">
        {files.length > 0 ? <FileUp size={24} aria-hidden="true" /> : <Upload size={24} aria-hidden="true" />}
      </div>
      <div className="max-w-full text-sm font-semibold text-[#171717]">{label}</div>
      <div className="mt-2 text-xs text-[#667085]">PDF files only; multiple files accepted</div>
    </div>
  );
}
