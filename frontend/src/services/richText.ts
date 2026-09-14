/**
 * Session details are written with formatting now, and stored as HTML.
 *
 * Everything else that reads the field — the export preview, the year-on-year comparison,
 * the exported document's plain paths — wants it as text, so the two forms are kept
 * convertible. A value written before this existed has no tags at all, and is treated as
 * the plain text it is rather than being mangled into markup.
 */

const BLOCK_END = /<\/(p|div|h[1-6]|li|tr)>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;

export function isRichText(value: string): boolean {
  return /<(p|div|br|ul|ol|li|h[1-6]|strong|b|em|i|u)\b[^>]*>/i.test(value);
}

/** What the value says, with a list's markers kept because they carry meaning. */
export function richTextToPlain(value: string): string {
  if (!value) return "";
  if (!isRichText(value)) return value;
  const document_ = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  const lines: string[] = [];
  const walk = (node: Node, marker?: string) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text) lines.push(text);
        return;
      }
      if (!(child instanceof Element)) return;
      const tag = child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") {
        let counter = 0;
        child.childNodes.forEach((item) => {
          if (!(item instanceof Element) || item.tagName.toLowerCase() !== "li") return;
          counter += 1;
          const text = (item.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text) lines.push(`${tag === "ol" ? `${counter}.` : "•"} ${text}`);
        });
        return;
      }
      if (tag === "br") return;
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) lines.push(marker ? `${marker} ${text}` : text);
    });
  };
  walk(document_.body);
  return lines.join("\n");
}

/** Plain text on its way into the editor, one paragraph per line. */
export function plainToRichText(value: string): string {
  if (!value) return "";
  if (isRichText(value)) return value;
  return value
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character] ?? character);
}

/** Strip everything the editor does not offer, so a paste cannot carry markup in. */
export function sanitiseRichText(html: string): string {
  const allowed = new Set(["P", "BR", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U", "H3", "H4"]);
  const document_ = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const clean = (node: Node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (!(child instanceof Element)) {
        child.remove();
        return;
      }
      clean(child);
      if (!allowed.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        return;
      }
      [...child.attributes].forEach((attribute) => child.removeAttribute(attribute.name));
    });
  };
  clean(document_.body);
  return document_.body.innerHTML;
}
