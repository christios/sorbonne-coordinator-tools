# SCEN Coordinator Handbook

[MkDocs Material](https://squidfunk.github.io/mkdocs-material/) source for the
Science & Engineering (SCEN) coordinator handbook, served by the platform at
`/handbook/`.

This directory is the maintained source. It was imported from a non-versioned
local MkDocs project — do not treat that external folder as authoritative. The
email archive the content was distilled from is deliberately **not** in this
repository and must not be added.

## Layout

```
handbook/
├── mkdocs.yml              # site config + navigation
├── docs/                   # content (Markdown)
│   ├── index.md            # home
│   ├── getting-started/    # onboarding, systems, glossary, contacts
│   ├── procedures/         # step-by-step task walkthroughs
│   ├── reference/          # annual cycle, known issues
│   ├── assets/search/      # search widget + generated index
│   └── stylesheets/
├── search/                 # build-time tooling (not shipped to the site)
│   └── build_index.mjs     # built HTML → section chunks → search-data.json
├── build_search.sh         # mkdocs build → index
└── _site/                  # local build output (git-ignored)
```

## Preview and build

```bash
uv run --with mkdocs-material mkdocs serve --dev-addr 127.0.0.1:8001
```

The deployment artifact is built into `backend/handbook-dist/` (git-ignored), not
`_site/`:

```bash
uv run --with mkdocs-material mkdocs build --config-file mkdocs.yml --site-dir ../backend/handbook-dist
```

## Editing

- Content is plain Markdown in `docs/`. Save and `mkdocs serve` hot-reloads.
- To add a page, create the `.md` file and add it to `nav:` in `mkdocs.yml`.
- Diagrams use fenced ` ```mermaid ` blocks (rendered natively by Material).
- Callouts use `!!! note` / `!!! warning` / `!!! tip` admonitions.
- **After editing content, run `./build_search.sh`** so the committed
  `search-data.json` matches. One-time setup: `cd search && npm install`.

## Search

Runs **entirely in the browser** — no backend, no API key, nothing leaves the
user's machine. Two stages, so it always feels fast:

1. **Instant keyword** — Material's own search retrieves and renders.
2. **Ranked by meaning** — a cross-encoder reorders those results once the model
   is loaded. The meta line says which stage you are looking at.

### The UI is Material's; we only supply the order

`semantic-search.js` adds **no search chrome of its own**. The header box, the
dropdown, the teasers, the `<mark>` term highlighting and the "N more on this
page" sections are all the theme's. When the reranker returns, we **reorder the
existing `<li>` nodes** rather than re-rendering the list.

That is deliberate. Rebuilding the markup means reimplementing highlighting and
teasers, and it lets a second retrieval disagree with what is on screen; by
reordering, every ranked item is by definition already in the DOM. An earlier
version shipped a custom modal instead and had to fight the theme for both.

### Retrieve → rerank

The standard two-stage design — cheap high-recall retrieval, then a small precise
reranker — except the retriever here is **Material's own keyword search**:

- **Retriever:** Material returns one `<li>` per matching page (typically 14–21 of
  21 pages), which is ample recall on a corpus this small.
- **Reranker:** `Xenova/ms-marco-MiniLM-L-6-v2` cross-encoder re-scores candidates
  reading `[query, passage]` **jointly**. This is what separates near-duplicates
  like *student-name* vs *course-name* consistency, which keyword and bi-encoder
  rankings both get wrong.
- **Granularity:** the index is chunked per `<h2>` section, and **every** section
  of each candidate page is reranked (batch of 64, ~11 pages). Both the page order
  and each page's internal section order come out of that single ranking.
  Shortlisting sections by keyword first does not work — Material scores
  *Identity cross-checks* last of six for *"student names inconsistent"*, and a
  keyword shortlist agrees, so the one section that answers never reaches the
  reranker.
- **The best section is promoted into view.** Material shows the page link and
  hides matching sections behind a "N more on this page" toggle, ordered by its
  own keyword score — which buries the answer. The top-ranked section is moved to
  a direct child of the `<li>`, where it renders in Material's own style, and the
  rest are reordered inside the toggle (its count is corrected too). Material
  already promotes a section of its own choosing, so that one is put back in the
  toggle first; otherwise a result ends up showing two.

When a section is promoted, two CSS classes tidy the result (see
`stylesheets/semantic-search.css`):

- `.ss-compact` on the `<li>` hides the **page's own teaser**. With the answering
  section directly beneath it, that intro is a less relevant line sitting above
  the answer. The page title stays, for context. When the page intro itself ranks
  highest nothing is promoted and the teaser is left alone.
- `.ss-promoted` on the section hides Material's **"Missing: …" caption**. It
  reports which literal query words are absent, which is a fair signal on
  keyword-ordered results but contradicts a semantic match — the reported case
  was *"student names inconsistent"* matching "name spellings … not always
  consistent", correctly, while the caption called the query words missing.

Note when styling these: Material wraps **page** teasers in `<p>` but renders
**section** teasers as bare text nodes, so `article > p` reaches only the former.
- **Nav-only pages** (`Getting Started`, `Procedures`) are excluded from the index
  and from reranking. They are tables of contents, not answers; scoring them on
  scraped DOM text promoted a stub above the page that answered the query.

**Why the neural retriever was dropped.** Lexical recall + the cross-encoder put
every tested query at #1, including hard paraphrases ("stop a pupil retaking a
module they already cleared" → Catch-up rules #1). A near-duplicate collision the
bi-encoder couldn't resolve (0.001–0.013 cosine, and it flipped between Node and
browser) the cross-encoder decides by whole-number logit margins. Earlier
iterations shipped e5-base (265 MB), then e5-small+rerank (135 MB); the retriever
never needed to be neural for a corpus this small.

- **Index:** `docs/assets/search/search-data.json` — text only, no embeddings
  (~75 KB, committed). The build loads no model, so it is instant.
- **Passage highlight:** clicking a result deep-links to the section *and* briefly
  highlights the most relevant blocks within it (paragraphs / list items / table
  cells only — never per-word, which carpet-highlights single letters). Fades
  after ~6 s. Works same-page and cross-page.

### Performance — measured, not guessed

Per query, in the worker, on real passages at a fixed `[12, 256]` batch:

| Backend | Per query |
| --- | --- |
| WASM q8 (23 MB) | 5500–5900 ms |
| WebGPU fp32 (91 MB) | 92–97 ms |
| **WebGPU fp16 (46 MB)** | **47–48 ms** ← used |

Those are a 12-passage batch. Batch size scales the cost roughly linearly on this
corpus — 24 → 100 ms, 48 → 210 ms, **64 → ~265 ms (shipped)**, 80 → 322 ms, and
all 111 chunks → 522 ms. 64 covers about 11 pages' sections outright, which is
what the section-level ranking above needs.

transformers.js **defaults to WASM even where WebGPU works**, so the backend is
selected explicitly via a `requestAdapter()` probe, with a try/catch fallback to
WASM q8. fp16 ranking is identical to q8 (and fp16 is the higher-precision of the
two), so there is no quality cost.

Two things that turned out **not** to be the bottleneck, contrary to what earlier
versions of this file claimed:

- **Cross-origin isolation (COOP/COEP).** Multi-threaded WASM would speed up a
  path we no longer take. Not worth the hosting constraints.
- **Worker vs main thread.** Workers run at low thread QoS, so on Apple Silicon
  WASM inference lands on efficiency cores — the same batch took 1360 ms on the
  main thread vs 5900 ms in the worker. WebGPU sidesteps this entirely.

The remaining first-use cost is the one-time ~46 MB model download, not compute.

### Two invariants worth keeping

**All worker inference must be serialised.** `self.onmessage = async (…)` does
*not* queue — every message starts its own invocation immediately. Two concurrent
`model()` calls on one ONNX session throw `Session already started`, and the
losing call never resolves, so the UI hangs until the timeout. The worker funnels
every session call through a single promise chain and drops superseded queries
*after* acquiring the lock.

**Batch shapes must stay fixed.** onnxruntime compiles a graph per distinct input
shape. `padding: "max_length"` with a constant pool size means it compiles once;
padding to the longest candidate per query made it recompile constantly, which
alone cost 1–5 s per search.

### Runtime dependencies (CDN)

The widget loads transformers.js from **jsDelivr** and the reranker weights from
the **Hugging Face** CDN on first use (~46 MB on WebGPU, ~23 MB on the WASM
fallback), cached afterwards. This needs outbound internet from the viewer's
browser. For a fully offline / air-gapped host, vendor the library and point
transformers.js `env.localModelPath` at a local copy of the model — not done.

## Editorial rules

- **Procedures are generalised.** Steps use roles and examples, not individual
  student cases.
- **Staff and partner contact names are kept** (operationally essential), but
  **student names, disciplinary case details, and personal grievances are
  excluded.** Keep it that way — this is shareable within the coordinator team.
- Time-sensitive facts (partnerships, systems, deadlines) are flagged in-page —
  especially the Université Paris Cité → Paris-Panthéon-Assas transition, which
  will change Bachelor grade routing and contacts.
