/**
 * A semester's short name — S1, S2, Summer — wherever a semester is named in a menu.
 *
 * A shape of its own, so it reads as neither of the pills already beside a name: the year
 * is a round outline, a count a round fill. This is a square-cornered solid tag, the
 * semester's own label, in front of the name it shortens.
 */
export function SemesterTag({ short, className = "" }: { short: string; className?: string }) {
  if (!short) return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-[3px] bg-[#1f4e79] px-1.5 py-0 text-[11px] font-bold leading-[1.5] tracking-wide text-white ${className}`}
    >
      <span className="sr-only">short name </span>
      {short}
    </span>
  );
}
