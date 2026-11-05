/** The slider for either zoom of the department's week; its ranges are in `@/services/timelineZoom`. */
export function Zoom({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  start?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 rounded-md border border-[#d3d9e2] bg-white px-2 py-1.5">
      <span className="text-xs font-semibold text-[#667085]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={`${label} of a class`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-16 cursor-pointer accent-[#1f4e79]"
      />
    </label>
  );
}

