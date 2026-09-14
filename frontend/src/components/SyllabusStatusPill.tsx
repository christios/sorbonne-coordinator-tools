import type { SyllabusSummary } from "@/services/syllabi";

type SyllabusStatus = {
  label: string;
  /** What the pill is saying, for whoever has not learnt the four words yet. */
  description: string;
  tone: string;
};

/**
 * What a syllabus is doing, in one word.
 *
 * Four states, and every syllabus is in exactly one of them, so the pill is never absent:
 * a row with nothing on it would read as a fifth state nobody can name. The departmental
 * ones — written before anybody had their own — say so, because "whose is this" is the
 * first question anybody asks of a syllabus they did not write.
 */
function syllabusStatus(syllabus: Pick<SyllabusSummary, "ownerEmail" | "visibility" | "submittedAt">): SyllabusStatus {
  if (!syllabus.ownerEmail)
    return {
      label: "Departmental",
      description: "Written for the department. Whoever maintains the syllabus catalogue looks after it.",
      tone: "border-[#cdd9e8] bg-[#f4f7fb] text-[#3b5f86]",
    };
  if (syllabus.submittedAt)
    return {
      label: "For review",
      description: "Its author has asked for it to be read. A coordinator can open it while it is up for review.",
      tone: "border-[#f0d8a8] bg-[#fdf8ee] text-[#8a6116]",
    };
  if (syllabus.visibility === "public")
    return {
      label: "Published",
      description: "Anybody signed in can read it.",
      tone: "border-[#cfe3d3] bg-[#f2f9f4] text-[#2f6b41]",
    };
  return {
    label: "Private",
    description: "Only its author can read it, an administrator included.",
    tone: "border-[#e3e7ee] bg-[#f5f7fa] text-[#667085]",
  };
}

export function SyllabusStatusPill({
  syllabus,
  className = "",
}: {
  syllabus: Pick<SyllabusSummary, "ownerEmail" | "visibility" | "submittedAt">;
  className?: string;
}) {
  const status = syllabusStatus(syllabus);
  return (
    <span title={status.description} className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${status.tone} ${className}`}>
      {status.label}
    </span>
  );
}
