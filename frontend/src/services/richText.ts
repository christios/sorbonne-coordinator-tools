/**
 * Session details are written with formatting now, and stored as HTML.
 *
 * Everything else that reads the field — the export preview, the year-on-year comparison,
 * the exported document's plain paths — wants it as text, so the two forms are kept
 * convertible. A value written before this existed has no tags at all, and is treated as
 * the plain text it is rather than being mangled into markup.
 */

export function isRichText(value: string): boolean {
  return /<(p|div|br|ul|ol|li|h[1-6]|strong|b|em|i|u)\b[^>]*>/i.test(value);
}

const BULLETS = ["\u2022", "\u25e6", "\u25aa"];

function roman(value: number): string {
  const numerals: Array<[number, string]> = [[10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let written = "";
  for (const [size, numeral] of numerals) {
    while (value >= size) {
      written += numeral;
      value -= size;
    }
  }
  return written;
}

/** What a list item is written with — a bullet for its depth, or its number. */
function marker(list: Element, index: number, depth: number): string {
  if (list.tagName === "UL") return BULLETS[Math.min(depth, BULLETS.length - 1)];
  const numbering = list.getAttribute("type") ?? "1";
  if (numbering === "a") return `${String.fromCharCode(97 + ((index - 1) % 26))}.`;
  if (numbering === "i") return `${roman(index)}.`;
  return `${index}.`;
}

/**
 * What the value says, with a list's markers kept because they carry meaning, and a nested
 * list stepped in — the same text the exported document is given.
 */
export function richTextToPlain(value: string): string {
  if (!value) return "";
  if (!isRichText(value)) return value;
  const parsed = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  const lines: string[] = [];
  const own = (element: Element) =>
    [...element.childNodes]
      .filter((node) => !(node instanceof Element) || !["UL", "OL"].includes(node.tagName))
      .map((node) => node.textContent ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  const walk = (node: Node, depth: number) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
        if (text && depth === 0) lines.push(text);
        return;
      }
      if (!(child instanceof Element)) return;
      const tag = child.tagName;
      if (tag === "UL" || tag === "OL") {
        let counter = 0;
        [...child.children].forEach((item) => {
          if (item.tagName === "LI") {
            counter += 1;
            const text = own(item);
            if (text) lines.push(`${"    ".repeat(depth)}${marker(child, counter, depth)} ${text}`);
            walk(item, depth + 1);
            return;
          }
          // A browser will happily nest a list as a sibling of the items rather than inside
          // one of them; it belongs a level in either way.
          if (item.tagName === "UL" || item.tagName === "OL") walk(child, depth + 1);
        });
        return;
      }
      if (tag === "BR") return;
      const text = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
    });
  };
  walk(parsed.body, 0);
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
      [...child.attributes].forEach((attribute) => {
        // "type" on a numbered list is how it is numbered — 1, a or i — and is the one
        // attribute the editor sets deliberately.
        if (child.tagName === "OL" && attribute.name === "type") return;
        child.removeAttribute(attribute.name);
      });
    });
  };
  clean(document_.body);
  return document_.body.innerHTML;
}
