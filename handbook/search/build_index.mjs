#!/usr/bin/env node
/**
 * Build the semantic-search data file for the SCEN Coordinator Handbook.
 *
 * Reads the BUILT site in ../_site (so heading anchors + page URLs are exactly
 * what MkDocs produced), chunks each page by <h2> section, and writes a TEXT-ONLY
 * index to docs/assets/search/search-data.json — no embeddings.
 *
 * Retrieval is lexical (keyword, in the browser, no model); a small cross-encoder
 * reranker (ms-marco-MiniLM-L-6-v2, ~22MB) reorders the top candidates by meaning.
 * On this 111-chunk corpus, lexical recall@15 + rerank puts every tested query —
 * including hard paraphrases — at #1, so no neural retriever (and its ~112MB) is
 * needed. This build therefore loads NO model and is instant.
 *
 * Run via ../build_search.sh (which runs `mkdocs build` first).
 */
import { parse } from "node-html-parser";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_DIR = path.join(ROOT, "_site");
const OUT_DIR = path.join(ROOT, "docs", "assets", "search");
const OUT_FILE = path.join(OUT_DIR, "search-data.json");

const MAX_CHARS = 2200; // cap per-chunk text stored

/** Recursively collect every index.html / *.html under the built site. */
async function collectHtml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["assets", "search"].includes(entry.name)) continue;
      out.push(...(await collectHtml(full)));
    } else if (entry.name.endsWith(".html") && entry.name !== "404.html") {
      out.push(full);
    }
  }
  return out;
}

/** Built file path -> site-root-relative URL (directory URLs). */
function urlForFile(file) {
  let rel = path.relative(SITE_DIR, file).split(path.sep).join("/");
  rel = rel.replace(/index\.html$/, "").replace(/\.html$/, "/");
  return rel === "" ? "" : rel;
}

/** Collapse whitespace and strip permalink glyphs. */
const clean = (s) => (s || "").replace(/[¶↵↩]/g, "").replace(/\s+/g, " ").trim();

/** Nav-only pages (card grids) — skip; they hold no unique content, just links. */
const SKIP_URLS = new Set(["getting-started/", "procedures/"]);

/**
 * Extract chunks from one built page. One chunk per <h2> section (its own text
 * plus any <h3> subsection text), and one lead chunk for content before the
 * first <h2>.
 */
function chunkPage(html, url) {
  const root = parse(html);
  const content = root.querySelector(".md-content__inner");
  if (!content) return [];

  const pageTitle = clean(content.querySelector("h1")?.text) || clean(root.querySelector("title")?.text);

  // Strip non-prose: permalink anchors, copy buttons, and Mermaid diagram SOURCE
  // (`<pre class="mermaid">` holds raw "flowchart LR A[...] --> B{...}" markup,
  // which is noise in teasers and pollutes the embeddings).
  content
    .querySelectorAll(".headerlink, .md-annotation, button, pre.mermaid, .mermaid")
    .forEach((n) => n.remove());

  const chunks = [];
  let current = null;
  const pushCurrent = () => {
    if (current && clean(current.parts.join(" ")).length > 0) {
      const text = clean(current.parts.join(" ")).slice(0, MAX_CHARS);
      chunks.push({
        title: pageTitle,
        section: current.section,
        anchor: current.anchor,
        url: current.anchor ? `${url}#${current.anchor}` : url,
        content: text,
      });
    }
  };

  // Lead chunk (intro before first h2).
  current = { section: "", anchor: "", parts: [] };

  for (const node of content.childNodes) {
    const tag = node.rawTagName ? node.rawTagName.toLowerCase() : null;
    if (tag === "h1") continue;
    if (tag === "h2") {
      pushCurrent();
      current = {
        section: clean(node.text),
        anchor: node.getAttribute("id") || "",
        parts: [],
      };
    } else {
      const t = clean(node.text);
      if (t) current.parts.push(t);
    }
  }
  pushCurrent();
  return chunks;
}

async function main() {
  if (!existsSync(SITE_DIR)) {
    console.error(`\n✗ ${SITE_DIR} not found. Run \`mkdocs build\` first (use build_search.sh).\n`);
    process.exit(1);
  }

  console.log("• Reading built site…");
  const files = await collectHtml(SITE_DIR);
  const chunks = [];
  for (const f of files) {
    const url = urlForFile(f);
    if (SKIP_URLS.has(url)) continue;
    const html = await readFile(f, "utf8");
    chunks.push(...chunkPage(html, url));
  }
  console.log(`• ${files.length} pages → ${chunks.length} chunks`);

  const records = chunks.map((c, i) => ({
    id: `${i}`,
    title: c.title,
    section: c.section,
    url: c.url,
    content: c.content,
  }));

  await mkdir(OUT_DIR, { recursive: true });
  const payload = { count: records.length, records };
  await writeFile(OUT_FILE, JSON.stringify(payload));
  const kb = Math.round((await readFile(OUT_FILE)).length / 1024);
  console.log(`✓ Wrote ${OUT_FILE} (${records.length} chunks, text-only, ${kb} KB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
