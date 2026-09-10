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

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function escapeHtml(value: string): string {
  return (value ?? "").replace(/[&<>]/g, (character) => ESCAPES[character]);
}

/**
 * The same block as HTML, so it arrives in an email as a table rather than as prose.
 *
 * `headers` is null for the copies that deliberately have none — a preset saved with the
 * header row turned off is pasted under a heading somebody has already written, and a
 * thead of repeated column names underneath it is noise.
 */
export function tableHtml(headers: string[] | null, rows: string[][]): string {
  const cells = (values: string[], tag: "th" | "td") =>
    values.map((value) => `<${tag}>${escapeHtml(value) || "&nbsp;"}</${tag}>`).join("");
  return [
    '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse">',
    headers ? `<thead><tr>${cells(headers, "th")}</tr></thead>` : "",
    `<tbody>${rows.map((row) => `<tr>${cells(row, "td")}</tr>`).join("")}</tbody>`,
    "</table>",
  ].join("");
}

/**
 * Put a block on the clipboard as BOTH a table and tab-separated text.
 *
 * A spreadsheet reads tab-separated text and makes a table of it; an email does not. It
 * takes the text flavour, keeps the tabs as tabs, and shows a column of ragged lines —
 * which is what a coordinator pasting the registrar's worklist into a message got.
 *
 * So the clipboard carries two flavours and each reader takes the one it understands:
 * `text/html` for the mail client, `text/plain` for Excel and for anyone pasting into a
 * plain editor. Where `ClipboardItem` is not available — an old browser, or plain http,
 * where the whole clipboard API is missing — it falls back to the text alone, which is
 * what this did before and is still right in a spreadsheet.
 */
export async function copyTable(headers: string[] | null, rows: string[][]): Promise<boolean> {
  const text = headers ? tableText(headers, rows) : rows.map(rowText).join("\n");
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([tableHtml(headers, rows)], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Denied, or a flavour the browser will not take: the text alone still pastes.
  }
  return copyToClipboard(text);
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
    // Selecting takes the focus, and whatever had it should get it back: a menu that
    // closes because the copy stole focus takes its own "copied" tick with it.
    const had = document.activeElement as HTMLElement | null;
    holder.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(holder);
    had?.focus?.();
    return copied;
  } catch {
    return false;
  }
}
