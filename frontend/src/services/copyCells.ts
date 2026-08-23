/**
 * Putting table cells on the clipboard the way a spreadsheet expects them.
 *
 * Excel and Numbers read a pasted block as tab-separated columns and newline-separated
 * rows, and they read a quoted field as one cell even when it contains a tab or a line
 * break. So a value only needs quoting when it holds one of those, or a quote itself —
 * quoting everything would be correct too, but it makes the clipboard unreadable in a
 * plain text editor, which is where half of these end up.
 */

const NEEDS_QUOTING = /["\t\r\n]/;

export function escapeCell(value: string): string {
  const text = value ?? "";
  return NEEDS_QUOTING.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One column, top to bottom — what you get by copying a column in a spreadsheet. */
export function columnText(values: string[]): string {
  return values.map(escapeCell).join("\n");
}

/** One row, left to right, so pasting lands each value in its own cell. */
export function rowText(values: string[]): string {
  return values.map(escapeCell).join("\t");
}

/** A block: rows down, columns across, with a header line. */
export function tableText(headers: string[], rows: string[][]): string {
  return [rowText(headers), ...rows.map(rowText)].join("\n");
}

/**
 * Write to the clipboard, falling back for browsers that will not.
 *
 * `navigator.clipboard` needs a secure context, which a coordinator on plain http does not
 * have, so the old `execCommand` path stays as the fallback rather than the copy silently
 * doing nothing.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Denied or unavailable: fall through to the textarea.
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = text;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(holder);
    return copied;
  } catch {
    return false;
  }
}
